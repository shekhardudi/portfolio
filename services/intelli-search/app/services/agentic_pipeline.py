"""
Deterministic async pipeline for event-type agentic queries.

Replaces the LangChain ReAct agent for ~85% of agentic queries that follow
a predictable pattern: search → extract → resolve.

Architecture:
  Phase 1 [parallel]:  Two Tavily searches fired simultaneously
  Phase 2 [serial]:    Merge + deduplicate, single GPT-4o-mini extraction
  Phase 3 [parallel]:  OpenSearch _msearch (batch resolve all names at once)
                       + optional semantic prefetch (background fallback)
  Phase 4:             Return enriched docs in the format _docs_to_results() expects

Benefits over ReAct agent:
  - 3-6× faster: eliminates 3 GPT-4o reasoning turns (2 mini calls vs 5-6 full GPT-4o)
  - Predictable latency: no max_iterations variability
  - Fully async-native: no ThreadPoolExecutor wrapper needed
  - Simpler debuggability: linear flow, each phase emits progress naturally

Output format is compatible with AgenticSearchStrategy._docs_to_results():
  {"_id": ..., "_score": ..., "name": ..., "domain": ..., "industry": ...,
   "country": ..., "locality": ..., "_event_data": {...}}
"""

import asyncio
import hashlib
import json
import re as _re
import structlog
import time
from datetime import date
from pathlib import Path
from typing import Any, Literal, Optional, TYPE_CHECKING

from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import get_settings, get_search_config
from app.services.pii_service import detect_pii
from app.services.search_strategies import EventData
from app.services.serpapi_client import SerpApiClient
from app.services.tavily_client import TavilyClient
from app.services.web_search import WebSearchProvider

if TYPE_CHECKING:
    from app.services.intent_classifier import QueryIntent

logger = structlog.get_logger(__name__)

# ── Boundary models (formerly in agent_service) ──────────────────────────────


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


# ── Prompts loaded from disk (formerly in agent_service) ─────────────────────

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

_EXTRACTION_SYSTEM_PROMPT: str = (_PROMPTS_DIR / "agent_extraction.txt").read_text(encoding="utf-8")
_LINKEDIN_EXTRACTION_PROMPT: str = (_PROMPTS_DIR / "agent_linkedin_extraction.txt").read_text(encoding="utf-8")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _recover_partial_events(raw: str) -> list[CompanyEvent]:
    """Try to salvage complete events from truncated JSON output."""
    events: list[CompanyEvent] = []
    for m in _re.finditer(r'\{[^{}]*"company_name"\s*:[^{}]+\}', raw):
        try:
            events.append(CompanyEvent.model_validate_json(m.group()))
        except Exception:
            continue
    return events


class AgenticPipeline:
    """
    Deterministic async pipeline for event-type agentic queries.
    Stateless between calls — safe to share across concurrent requests.
    """

    def __init__(
        self,
        opensearch_service: Any,
        openai_api_key: str,
        tavily_key: Optional[str],
        cache_service: Any = None,
        embedding_service: Any = None,
        serpapi_key: Optional[str] = None,
    ) -> None:
        cfg = get_search_config().get("agentic", {})
        self._opensearch = opensearch_service
        self._index = get_settings().OPENSEARCH_INDEX_NAME
        self._cache = cache_service
        self._embeddings = embedding_service

        # Config — read from search_config.yaml with sensible defaults
        self._max_results: int = int(cfg.get("tavily_max_results", 6))
        self._search_depth: str = str(cfg.get("tavily_search_depth", "basic"))
        self._timeout_s: int = int(cfg.get("tavily_timeout_s", 8))
        self._cache_ttl_s: int = int(cfg.get("tavily_cache_ttl_s", 300))
        self._content_chars: int = int(cfg.get("content_chars", 800))
        # SerpAPI-specific: AI Mode summary slot gets a much larger window;
        # citations get a small per-item cap. When no summary slot is present
        # (Tavily path), _content_chars is used uniformly.
        self._summary_chars: int = int(cfg.get("summary_chars", 6000))
        self._citation_chars: int = int(cfg.get("citation_chars", 400))
        self._resolve_per_name: int = int(cfg.get("resolve_per_name", 5))
        self._min_resolve_score: float = float(cfg.get("min_resolve_score", 0.5))
        # When False, _batch_resolve skips OpenSearch entirely and returns synthetic
        # docs with event data only — mirrors agent_service's resolve_to_index flag.
        self._resolve_to_index: bool = bool(cfg.get("resolve_to_index", True))
        self._max_company_results: int = int(cfg.get("max_company_results", 20))
        self._llm_max_tokens: int = int(cfg.get("llm_max_tokens", 2048))
        self._extraction_model: str = str(cfg.get("extraction_model", "gpt-4o-mini"))

        # LinkedIn enrichment knobs (Phase 3)
        _li_cfg = cfg.get("linkedin", {}) if isinstance(cfg.get("linkedin"), dict) else {}
        self._linkedin_max_companies: int = int(_li_cfg.get("max_companies", 3))
        self._linkedin_content_chars: int = int(_li_cfg.get("content_chars", 3000))
        self._linkedin_llm_max_tokens: int = int(_li_cfg.get("llm_max_tokens", 600))

        # Semantic prefetch knobs (Phase 4)
        _sp_cfg = cfg.get("semantic_prefetch", {}) if isinstance(cfg.get("semantic_prefetch"), dict) else {}
        self._semantic_prefetch_k: int = int(_sp_cfg.get("k", 50))
        self._semantic_prefetch_size: int = int(_sp_cfg.get("size", 20))

        # Async OpenAI client — one per pipeline instance, connection-pooled
        self._openai = AsyncOpenAI(api_key=openai_api_key)

        # Tavily client — always instantiated; used unconditionally for
        # LinkedIn /extract calls and as the default search provider.
        self._tavily = TavilyClient(
            api_key=tavily_key,
            timeout_s=self._timeout_s,
            search_depth=self._search_depth,
            max_results=self._max_results,
        )

        # SerpAPI client — instantiated when configured. Used as the search
        # provider when web_search.provider == "serpapi".
        _sp_cfg = cfg.get("serpapi", {}) if isinstance(cfg.get("serpapi"), dict) else {}
        self._serpapi = SerpApiClient(
            api_key=serpapi_key,
            timeout_s=int(_sp_cfg.get("timeout_s", 10)),
            max_results=int(_sp_cfg.get("max_results", 10)),
            gl=str(_sp_cfg.get("gl", "us")),
            hl=str(_sp_cfg.get("hl", "en")),
            location=_sp_cfg.get("location") or None,
        )

        # Provider selection — config-driven, with safe fallback to Tavily
        # when SerpAPI is requested but no API key is present.
        _ws_cfg = cfg.get("web_search", {}) if isinstance(cfg.get("web_search"), dict) else {}
        provider_name = str(_ws_cfg.get("provider", "tavily")).strip().lower()
        if provider_name == "serpapi" and not self._serpapi.enabled:
            logger.warning(
                "agentic_search_provider_misconfigured_falling_back",
                requested="serpapi",
                reason="SERPAPI_API_KEY missing",
                fallback="tavily",
            )
            provider_name = "tavily"
        self._search: WebSearchProvider = (
            self._serpapi if provider_name == "serpapi" else self._tavily
        )
        self._provider_name = provider_name
        logger.info("agentic_search_provider_selected", provider=provider_name)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(
        self,
        query: str,
        intent: "QueryIntent",
        progress_callback: Optional[Any] = None,
    ) -> list[dict]:
        """
        Run the deterministic pipeline.

        Returns a list of dicts compatible with
        AgenticSearchStrategy._docs_to_results():
          {_id, _score, name, domain, industry, country, locality, _event_data}
        """
        pii_types = detect_pii(query)
        if pii_types:
            logger.warning("pipeline_query_pii_blocked", pii_types=pii_types)
            return []

        def _emit(phase: str, message: str) -> None:
            if progress_callback:
                try:
                    progress_callback(phase, message)
                except Exception:
                    pass

        t0 = time.perf_counter()

        # Phase 0 — LinkedIn enrichment branch.
        # When the classifier identifies specific named companies the user
        # cares about, prefer the per-company enrichment path. We still run
        # event extraction afterwards so funding/news context can attach to
        # the same companies, but if enrichment yields results we return
        # them as the authoritative answer (matches the old flex-path behaviour).
        named_companies = list(getattr(intent, "named_companies", []) or [])
        if named_companies:
            _emit(
                "enriching",
                f"Looking up LinkedIn profile(s) for {len(named_companies)} company(ies)…",
            )
            enriched = await self._enrich_named_companies(named_companies)
            if enriched:
                logger.info(
                    "pipeline_linkedin_enriched",
                    query=query[:80],
                    requested=len(named_companies),
                    enriched=len(enriched),
                    total_ms=int((time.perf_counter() - t0) * 1000),
                )
                return enriched
            logger.info(
                "pipeline_linkedin_no_results_falling_back_to_events",
                query=query[:80],
                companies=named_companies,
            )

        # For SerpAPI Google AI Mode we want the natural-language user query
        # (it includes location + timeframe the intent classifier strips into
        # structured filters). For Tavily — a keyword engine — the optimised
        # query is still better.
        if self._provider_name == "serpapi":
            primary_q = query
        else:
            primary_q = intent.search_query or query
        secondary_q = self._build_secondary_query(query, primary_q)

        # Phase 1: Parallel Tavily + background semantic prefetch
        _emit("searching", "Searching the web for recent company events…")

        semantic_task: Optional[asyncio.Task] = (
            asyncio.create_task(self._semantic_prefetch(primary_q))
            if self._embeddings else None
        )

        all_hits = await self._parallel_web_search(primary_q, secondary_q)

        if not all_hits:
            logger.info("pipeline_no_web_hits", query=query[:80], provider=self._provider_name)
            _emit("fallback", "No web results found, using semantic search…")
            if semantic_task:
                return await semantic_task
            return []

        # Phase 2: Single GPT-4o-mini extraction call
        safe_query = query[:300].replace("\n", " ").replace("\r", " ")
        _emit("extracting", f"Analysing {len(all_hits)} web result(s) for company events…")
        events = await self._extract_events(safe_query, primary_q, all_hits)

        if not events:
            logger.info("pipeline_no_events_extracted", query=query[:80])
            _emit("fallback", "No events extracted, using semantic search…")
            if semantic_task:
                return await semantic_task
            return []

        # Phase 3: Batch resolve all company names in one OpenSearch _msearch call
        _emit("resolving", f"Resolving {len(events)} company name(s) in the database…")
        resolved = await self._batch_resolve(events)

        # Cancel semantic prefetch — no longer needed
        if semantic_task and not semantic_task.done():
            semantic_task.cancel()
            try:
                await semantic_task
            except asyncio.CancelledError:
                pass

        logger.info(
            "pipeline_completed",
            query=query[:80],
            events=len(events),
            resolved=len(resolved),
            total_ms=int((time.perf_counter() - t0) * 1000),
        )
        return resolved

    # ------------------------------------------------------------------
    # Phase 1 — Parallel Tavily searches
    # ------------------------------------------------------------------

    def _build_secondary_query(self, original_query: str, primary_q: str) -> Optional[str]:
        """
        Build a secondary Tavily search query.

        If the intent's optimized query differs from the user's original query,
        use the original as the secondary search — captures articles that
        describe events in natural language the LLM might have optimised away.

        Skipped entirely for SerpAPI: Google AI Mode already aggregates multiple
        sub-queries server-side, so a second call returns near-identical content
        that gets thrown away by URL dedup — wasted spend.
        """
        if self._provider_name == "serpapi":
            return None
        orig = original_query.strip()
        prim = primary_q.strip()
        if orig and orig.lower() != prim.lower():
            return orig
        return None

    async def _parallel_web_search(
        self,
        primary_q: str,
        secondary_q: Optional[str],
    ) -> list[TavilyResult]:
        """
        Fire primary and secondary web searches simultaneously against the
        configured provider (Tavily or SerpAPI). Deduplicate by URL —
        primary results take precedence.
        """
        if not self._search.enabled:
            return []

        if secondary_q:
            results = await asyncio.gather(
                self._web_search(primary_q),
                self._web_search(secondary_q),
                return_exceptions=True,
            )
            primary_hits: list[TavilyResult] = (
                results[0] if not isinstance(results[0], BaseException) else []
            )
            secondary_hits: list[TavilyResult] = (
                results[1] if not isinstance(results[1], BaseException) else []
            )
        else:
            primary_hits = await self._web_search(primary_q)
            secondary_hits = []

        # Deduplicate by URL
        seen_urls: set[str] = set()
        merged: list[TavilyResult] = []
        for hit in list(primary_hits) + list(secondary_hits):
            url = hit.url.strip()
            if url and url not in seen_urls:
                seen_urls.add(url)
                merged.append(hit)

        logger.info(
            "pipeline_web_search_merged",
            provider=self._provider_name,
            primary=len(primary_hits),
            secondary=len(secondary_hits),
            deduped_total=len(merged),
            primary_query=primary_q[:80],
        )
        return merged

    async def _web_search(self, query: str) -> list[TavilyResult]:
        """
        Single web search via the configured provider, with Redis caching.
        Returns ``[]`` on any failure or breaker-open state.
        """
        # ── Cache lookup ──
        cache_key = self._web_search_cache_key(query)
        if self._cache:
            cached = self._cache.get(cache_key)
            if cached:
                try:
                    data = json.loads(cached)
                    hits = [TavilyResult.model_validate(r) for r in data.get("results", [])]
                    logger.info(
                        "pipeline_web_search_cache_hit",
                        provider=self._provider_name,
                        query=query[:80],
                        hits=len(hits),
                    )
                    return hits
                except Exception:
                    pass  # Corrupt cache — re-fetch

        # ── Provider call (client owns breaker + retry + threading) ──
        data = await self._search.asearch(query)
        if not data:
            return []
        if self._cache:
            try:
                self._cache.set(cache_key, json.dumps(data), ttl=self._cache_ttl_s)
            except Exception:
                pass
        return [TavilyResult.model_validate(r) for r in data.get("results", [])]

    def _web_search_cache_key(self, query: str) -> str:
        """Deterministic Redis key for a web-search query (provider-scoped)."""
        raw = json.dumps(
            {
                "q": query.strip().lower(),
                "provider": self._provider_name,
                "depth": self._search_depth,
                "max": self._max_results,
            },
            sort_keys=True,
        )
        digest = hashlib.sha256(raw.encode()).hexdigest()[:24]
        return f"intelli-search:websearch:{self._provider_name}:{digest}"

    # ------------------------------------------------------------------
    # Phase 2 — LLM extraction
    # ------------------------------------------------------------------

    async def _extract_events(
        self,
        safe_query: str,
        search_query: str,
        hits: list[TavilyResult],
    ) -> list[CompanyEvent]:
        """
        Single GPT-4o-mini extraction call over all merged Tavily results.
        Uses the same agent_extraction.txt prompt as the ReAct agent.
        """
        # When the SerpAPI Google AI Mode summary is present (always pinned at
        # slot 0), render it under its own header with a much larger char
        # budget so the dense answer body isn't truncated. Citations follow
        # under a separate header with a tight per-item cap.
        ai_summary: Optional[TavilyResult] = None
        citations: list[TavilyResult] = list(hits)
        if hits and hits[0].title == "Google AI Mode summary":
            ai_summary = hits[0]
            citations = list(hits[1:])

        citation_cap = self._citation_chars if ai_summary else self._content_chars
        if ai_summary:
            # AI Mode summary already contains the facts; citations are evidence
            # only — strip their content to cut input tokens (and latency).
            citations_text = "\n".join(
                f"- {r.title} | {r.url}"
                f"{(' | ' + r.published_date) if r.published_date else ''}"
                for r in citations
            )
        else:
            citations_text = "\n\n".join(
                f"Title: {r.title}\nURL: {r.url}\n"
                f"Published: {r.published_date or 'unknown'}\n"
                f"Content: {r.content[:citation_cap]}"
                for r in citations
            )

        if ai_summary:
            results_text = (
                "=== Primary AI answer (authoritative; extract every named company) ===\n"
                f"Source: {ai_summary.url}\n"
                f"{ai_summary.content[:self._summary_chars]}\n\n"
                "=== Supporting citations ===\n"
                f"{citations_text}"
            )
        else:
            results_text = citations_text

        user_msg = (
            f"Today: {date.today().isoformat()}\n"
            f"Original user query: <user_query>{safe_query}</user_query>\n"
            f"Search query used: {search_query}\n"
            f"Max companies to return: {self._max_company_results}\n\n"
            f"Web search results:\n{results_text}"
        )

        t_llm = time.perf_counter()
        raw = ""
        try:
            resp = await self._openai.chat.completions.create(
                model=self._extraction_model,
                messages=[
                    {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=self._llm_max_tokens,
                temperature=0,
                response_format={"type": "json_object"},
            )

            if not resp.choices or not resp.choices[0].message:
                logger.error("pipeline_extraction_empty_llm_response",
                             model=self._extraction_model)
                return []

            raw = (resp.choices[0].message.content or "").strip()
            finish_reason = resp.choices[0].finish_reason
            usage = resp.usage

            logger.info(
                "pipeline_extraction_done",
                model=self._extraction_model,
                finish_reason=finish_reason,
                input_tokens=usage.prompt_tokens if usage else None,
                output_tokens=usage.completion_tokens if usage else None,
                extraction_ms=int((time.perf_counter() - t_llm) * 1000),
            )

            if finish_reason == "length":
                # Output was truncated — recover complete events from partial JSON
                events = _recover_partial_events(raw)
                logger.warning("pipeline_extraction_truncated", recovered=len(events))
                return events

            extracted = EventExtractionResponse.model_validate_json(raw)
            return extracted.events

        except Exception as exc:
            logger.error("pipeline_extraction_failed", error=str(exc))
            if raw:
                return _recover_partial_events(raw)
            return []

    # ------------------------------------------------------------------
    # Phase 3 — Batch OpenSearch resolve
    # ------------------------------------------------------------------

    async def _batch_resolve(self, events: list[CompanyEvent]) -> list[dict]:
        """
        Resolve all event company names in a single OpenSearch _msearch call
        instead of N sequential search() calls.

        When resolve_to_index=false in search_config.yaml, the OpenSearch lookup
        is skipped entirely and every company is returned as a synthetic doc
        (event data preserved, index metadata omitted).

        Falls back to synthetic docs for individual companies not found in the index.
        """
        if not events:
            return []

        if not self._resolve_to_index:
            logger.info(
                "pipeline_msearch_skipped_resolve_to_index_false",
                events=len(events),
            )
            return self._make_synthetic_docs(events)

        # Build the _msearch body — alternating header + query per event
        msearch_body: list[dict] = []
        for event in events:
            msearch_body.append({"index": self._index})
            msearch_body.append({
                "query": {
                    "multi_match": {
                        "query": event.company_name,
                        "fields": ["name^3", "domain"],
                        "type": "best_fields",
                        "fuzziness": "AUTO",
                    }
                },
                "size": self._resolve_per_name,
            })

        try:
            response = await asyncio.to_thread(
                self._opensearch.client.msearch,
                body=msearch_body,
            )
            sub_responses: list[dict] = response.get("responses", [])
        except Exception as exc:
            logger.warning("pipeline_msearch_failed", error=str(exc))
            # Best-effort: fall back to synthetic docs for all events
            return self._make_synthetic_docs(events)

        # Build enriched result list
        resolved: list[dict] = []
        seen_ids: set[str] = set()

        for event, sub_resp in zip(events, sub_responses):
            event_data_dict = EventData(
                event_type=event.event_type,
                amount=event.amount,
                round=event.round,
                date=event.date,
                summary=event.summary,
                source_url=event.source_url,
            ).model_dump()

            matched = False
            hits = (
                sub_resp.get("hits", {}).get("hits", [])
                if not sub_resp.get("error")
                else []
            )
            for hit in hits:
                doc_id = hit.get("_id")
                score = float(hit.get("_score", 0))
                if doc_id and doc_id not in seen_ids and score >= self._min_resolve_score:
                    seen_ids.add(doc_id)
                    src = hit.get("_source", {})
                    resolved.append({
                        "_id": doc_id,
                        "_score": score,
                        "name": src.get("name", event.company_name),
                        "domain": src.get("domain", ""),
                        "industry": src.get("industry", ""),
                        "country": src.get("country", ""),
                        "locality": src.get("locality", ""),
                        "_event_data": event_data_dict,
                    })
                    matched = True
                    break  # Take only the best match per event

            if not matched:
                # Not found in index — synthetic doc preserves event data
                synthetic_id = (
                    f"synthetic_{hashlib.sha256(event.company_name.encode()).hexdigest()[:16]}"
                )
                if synthetic_id not in seen_ids:
                    seen_ids.add(synthetic_id)
                    resolved.append({
                        "_id": synthetic_id,
                        "_score": 1.0,
                        "name": event.company_name,
                        "domain": "",
                        "industry": "",
                        "country": event.country or "",
                        "locality": event.city or "",
                        "_event_data": event_data_dict,
                    })

        logger.info(
            "pipeline_msearch_resolved",
            events=len(events),
            indexed=sum(1 for r in resolved if not r["_id"].startswith("synthetic_")),
            synthetic=sum(1 for r in resolved if r["_id"].startswith("synthetic_")),
        )
        return resolved

    def _make_synthetic_docs(self, events: list[CompanyEvent]) -> list[dict]:
        """Build synthetic docs for all events (used when _msearch fails entirely)."""
        resolved: list[dict] = []
        seen_ids: set[str] = set()
        for event in events:
            event_data_dict = EventData(
                event_type=event.event_type,
                amount=event.amount,
                round=event.round,
                date=event.date,
                summary=event.summary,
                source_url=event.source_url,
            ).model_dump()
            synthetic_id = (
                f"synthetic_{hashlib.sha256(event.company_name.encode()).hexdigest()[:16]}"
            )
            if synthetic_id not in seen_ids:
                seen_ids.add(synthetic_id)
                resolved.append({
                    "_id": synthetic_id,
                    "_score": 1.0,
                    "name": event.company_name,
                    "domain": "",
                    "industry": "",
                    "country": event.country or "",
                    "locality": event.city or "",
                    "_event_data": event_data_dict,
                })
        return resolved

    # ------------------------------------------------------------------
    # Background — Semantic prefetch (zero-latency fallback)
    # ------------------------------------------------------------------

    async def _semantic_prefetch(self, query: str) -> list[dict]:
        """
        Semantic kNN search running in parallel with Tavily (zero extra latency).
        Used as a fallback when Tavily returns no usable results.
        Returns results in the same format as _batch_resolve().
        """
        if not self._embeddings:
            return []
        try:
            embedding = await asyncio.to_thread(self._embeddings.embed, query)
            response = await asyncio.to_thread(
                self._opensearch.search,
                index=self._index,
                body={
                    "query": {
                        "knn": {
                            "vector_embedding": {
                                "vector": embedding,
                                "k": self._semantic_prefetch_k,
                            }
                        }
                    }
                },
                size=self._semantic_prefetch_size,
            )
            results: list[dict] = []
            for hit in response.get("hits", {}).get("hits", []):
                src = hit.get("_source", {})
                results.append({
                    "_id": hit.get("_id", ""),
                    "_score": float(hit.get("_score", 0)),
                    "name": src.get("name", ""),
                    "domain": src.get("domain", ""),
                    "industry": src.get("industry", ""),
                    "country": src.get("country", ""),
                    "locality": src.get("locality", ""),
                })
            logger.info("pipeline_semantic_prefetch_done", hits=len(results))
            return results
        except asyncio.CancelledError:
            return []
        except Exception as exc:
            logger.warning("pipeline_semantic_prefetch_failed", error=str(exc))
            return []

    # ------------------------------------------------------------------
    # LinkedIn enrichment (Phase 3) — replaces the LangChain
    # ``linkedin_profile_lookup`` tool. One async coroutine per company,
    # all run concurrently with ``asyncio.gather``. Sync HTTP and
    # synchronous OpenSearch calls are wrapped at the leaf via
    # ``asyncio.to_thread`` so the event loop stays responsive.
    # ------------------------------------------------------------------

    async def _enrich_named_companies(self, company_names: list[str]) -> list[dict]:
        """Resolve up to ``linkedin.max_companies`` named companies to enriched docs.

        Output dicts use the same shape as ``_batch_resolve`` so the existing
        ``_docs_to_results`` consumer needs no changes — the only difference
        is the ``_linkedin_profile`` field replacing ``_event_data``.
        """
        if not company_names:
            return []
        names = company_names[: self._linkedin_max_companies]
        results = await asyncio.gather(
            *(self._enrich_one_company(name) for name in names),
            return_exceptions=True,
        )
        out: list[dict] = []
        seen: set[str] = set()
        for name, res in zip(names, results):
            if isinstance(res, BaseException):
                logger.warning(
                    "pipeline_linkedin_enrich_failed",
                    company=name,
                    error=str(res),
                )
                continue
            if not res:
                continue
            doc_id = res.get("_id")
            if doc_id and doc_id not in seen:
                seen.add(doc_id)
                out.append(res)
        return out

    async def _enrich_one_company(self, company_name: str) -> Optional[dict]:
        """Discover URL → scrape → LLM-extract a single LinkedIn profile."""
        linkedin_url: Optional[str] = None
        company_doc: Optional[dict] = None
        page_content = ""

        # Step 1: OpenSearch lookup for an indexed linkedin_url
        try:
            resp = await asyncio.to_thread(
                self._opensearch.search,
                index=self._index,
                body={
                    "query": {
                        "multi_match": {
                            "query": company_name,
                            "fields": ["name^3", "domain"],
                            "type": "best_fields",
                            "fuzziness": "AUTO",
                        }
                    }
                },
                size=1,
            )
            hits = resp.get("hits", {}).get("hits", [])
            if hits:
                src = hits[0].get("_source", {})
                linkedin_url = src.get("linkedin_url")
                company_doc = {
                    "_id": hits[0].get("_id", ""),
                    "_score": float(hits[0].get("_score", 1.0)),
                    "name": src.get("name", company_name),
                    "domain": src.get("domain", ""),
                    "industry": src.get("industry", ""),
                    "country": src.get("country", ""),
                    "locality": src.get("locality", ""),
                }
        except Exception as exc:
            logger.warning(
                "pipeline_linkedin_opensearch_lookup_failed",
                company=company_name,
                error=str(exc),
            )

        # Step 2: Web search to discover the LinkedIn URL (uses configured provider)
        if not linkedin_url and self._search.enabled:
            search_data = await self._search.asearch(
                f"{company_name} LinkedIn company page site:linkedin.com/company",
                max_results=3,
                include_raw_content=True,
            )
            for sr in search_data.get("results", []):
                sr_url = sr.get("url", "")
                if "linkedin.com/company" in sr_url:
                    linkedin_url = sr_url
                    raw = sr.get("raw_content") or sr.get("content", "")
                    if raw and len(raw) > 100:
                        page_content = raw
                    break

        # Step 3: Tavily extract on the discovered URL
        if linkedin_url and not page_content and self._tavily.enabled:
            url = (
                linkedin_url
                if linkedin_url.startswith("http")
                else f"https://{linkedin_url}"
            )
            extract_data = await self._tavily.aextract(url)
            extract_results = extract_data.get("results", [])
            page_content = (
                extract_results[0].get("raw_content", "") if extract_results else ""
            )

        # Step 4: General-web fallback when LinkedIn is unreachable (configured provider)
        if not page_content and self._search.enabled:
            fb = await self._search.asearch(
                f"{company_name} company overview about",
                max_results=3,
                include_raw_content=True,
            )
            for fr in fb.get("results", []):
                raw = fr.get("raw_content") or fr.get("content", "")
                if raw and len(raw) > 100:
                    page_content = raw
                    break

        # Step 5: LLM extraction
        profile_data: Optional[dict] = None
        if page_content:
            try:
                user_msg = (
                    f"Company: {company_name}\n"
                    f"LinkedIn URL: {linkedin_url or 'not found'}\n\n"
                    f"Page content:\n{page_content[: self._linkedin_content_chars]}"
                )
                llm_resp = await self._openai.chat.completions.create(
                    model=self._extraction_model,
                    messages=[
                        {"role": "system", "content": _LINKEDIN_EXTRACTION_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    max_tokens=self._linkedin_llm_max_tokens,
                    temperature=0,
                    response_format={"type": "json_object"},
                )
                if llm_resp.choices and llm_resp.choices[0].message:
                    raw = (llm_resp.choices[0].message.content or "").strip()
                    profile_data = LinkedInProfile.model_validate_json(raw).model_dump()
            except Exception as exc:
                logger.warning(
                    "pipeline_linkedin_llm_extraction_failed",
                    company=company_name,
                    error=str(exc),
                )

        # Build the enriched doc; same shape as _batch_resolve outputs
        if company_doc:
            result = dict(company_doc)
        else:
            synthetic_id = (
                f"synthetic_{hashlib.sha256(company_name.encode()).hexdigest()[:16]}"
            )
            result = {
                "_id": synthetic_id,
                "_score": 1.0,
                "name": company_name,
                "domain": "",
                "industry": "",
                "country": "",
                "locality": "",
            }
        if profile_data:
            result["_linkedin_profile"] = profile_data
        if linkedin_url:
            result["linkedin_url"] = linkedin_url
        return result
