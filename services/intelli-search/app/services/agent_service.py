"""
LangChain tool-calling agent for agentic search.

Architecture:
  - 3 tools:  web_search_company_events, lookup_companies_by_name, submit_final_results
  - The agent chooses tools based on the query, reasons over results, then calls
    submit_final_results to emit a validated JSON array.
  - Model is fully configurable via search_config.yaml  agentic.model
    (gpt-4o-mini, gpt-4o, gpt-4-turbo or any OpenAI tool-calling model).

Pydantic boundary models validate all external data:
  - TavilyResult     — each item from the Tavily Search API
  - CompanyEvent     — each item extracted from web results by the LLM
  - EventExtractionResponse — the full LLM extraction output
  - EnrichedCompanyDoc — the final output shape per company
  - *Input models    — typed args_schema for each StructuredTool

Prompts are loaded from app/prompts/:
  - agent_system.txt      — agent system prompt (guardrails, PII rules, tool descriptions)
  - agent_extraction.txt  — event extraction system prompt
"""

import concurrent.futures
import hashlib
import json
import threading
import time
import structlog
from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field
from openai import OpenAI

from app.config import get_settings, get_search_config
from app.services.search_strategies import EventData
from app.services.pii_service import detect_pii
from app.services.prompt_loader import load_prompt

logger = structlog.get_logger(__name__)

# ── Thread-local storage for per-request state ───────────────────────────────
# AgentService is a singleton — instance variables would be shared across
# concurrent requests. Using thread-local storage ensures each request has
# its own isolated copy of mutable per-run state.
_tl = threading.local()

# ── Circuit breakers for external dependencies ────────────────────────────────
from app.services.circuit_breaker import CircuitBreaker, CircuitOpenError  # noqa: E402

_tavily_cb = CircuitBreaker("tavily", failure_threshold=5, timeout=60.0)
_openai_extraction_cb = CircuitBreaker("openai_extraction", failure_threshold=5, timeout=60.0)

# ── Prompts loaded from disk ──────────────────────────────────────────────────

# Loaded once at import time. The extraction prompt does not need today's date
# injected (each call adds it in the user message). The system prompt uses
# {today} which is .format()-ed at agent construction time.
_EXTRACTION_SYSTEM_PROMPT: str = load_prompt("agent_extraction.txt")
_LINKEDIN_EXTRACTION_PROMPT: str = load_prompt("agent_linkedin_extraction.txt")
_SYSTEM_PROMPT_TEMPLATE: str = load_prompt("agent_system.txt")

# ── Pydantic models for external data boundaries ─────────────────────────────


class TavilyResult(BaseModel):
    """Validated Tavily Search API result item."""
    title: str = ""
    url: str = ""
    content: str = ""
    published_date: Optional[str] = ""

    model_config = {"extra": "ignore", "coerce_numbers_to_str": True}


class CompanyEvent(BaseModel):
    """Structured company event extracted from web search by the LLM."""
    company_name: str
    event_type: Literal[
        "funding", "acquisition", "ipo", "merger", "partnership",
        "product_launch", "expansion", "layoffs", "other"
    ]
    amount: Optional[str] = None
    round: Optional[str] = None
    date: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    summary: str = ""
    source_url: Optional[str] = None

    model_config = {"extra": "ignore"}


class EventExtractionResponse(BaseModel):
    """Full validated LLM extraction output."""
    events: list[CompanyEvent] = []


class LinkedInProfile(BaseModel):
    """Structured company profile extracted from LinkedIn page."""
    description: Optional[str] = None
    headquarters: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    specialties: list[str] = []
    founded_year: Optional[int] = None
    website: Optional[str] = None
    recent_updates: Optional[str] = None

    model_config = {"extra": "ignore"}


class EnrichedCompanyDoc(BaseModel):
    """Final typed output per company — the shape submit_final_results produces."""
    id: str
    name: str
    domain: Optional[str] = ""
    industry: Optional[str] = ""
    country: Optional[str] = ""
    locality: Optional[str] = ""
    score: float = 1.0
    event_data: Optional[EventData] = None
    linkedin_profile: Optional[dict] = None

    model_config = {"extra": "ignore", "coerce_numbers_to_str": True}


# ── Tool input schemas ────────────────────────────────────────────────────────


class WebSearchInput(BaseModel):
    query: str = Field(..., description="Web search query for recent company events")


class LookupNamesInput(BaseModel):
    company_names: str = Field(
        ...,
        description="Comma-separated list of company names to look up in the database",
    )


class LinkedInLookupInput(BaseModel):
    company_name: str = Field(
        ...,
        description="Name of the company to look up on LinkedIn",
    )


class SubmitResultsInput(BaseModel):
    results_json: str = Field(
        default="[]",
        description="JSON array of company objects — the final answer. "
                    "Must be a JSON array, e.g. [] or [{\"id\": \"...\", \"name\": \"...\"}]",
    )


# ── Helpers ──────────────────────────────────────────────────────────────────

def _recover_partial_events(raw: str) -> list[CompanyEvent]:
    """Try to salvage complete events from truncated JSON output."""
    import re
    events: list[CompanyEvent] = []
    # Find all complete JSON objects in the events array
    for m in re.finditer(r'\{[^{}]*"company_name"\s*:[^{}]+\}', raw):
        try:
            events.append(CompanyEvent.model_validate_json(m.group()))
        except Exception:
            continue
    return events


def _call_tavily(url: str, payload: dict, timeout: int) -> dict:
    """
    Call Tavily API with exponential-backoff retry (using tenacity) and
    circuit-breaker protection.  Retries on transient network errors only;
    HTTP 4xx errors are not retried.
    """
    import requests
    from tenacity import (
        retry, stop_after_attempt, wait_exponential,
        retry_if_exception_type, before_sleep_log,
    )
    import logging as _logging

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type((
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
        )),
        before_sleep=before_sleep_log(logger, _logging.WARNING),  # type: ignore[arg-type]
        reraise=True,
    )
    def _do_post() -> requests.Response:
        resp = _tavily_cb.call(requests.post, url, json=payload, timeout=timeout)
        resp.raise_for_status()
        return resp

    return _do_post().json()


# ── AgentService ─────────────────────────────────────────────────────────────


class AgentService:
    """
    LangChain tool-calling agent for agentic company search.

    Model, max_iterations, and all thresholds are read from search_config.yaml
    agentic block so they can be changed without code edits.
    """

    def __init__(
        self,
        opensearch_service: Any,
        openai_api_key: str,
        model: str,
        tavily_key: Optional[str],
        max_iterations: int,
    ) -> None:
        _cfg = get_search_config().get("agentic", {})
        self._opensearch = opensearch_service
        self._tavily_key = tavily_key
        self._index = get_settings().OPENSEARCH_INDEX_NAME
        self._resolve_per_name: int = int(_cfg.get("resolve_per_name", 2))
        self._min_resolve_score: float = float(_cfg.get("min_resolve_score", 1.0))
        self._tavily_max_results: int = int(_cfg.get("tavily_max_results", 5))
        self._tavily_timeout_s: int = int(_cfg.get("tavily_timeout_s", 8))
        self._tavily_search_depth: str = str(_cfg.get("tavily_search_depth", "advanced"))
        self._llm_max_tokens: int = int(_cfg.get("llm_max_tokens", 800))
        self._resolve_to_index: bool = bool(_cfg.get("resolve_to_index", True))
        self._max_company_results: int = int(_cfg.get("max_company_results", 20))
        self._tavily_prefer_original: bool = bool(_cfg.get("tavily_prefer_original_query", True))

        # Plain OpenAI client used for structured event extraction.
        # Short keepalive_expiry prevents stale connections after long idle.
        import httpx as _httpx
        self._openai = OpenAI(
            api_key=openai_api_key,
            http_client=_httpx.Client(
                limits=_httpx.Limits(keepalive_expiry=30),
                timeout=_httpx.Timeout(60.0, connect=5.0),
            ),
        )
        # Allow extraction model to differ from the agent reasoning model.
        # gpt-4o-mini handles the constrained json_object extraction task well and
        # is ~70% cheaper / faster than gpt-4o — prefer it for extraction.
        self._extraction_model = str(_cfg.get("extraction_model", model))

        # LangChain agent — imported here to keep startup fast if agentic search
        # is disabled (imports are deferred).
        self._executor = self._build_executor(openai_api_key, model, max_iterations)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        query: str,
        progress_callback: Optional[Any] = None,
    ) -> list[dict[str, Any]]:
        """
        Run the agent for the given query.
        Returns a list of dicts in OpenSearch-hit format so that
        AgenticSearchStrategy._docs_to_results() needs no changes:
          {"_id": ..., "_score": ..., "name": ..., ..., "_event_data": {...}}
        """
        # PII guard — reject queries that contain personal information.
        pii_types = detect_pii(query)
        if pii_types:
            logger.warning(
                "agent_query_contains_pii",
                pii_types=pii_types,
                query_snippet=query[:60],
            )
            return []

        t0 = time.perf_counter()
        _cfg = get_search_config().get("agentic", {})
        hard_timeout_s: int = int(_cfg.get("agent_hard_timeout_s", 90))

        # Inject today's date into the user message so the agent always has the
        # correct date even when the server runs across midnight or multiple days.
        dated_query = f"[Today: {date.today().isoformat()}]\n{query}"

        # Each request runs the executor in a dedicated thread to allow enforcing
        # a hard wall-clock timeout independent of max_iterations.  Thread-local
        # storage (_tl) isolates per-request mutable state across concurrent calls.
        _intermediate_steps: list = []

        def _invoke() -> dict:
            # Initialise thread-local state for this request.
            _tl.last_run_companies = []
            _tl.original_query = query  # un-prefixed, used in prompts
            _tl.progress_callback = progress_callback  # may be None
            return self._executor.invoke({"input": dated_query})

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(_invoke)
                try:
                    result = future.result(timeout=hard_timeout_s)
                except concurrent.futures.TimeoutError:
                    logger.warning(
                        "agent_hard_timeout",
                        query=query[:100],
                        timeout_s=hard_timeout_s,
                    )
                    # Return whatever the tools managed to collect before the timeout.
                    return self._recover_from_steps(_intermediate_steps)

            _intermediate_steps = result.get("intermediate_steps", [])

            # Collect results from tool observations.
            # submit_final_results has been removed — _recover_from_steps() is now
            # the primary (not fallback) collection path, giving consistent behaviour
            # whether the agent hit max_iterations or finished naturally.
            return self._recover_from_steps(_intermediate_steps)

        except Exception as e:
            logger.error("agent_run_failed", query=query[:100], error=str(e))
            # Even when executor.invoke() throws (e.g. Pydantic validation on a
            # tool call), intermediate steps from earlier tools may still be
            # recoverable if the executor stored them before raising.
            return self._recover_from_steps(_intermediate_steps)
        finally:
            logger.info(
                "agent_run_completed",
                query=query[:100],
                agent_total_ms=int((time.perf_counter() - t0) * 1000),
            )

    # ------------------------------------------------------------------
    # Agent construction
    # ------------------------------------------------------------------

    def _build_executor(self, api_key: str, model: str, max_iterations: int):
        from langchain_openai import ChatOpenAI
        from langchain.agents import create_openai_tools_agent, AgentExecutor
        from langchain.tools import StructuredTool
        from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

        _cfg = get_search_config().get("agentic", {})
        temperature: float = float(_cfg.get("llm_temperature", 0.1))
        llm = ChatOpenAI(model=model, temperature=temperature, api_key=api_key)

        # The system prompt contains {today}, {current_year}, {year_minus_1}
        # placeholders. We inject a fixed date at build time for the static parts
        # of the prompt. The *actual* current date is injected per-request via the
        # human message prefix "[Today: ...]" in run(), which takes precedence.
        _build_date = date.today()
        prompt = ChatPromptTemplate.from_messages([
            ("system", _SYSTEM_PROMPT_TEMPLATE.format(
                today=_build_date.isoformat(),
                current_year=_build_date.year,
                year_minus_1=_build_date.year - 1,
            )),
            ("human", "{input}"),
            MessagesPlaceholder("agent_scratchpad"),
        ])

        tools = self._build_tools()
        agent = create_openai_tools_agent(llm, tools, prompt)

        return AgentExecutor(
            agent=agent,
            tools=tools,
            max_iterations=max_iterations,
            handle_parsing_errors=True,
            return_intermediate_steps=True,  # required for fallback recovery in run()
            verbose=get_settings().is_development,
        )

    def _build_tools(self):
        from langchain.tools import StructuredTool

        # Capture self once — all tool closures reference this.
        svc = self

        # ── Tool 1: web_search_company_events ─────────────────────────

        def _emit(phase: str, message: str) -> None:
            """Emit a progress event to the streaming callback (if any)."""
            cb = getattr(_tl, "progress_callback", None)
            if cb is not None:
                try:
                    cb(phase, message)
                except Exception:
                    pass  # Never let progress reporting break the search

        def web_search_company_events(query: str) -> str:
            """
            Search the web for recent company events (funding, acquisitions,
            IPOs, layoffs, product launches) and match against the database.
            """
            _emit("tool_start", "Searching the web for recent company events…")
            tavily_hits: list[TavilyResult] = []

            # Decide primary vs retry query based on config.
            # When tavily_prefer_original_query is true, Tavily gets the
            # user's natural-language query first (better for most searches);
            # the agent's keyword query becomes the zero-result fallback.
            _original_query = getattr(_tl, "original_query", "")
            if svc._tavily_prefer_original and _original_query:
                primary_query = _original_query
                retry_query = query  # agent's constructed query
            else:
                primary_query = query  # agent's constructed query
                retry_query = _original_query

            if svc._tavily_key:
                _t_tav = time.perf_counter()
                try:
                    data = _call_tavily(
                        "https://api.tavily.com/search",
                        {
                            "api_key": svc._tavily_key,
                            "query": primary_query,
                            "max_results": svc._tavily_max_results,
                            "search_depth": svc._tavily_search_depth,
                            "include_published_date": True,
                        },
                        svc._tavily_timeout_s,
                    )
                    tavily_hits = [
                        TavilyResult.model_validate(r)
                        for r in data.get("results", [])
                    ]
                    logger.info(
                        "tavily_search_done",
                        count=len(tavily_hits),
                        query=primary_query[:80],
                        titles=[h.title[:80] for h in tavily_hits],
                        tavily_ms=int((time.perf_counter() - _t_tav) * 1000),
                    )
                except CircuitOpenError:
                    logger.warning("tavily_circuit_open_skipping_search")
                except Exception as e:
                    logger.warning("tavily_search_failed", error=str(e))

            if not tavily_hits:
                return "No web search results available."

            # Extract structured events with the LLM.
            events: list[CompanyEvent] = []
            results_text = "\n\n".join(
                f"Title: {r.title}\nURL: {r.url}\n"
                f"Published: {r.published_date or 'unknown'}\nContent: {r.content[:1200]}"
                for r in tavily_hits
            )
            # Sanitize user query before embedding in LLM prompt to prevent
            # prompt injection via crafted search queries.
            safe_query = _original_query[:300].replace("\n", " ").replace("\r", " ")
            user_msg = (
                f"Today: {date.today().isoformat()}\n"
                f"Original user query: <user_query>{safe_query}</user_query>\n"
                f"Search query used: {primary_query}\n"
                f"Max companies to return: {svc._max_company_results}\n\n"
                f"Web search results:\n{results_text}"
            )
            _t_llm = time.perf_counter()
            raw = ""
            try:
                llm_resp = _openai_extraction_cb.call(
                    svc._openai.chat.completions.create,
                    model=svc._extraction_model,
                    messages=[
                        {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    max_tokens=svc._llm_max_tokens,
                    temperature=0,
                    response_format={"type": "json_object"},
                )
                if not llm_resp.choices or not llm_resp.choices[0].message:
                    logger.error("llm_empty_response_skipping_extraction",
                                 model=svc._extraction_model)
                    llm_resp = None
                else:
                    raw = llm_resp.choices[0].message.content or ""
                    raw = raw.strip()
                _usage = llm_resp.usage if llm_resp else None
                finish_reason = llm_resp.choices[0].finish_reason if llm_resp else None

                if finish_reason == "length":
                    # Output was truncated — recover complete events from partial JSON
                    logger.warning(
                        "extraction_truncated",
                        query=query[:80],
                        raw_len=len(raw),
                        output_tokens=_usage.completion_tokens if _usage else None,
                    )
                    events = _recover_partial_events(raw)
                    if events:
                        logger.info("partial_events_recovered", count=len(events))
                else:
                    extraction = EventExtractionResponse.model_validate_json(raw)
                    events = extraction.events
                    logger.info(
                        "events_extracted",
                        count=len(events),
                        query=query[:80],
                        extraction_ms=int((time.perf_counter() - _t_llm) * 1000),
                        input_tokens=_usage.prompt_tokens if _usage else None,
                        output_tokens=_usage.completion_tokens if _usage else None,
                    )
                    if events:
                        _emit("extracting", f"Extracted {len(events)} company event(s) from web results…")
            except Exception as e:
                logger.error("event_extraction_failed", error=str(e))
                # Attempt to recover partial events from truncated JSON
                if raw:
                    events = _recover_partial_events(raw)
                    if events:
                        logger.info("partial_events_recovered", count=len(events))

            # ── Zero-result retry with alternate query ─────────────
            # If primary query yielded no events, try the other query
            # variant (original user query or agent's constructed query).
            if (
                not events
                and retry_query
                and retry_query != primary_query
                and svc._tavily_key
            ):
                logger.info(
                    "extraction_zero_result_retry",
                    primary_query=primary_query[:80],
                    retry_query=retry_query[:80],
                )
                _t_retry = time.perf_counter()
                try:
                    retry_data = _call_tavily(
                        "https://api.tavily.com/search",
                        {
                            "api_key": svc._tavily_key,
                            "query": retry_query,
                            "max_results": svc._tavily_max_results,
                            "search_depth": svc._tavily_search_depth,
                            "include_published_date": True,
                        },
                        svc._tavily_timeout_s,
                    )
                    retry_hits = [
                        TavilyResult.model_validate(r)
                        for r in retry_data.get("results", [])
                    ]
                    logger.info(
                        "tavily_retry_done",
                        count=len(retry_hits),
                        query=retry_query[:80],
                        titles=[h.title[:80] for h in retry_hits],
                        tavily_ms=int((time.perf_counter() - _t_retry) * 1000),
                    )
                    if retry_hits:
                        retry_text = "\n\n".join(
                            f"Title: {r.title}\nURL: {r.url}\n"
                            f"Published: {r.published_date or 'unknown'}\n"
                            f"Content: {r.content[:1200]}"
                            for r in retry_hits
                        )
                        retry_user_msg = (
                            f"Today: {date.today().isoformat()}\n"
                            f"Original user query: <user_query>{safe_query}</user_query>\n"
                            f"Search query used: {retry_query}\n"
                            f"Max companies to return: {svc._max_company_results}\n\n"
                            f"Web search results:\n{retry_text}"
                        )
                        retry_llm = _openai_extraction_cb.call(
                            svc._openai.chat.completions.create,
                            model=svc._extraction_model,
                            messages=[
                                {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
                                {"role": "user", "content": retry_user_msg},
                            ],
                            max_tokens=svc._llm_max_tokens,
                            temperature=0,
                            response_format={"type": "json_object"},
                        )
                        retry_raw = ""
                        retry_finish = None
                        if retry_llm.choices and retry_llm.choices[0].message:
                            retry_raw = (retry_llm.choices[0].message.content or "").strip()
                            retry_finish = retry_llm.choices[0].finish_reason
                        if retry_finish == "length":
                            events = _recover_partial_events(retry_raw)
                        else:
                            events = EventExtractionResponse.model_validate_json(
                                retry_raw
                            ).events
                        logger.info(
                            "retry_events_extracted",
                            count=len(events),
                            extraction_ms=int((time.perf_counter() - _t_retry) * 1000),
                        )
                except CircuitOpenError:
                    logger.warning("tavily_or_openai_circuit_open_skipping_retry")
                except Exception as e:
                    logger.warning("extraction_retry_failed", error=str(e))

            if not events:
                return "No structured events could be extracted."

            # Resolve each event's company against OpenSearch.
            resolved: list[dict] = []
            seen_ids: set[str] = set()

            for event in events:
                _event_data = EventData(
                    event_type=event.event_type,
                    amount=event.amount,
                    round=event.round,
                    date=event.date,
                    summary=event.summary,
                    source_url=event.source_url,
                )

                matched = False
                if svc._resolve_to_index:
                    try:
                        resp = svc._opensearch.search(
                            index=svc._index,
                            query={
                                "multi_match": {
                                    "query": event.company_name,
                                    "fields": ["name^3", "domain"],
                                    "type": "best_fields",
                                    "fuzziness": "AUTO",
                                }
                            },
                            size=svc._resolve_per_name,
                        )
                        for hit in resp.get("hits", {}).get("hits", []):
                            doc_id = hit.get("_id")
                            score = float(hit.get("_score", 0))
                            if doc_id not in seen_ids and score > svc._min_resolve_score:
                                seen_ids.add(doc_id)
                                src = hit["_source"]
                                doc = EnrichedCompanyDoc(
                                    id=doc_id,
                                    name=src.get("name", event.company_name),
                                    domain=src.get("domain", ""),
                                    industry=src.get("industry", ""),
                                    country=src.get("country", ""),
                                    locality=src.get("locality", ""),
                                    score=score,
                                    event_data=_event_data,
                                )
                                resolved.append(doc.model_dump())
                                matched = True
                                break
                    except Exception as e:
                        logger.warning(
                            "company_resolution_failed",
                            name=event.company_name,
                            error=str(e),
                        )

                if not matched:
                    # Not in index or resolution disabled — synthetic doc with event data only.
                    synthetic_id = f"synthetic_{hashlib.sha256(event.company_name.encode()).hexdigest()[:16]}"
                    if synthetic_id not in seen_ids:
                        seen_ids.add(synthetic_id)
                        doc = EnrichedCompanyDoc(
                            id=synthetic_id,
                            name=event.company_name,
                            country=event.country or "",
                            locality=event.city or "",
                            score=1.0,
                            event_data=_event_data,
                        )
                        resolved.append(doc.model_dump())

            # Store for _recover_from_steps fallback (markdown observations aren't JSON-parseable).
            # Uses thread-local storage to avoid cross-request contamination.
            if not hasattr(_tl, "last_run_companies"):
                _tl.last_run_companies = []
            _tl.last_run_companies.extend(resolved)

            # Return concise markdown table for the agent (saves tokens vs raw JSON)
            lines = [f"Found {len(resolved)} companies:\n"]
            lines.append("| # | Company | Event | Date | Summary |")
            lines.append("|---|---------|-------|------|---------|")
            for i, c in enumerate(resolved, 1):
                ed = c.get("event_data") or {}
                if isinstance(ed, EventData):
                    ed = ed.model_dump()
                lines.append(
                    f"| {i} | {c.get('name', '?')} | {ed.get('event_type', '')} "
                    f"| {ed.get('date', '')} | {ed.get('summary', '')[:80]} |"
                )
            return "\n".join(lines)

        # ── Tool 2: lookup_companies_by_name ──────────────────────────

        def lookup_companies_by_name(company_names: str) -> str:
            """
            Look up specific companies by name in the internal database.
            Input must be a comma-separated list of company names.
            """
            _emit("tool_start", "Looking up companies in the database…")
            names = [n.strip() for n in company_names.split(",") if n.strip()]
            results: list[dict] = []
            seen_ids: set[str] = set()

            for name in names:
                matched = False
                # Always perform the OpenSearch lookup regardless of _resolve_to_index.
                # _resolve_to_index controls only the auto-resolution inside
                # web_search_company_events. This tool is explicitly invoked by the
                # agent and must always return full indexed documents when available.
                try:
                    resp = svc._opensearch.search(
                        index=svc._index,
                        query={
                            "multi_match": {
                                "query": name,
                                "fields": ["name^3", "domain"],
                                "type": "best_fields",
                                "fuzziness": "AUTO",
                            }
                        },
                        size=svc._resolve_per_name,
                    )
                    for hit in resp.get("hits", {}).get("hits", []):
                        doc_id = hit.get("_id")
                        score = float(hit.get("_score", 0))
                        if doc_id not in seen_ids and score > svc._min_resolve_score:
                            seen_ids.add(doc_id)
                            src = hit["_source"]
                            doc = EnrichedCompanyDoc(
                                id=doc_id,
                                name=src.get("name", name),
                                domain=src.get("domain", ""),
                                industry=src.get("industry", ""),
                                country=src.get("country", ""),
                                locality=src.get("locality", ""),
                                score=score,
                            )
                            results.append(doc.model_dump())
                            matched = True
                except Exception as e:
                    logger.warning("name_lookup_failed", name=name, error=str(e))

                if not matched:
                    synthetic_id = f"synthetic_{hashlib.sha256(name.encode()).hexdigest()[:16]}"
                    if synthetic_id not in seen_ids:
                        seen_ids.add(synthetic_id)
                        doc = EnrichedCompanyDoc(
                            id=synthetic_id,
                            name=name,
                            score=1.0,
                        )
                        results.append(doc.model_dump())

            return json.dumps({"found": len(results), "companies": results})

        # ── Tool 3: linkedin_profile_lookup ────────────────────────────

        def linkedin_profile_lookup(company_name: str) -> str:
            """
            Look up a company's LinkedIn profile to get detailed company
            information: description, headquarters, industry, size,
            specialties, and recent updates.
            """
            _emit("tool_start", f"Fetching LinkedIn profile for {company_name}…")
            import re as _re
            linkedin_url: Optional[str] = None
            company_doc: Optional[dict] = None
            profile_data: Optional[dict] = None
            page_content = ""

            # ── Step 1: OpenSearch lookup to get LinkedIn URL from index ──
            try:
                resp = svc._opensearch.search(
                    index=svc._index,
                    query={
                        "multi_match": {
                            "query": company_name,
                            "fields": ["name^3", "domain"],
                            "type": "best_fields",
                            "fuzziness": "AUTO",
                        }
                    },
                    size=1,
                )
                hits = resp.get("hits", {}).get("hits", [])
                if hits:
                    src = hits[0]["_source"]
                    linkedin_url = src.get("linkedin_url")
                    company_doc = {
                        "id": hits[0].get("_id", ""),
                        "name": src.get("name", company_name),
                        "domain": src.get("domain", ""),
                        "industry": src.get("industry", ""),
                        "country": src.get("country", ""),
                        "locality": src.get("locality", ""),
                        "score": float(hits[0].get("_score", 1.0)),
                    }
            except Exception as e:
                logger.warning("linkedin_opensearch_lookup_failed",
                               name=company_name, error=str(e))

            # ── Step 2: Tavily Search to discover the real LinkedIn URL ──
            if not linkedin_url and svc._tavily_key:
                try:
                    search_data = _call_tavily(
                        "https://api.tavily.com/search",
                        {
                            "api_key": svc._tavily_key,
                            "query": f"{company_name} LinkedIn company page site:linkedin.com/company",
                            "max_results": 3,
                            "include_raw_content": True,
                        },
                        svc._tavily_timeout_s,
                    )
                    search_results = search_data.get("results", [])
                    for sr in search_results:
                        sr_url = sr.get("url", "")
                        if "linkedin.com/company" in sr_url:
                            linkedin_url = sr_url
                            # Grab raw content while we have it (saves an extract call)
                            raw_content = sr.get("raw_content") or sr.get("content", "")
                            if raw_content and len(raw_content) > 100:
                                page_content = raw_content
                            logger.info(
                                "linkedin_tavily_search_discovered",
                                company=company_name,
                                discovered_url=linkedin_url,
                            )
                            break
                    if not linkedin_url:
                        logger.warning(
                            "linkedin_tavily_search_no_url",
                            company=company_name,
                        )
                except CircuitOpenError:
                    logger.warning("tavily_circuit_open_skipping_linkedin_search")
                except Exception as e:
                    logger.warning(
                        "linkedin_tavily_search_failed",
                        company=company_name,
                        error=str(e),
                    )

            # ── Step 3: Tavily Extract to scrape the LinkedIn page ──
            if linkedin_url and not page_content and svc._tavily_key:
                url = linkedin_url if linkedin_url.startswith("http") else f"https://{linkedin_url}"
                logger.info("linkedin_attempting_scrape", company=company_name, url=url)
                try:
                    extract_data = _call_tavily(
                        "https://api.tavily.com/extract",
                        {
                            "api_key": svc._tavily_key,
                            "urls": [url],
                        },
                        svc._tavily_timeout_s,
                    )
                    extract_results = extract_data.get("results", [])
                    page_content = (
                        extract_results[0].get("raw_content", "") if extract_results else ""
                    )
                    if not page_content:
                        logger.warning(
                            "linkedin_tavily_extract_empty",
                            company=company_name,
                            url=url,
                        )
                except CircuitOpenError:
                    logger.warning("tavily_circuit_open_skipping_linkedin_extract")
                except Exception as e:
                    logger.warning(
                        "linkedin_tavily_extract_failed",
                        company=company_name,
                        url=url,
                        error=str(e),
                    )

            # ── Step 4: General web search fallback (about the company) ──
            if not page_content and svc._tavily_key:
                try:
                    fallback_data = _call_tavily(
                        "https://api.tavily.com/search",
                        {
                            "api_key": svc._tavily_key,
                            "query": f"{company_name} company overview about",
                            "max_results": 3,
                            "include_raw_content": True,
                        },
                        svc._tavily_timeout_s,
                    )
                    fallback_results = fallback_data.get("results", [])
                    for fr in fallback_results:
                        raw_content = fr.get("raw_content") or fr.get("content", "")
                        if raw_content and len(raw_content) > 100:
                            page_content = raw_content
                            logger.info(
                                "linkedin_web_fallback_hit",
                                company=company_name,
                                source_url=fr.get("url", ""),
                            )
                            break
                    if not page_content:
                        logger.warning(
                            "linkedin_web_fallback_empty",
                            company=company_name,
                        )
                except CircuitOpenError:
                    logger.warning("tavily_circuit_open_skipping_linkedin_fallback")
                except Exception as e:
                    logger.warning(
                        "linkedin_web_fallback_failed",
                        company=company_name,
                        error=str(e),
                    )

            # ── Step 5: LLM extraction from whatever content we got ──
            if page_content:
                try:
                    display_url = linkedin_url or "not found"
                    user_msg = (
                        f"Company: {company_name}\n"
                        f"LinkedIn URL: {display_url}\n\n"
                        f"Page content:\n{page_content[:3000]}"
                    )
                    llm_resp = _openai_extraction_cb.call(
                        svc._openai.chat.completions.create,
                        model=svc._extraction_model,
                        messages=[
                            {"role": "system", "content": _LINKEDIN_EXTRACTION_PROMPT},
                            {"role": "user", "content": user_msg},
                        ],
                        max_tokens=600,
                        temperature=0,
                        response_format={"type": "json_object"},
                    )
                    if not llm_resp.choices or not llm_resp.choices[0].message:
                        logger.error("llm_empty_response_linkedin_extraction",
                                     company=company_name)
                        raise ValueError("Empty LLM response")
                    raw = (llm_resp.choices[0].message.content or "").strip()
                    profile_data = LinkedInProfile.model_validate_json(raw).model_dump()
                    logger.info(
                        "linkedin_profile_extracted",
                        company=company_name,
                        url=linkedin_url or "web_fallback",
                    )
                except Exception as e:
                    logger.warning(
                        "linkedin_llm_extraction_failed",
                        company=company_name,
                        error=str(e),
                    )
            else:
                logger.warning(
                    "linkedin_no_page_content",
                    company=company_name,
                )

            # ── Build result ──
            if company_doc:
                result = dict(company_doc)
            else:
                synthetic_id = f"synthetic_{hashlib.sha256(company_name.encode()).hexdigest()[:16]}"
                result = {
                    "id": synthetic_id,
                    "name": company_name,
                    "domain": "",
                    "industry": "",
                    "country": "",
                    "locality": "",
                    "score": 1.0,
                }
            if profile_data:
                result["linkedin_profile"] = profile_data
            if linkedin_url:
                result["linkedin_url"] = linkedin_url

            return json.dumps({"found": 1, "companies": [result]})

        # ── Tool 4: submit_final_results ──────────────────────────────

        def submit_final_results(results_json: str = "[]") -> str:
            """
            Submit the final list of companies as the search answer.
            Must be a JSON array of company objects. Call this LAST.
            """
            # Handle non-string input defensively (LangChain edge cases).
            if not isinstance(results_json, str):
                if isinstance(results_json, list):
                    return json.dumps(results_json)
                if isinstance(results_json, dict):
                    return json.dumps(results_json.get("companies", []))
                return "[]"

            # Sanitize literal control characters (e.g. raw \n inside LLM-generated
            # summary strings) that break JSON parsers. Replacing them with a space
            # preserves both string content and JSON structure.
            sanitized = results_json.replace("\r", " ").replace("\t", " ").replace("\n", " ")

            try:
                parsed = json.loads(sanitized)
                if isinstance(parsed, list):
                    return sanitized
                if isinstance(parsed, dict) and "companies" in parsed:
                    return json.dumps(parsed["companies"])
                return "[]"
            except Exception as e:
                logger.warning(
                    "submit_final_results_invalid_json",
                    error=str(e),
                    snippet=sanitized[:200],
                )
                # Return the sanitized raw string — run() will fall back to
                # _recover_from_steps which has the web_search results.
                return sanitized

        return [
            StructuredTool.from_function(
                func=web_search_company_events,
                name="web_search_company_events",
                description=(
                    "Search the web for recent company events (funding, acquisitions, IPOs, "
                    "product launches, layoffs, expansions) and match results against the "
                    "internal company database. Use for any query about company news or events."
                ),
                args_schema=WebSearchInput,
            ),
            StructuredTool.from_function(
                func=lookup_companies_by_name,
                name="lookup_companies_by_name",
                description=(
                    "Look up specific companies by name in the internal database to retrieve "
                    "full profiles: industry, country, employee count, size range, etc. "
                    "Input: comma-separated company names."
                ),
                args_schema=LookupNamesInput,
            ),
            StructuredTool.from_function(
                func=linkedin_profile_lookup,
                name="linkedin_profile_lookup",
                description=(
                    "Look up a company's LinkedIn profile to get detailed information: "
                    "description, headquarters, industry, company size, specialties, "
                    "and recent updates. Use for queries asking about a specific company's "
                    "profile or details."
                ),
                args_schema=LinkedInLookupInput,
            ),
            # submit_final_results has been removed — _recover_from_steps() collects
            # results from tool observations, eliminating the need for an explicit
            # submission step and saving one LLM turn per request.
        ]

    # ------------------------------------------------------------------
    # Output normalisation
    # ------------------------------------------------------------------

    def _recover_from_steps(self, steps: list) -> list[dict[str, Any]]:
        """
        Primary result collection path: extract companies from tool observations.

        Without submit_final_results, this is always how the flex agent returns
        results — the agent's text output is ignored and tool observations are
        used directly.

        Tool-aware priority order:
          1. lookup_companies_by_name results — full indexed docs, highest quality
          2. web_search_company_events results — from thread-local _tl.last_run_companies
          3. Any other JSON-returning tool observations
        """
        all_companies: list[dict] = []
        seen_ids: set[str] = set()
        lookup_companies: list[dict] = []

        # ── Priority 1: lookup_companies_by_name JSON observations ──
        # These are full OpenSearch docs with domain/industry/country fields.
        for action, observation in steps:
            tool_name = getattr(action, "tool", "") if hasattr(action, "tool") else ""
            if tool_name != "lookup_companies_by_name":
                continue
            if not isinstance(observation, str):
                continue
            try:
                parsed = json.loads(observation)
                companies = parsed.get("companies", []) if isinstance(parsed, dict) else []
                for c in companies:
                    cid = c.get("id") or c.get("_id", "")
                    if cid and cid not in seen_ids:
                        seen_ids.add(cid)
                        lookup_companies.append(c)
            except (json.JSONDecodeError, AttributeError):
                continue

        if lookup_companies:
            logger.info("agent_recovered_from_lookup_tool", count=len(lookup_companies))
            all_companies.extend(lookup_companies)

        # ── Priority 2: web_search results stored in thread-local ──
        for c in getattr(_tl, "last_run_companies", []):
            cid = c.get("id") or c.get("_id", "")
            if cid and cid not in seen_ids:
                seen_ids.add(cid)
                all_companies.append(c)

        # ── Priority 3: Any other JSON tool observations ──
        for action, observation in steps:
            tool_name = getattr(action, "tool", "") if hasattr(action, "tool") else ""
            if tool_name == "lookup_companies_by_name":
                continue  # already processed above
            if not isinstance(observation, str):
                continue
            try:
                parsed = json.loads(observation)
                companies = (
                    parsed.get("companies", [])
                    if isinstance(parsed, dict)
                    else (parsed if isinstance(parsed, list) else [])
                )
                for c in companies:
                    cid = c.get("id") or c.get("_id", "")
                    if cid and cid not in seen_ids:
                        seen_ids.add(cid)
                        all_companies.append(c)
            except (json.JSONDecodeError, AttributeError):
                continue

        if all_companies:
            logger.info("agent_recovered_from_steps", count=len(all_companies))
        else:
            logger.warning("agent_produced_no_results")
        return self._normalise_output(all_companies)

    def _normalise_output(self, raw_list: list) -> list[dict[str, Any]]:
        """
        Convert EnrichedCompanyDoc dicts to the OpenSearch-hit format that
        AgenticSearchStrategy._docs_to_results() already understands:
          {"_id": ..., "_score": ..., "name": ..., ..., "_event_data": {...}}
        """
        normalised = []
        for item in raw_list:
            try:
                doc = EnrichedCompanyDoc.model_validate(item)
                entry: dict[str, Any] = {
                    "_id": doc.id,
                    "_score": doc.score,
                    "name": doc.name,
                    "domain": doc.domain or "",
                    "industry": doc.industry or "",
                    "country": doc.country or "",
                    "locality": doc.locality or "",
                }
                if doc.event_data:
                    entry["_event_data"] = doc.event_data.model_dump()
                if doc.linkedin_profile:
                    entry["_linkedin_profile"] = doc.linkedin_profile
                normalised.append(entry)
            except Exception as e:
                logger.warning("output_normalisation_failed", error=str(e))
                normalised.append(item)
        return normalised
