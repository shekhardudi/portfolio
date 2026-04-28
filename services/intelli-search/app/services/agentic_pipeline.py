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
import structlog
import time
from datetime import date
from typing import Any, Optional, TYPE_CHECKING

from openai import AsyncOpenAI

from app.config import get_settings, get_search_config
from app.services.agent_service import (
    CompanyEvent,
    EventExtractionResponse,
    EventData,
    TavilyResult,
    _call_tavily,
    _recover_partial_events,
    _EXTRACTION_SYSTEM_PROMPT,
)
from app.services.circuit_breaker import CircuitOpenError
from app.services.pii_service import detect_pii

if TYPE_CHECKING:
    from app.services.intent_classifier import QueryIntent

logger = structlog.get_logger(__name__)

_TAVILY_URL = "https://api.tavily.com/search"


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
    ) -> None:
        cfg = get_search_config().get("agentic", {})
        self._opensearch = opensearch_service
        self._index = get_settings().OPENSEARCH_INDEX_NAME
        self._tavily_key = tavily_key
        self._cache = cache_service
        self._embeddings = embedding_service

        # Config — read from search_config.yaml with sensible defaults
        self._max_results: int = int(cfg.get("tavily_max_results", 6))
        self._search_depth: str = str(cfg.get("tavily_search_depth", "advanced"))
        self._timeout_s: int = int(cfg.get("tavily_timeout_s", 8))
        self._cache_ttl_s: int = int(cfg.get("tavily_cache_ttl_s", 300))
        self._content_chars: int = int(cfg.get("content_chars", 800))
        self._resolve_per_name: int = int(cfg.get("resolve_per_name", 2))
        self._min_resolve_score: float = float(cfg.get("min_resolve_score", 1.0))
        # When False, _batch_resolve skips OpenSearch entirely and returns synthetic
        # docs with event data only — mirrors agent_service's resolve_to_index flag.
        self._resolve_to_index: bool = bool(cfg.get("resolve_to_index", True))
        self._max_company_results: int = int(cfg.get("max_company_results", 20))
        self._llm_max_tokens: int = int(cfg.get("llm_max_tokens", 2048))
        self._extraction_model: str = str(cfg.get("extraction_model", "gpt-4o-mini"))

        # Async OpenAI client — one per pipeline instance, connection-pooled
        self._openai = AsyncOpenAI(api_key=openai_api_key)

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
        primary_q = intent.search_query or query
        secondary_q = self._build_secondary_query(query, primary_q)

        # Phase 1: Parallel Tavily + background semantic prefetch
        _emit("searching", "Searching the web for recent company events…")

        semantic_task: Optional[asyncio.Task] = (
            asyncio.create_task(self._semantic_prefetch(primary_q))
            if self._embeddings else None
        )

        all_hits = await self._parallel_tavily(primary_q, secondary_q)

        if not all_hits:
            logger.info("pipeline_no_tavily_hits", query=query[:80])
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
        """
        orig = original_query.strip()
        prim = primary_q.strip()
        if orig and orig.lower() != prim.lower():
            return orig
        return None

    async def _parallel_tavily(
        self,
        primary_q: str,
        secondary_q: Optional[str],
    ) -> list[TavilyResult]:
        """
        Fire primary and secondary Tavily searches simultaneously.
        Deduplicate by URL — primary results take precedence.
        """
        if not self._tavily_key:
            return []

        if secondary_q:
            results = await asyncio.gather(
                self._tavily_search(primary_q),
                self._tavily_search(secondary_q),
                return_exceptions=True,
            )
            primary_hits: list[TavilyResult] = (
                results[0] if not isinstance(results[0], BaseException) else []
            )
            secondary_hits: list[TavilyResult] = (
                results[1] if not isinstance(results[1], BaseException) else []
            )
        else:
            primary_hits = await self._tavily_search(primary_q)
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
            "pipeline_tavily_merged",
            primary=len(primary_hits),
            secondary=len(secondary_hits),
            deduped_total=len(merged),
            primary_query=primary_q[:80],
        )
        return merged

    async def _tavily_search(self, query: str) -> list[TavilyResult]:
        """
        Single Tavily search with Redis caching + circuit-breaker + retry.

        Runs the synchronous _call_tavily() in a thread via asyncio.to_thread
        so it doesn't block the event loop.
        """
        # ── Cache lookup ──
        cache_key = self._tavily_cache_key(query)
        if self._cache:
            cached = self._cache.get(cache_key)
            if cached:
                try:
                    data = json.loads(cached)
                    hits = [TavilyResult.model_validate(r) for r in data.get("results", [])]
                    logger.info("pipeline_tavily_cache_hit", query=query[:80], hits=len(hits))
                    return hits
                except Exception:
                    pass  # Corrupt cache — re-fetch

        # ── Tavily API call (in thread to avoid blocking event loop) ──
        payload = {
            "api_key": self._tavily_key,
            "query": query,
            "max_results": self._max_results,
            "search_depth": self._search_depth,
            "include_published_date": True,
        }
        try:
            data = await asyncio.to_thread(
                _call_tavily, _TAVILY_URL, payload, self._timeout_s
            )
            # Cache the raw response for future requests
            if self._cache:
                try:
                    self._cache.set(cache_key, json.dumps(data), ttl=self._cache_ttl_s)
                except Exception:
                    pass
            return [TavilyResult.model_validate(r) for r in data.get("results", [])]
        except CircuitOpenError:
            logger.warning("pipeline_tavily_circuit_open", query=query[:80])
            return []
        except Exception as exc:
            logger.warning("pipeline_tavily_failed", query=query[:80], error=str(exc))
            return []

    def _tavily_cache_key(self, query: str) -> str:
        """Deterministic Redis key for a Tavily query."""
        raw = json.dumps(
            {"q": query.strip().lower(), "depth": self._search_depth, "max": self._max_results},
            sort_keys=True,
        )
        digest = hashlib.sha256(raw.encode()).hexdigest()[:24]
        return f"intelli-search:tavily:{digest}"

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
        results_text = "\n\n".join(
            f"Title: {r.title}\nURL: {r.url}\n"
            f"Published: {r.published_date or 'unknown'}\n"
            f"Content: {r.content[:self._content_chars]}"
            for r in hits
        )
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
                                "k": 20,
                            }
                        }
                    }
                },
                size=20,
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
