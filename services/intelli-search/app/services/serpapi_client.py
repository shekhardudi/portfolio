"""
SerpAPI Google AI Mode client — drop-in alternative to TavilyClient for
the agentic pipeline.

Endpoint: GET https://serpapi.com/search.json?engine=google_ai_mode
Docs:     https://serpapi.com/google-ai-mode-api

We translate the SerpAPI response into a Tavily-shaped dict so the
pipeline's existing ``TavilyResult.model_validate`` parser keeps working
without any per-provider branching:

    SerpAPI ``references[i]``  →  ``{"title", "url" (=link),
                                     "content" (=snippet),
                                     "score" (=1.0 - i / N),
                                     "published_date": None}``

There is no SerpAPI ``extract`` analogue — LinkedIn page scraping continues
to use Tavily's ``/extract`` endpoint (see ``AgenticPipeline``).
"""
from __future__ import annotations

import asyncio
import logging as _logging
from typing import Any, Optional

import requests
import structlog
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.services.circuit_breaker import CircuitBreaker, CircuitOpenError

logger = structlog.get_logger(__name__)

_SERPAPI_URL = "https://serpapi.com/search.json"

# Shared breaker — module-level so all pipeline instances share state.
_serpapi_cb = CircuitBreaker("serpapi", failure_threshold=5, timeout=60.0)


def _get_sync(params: dict, timeout: int) -> dict:
    """Blocking SerpAPI GET with retry + breaker. Raises on persistent failure."""

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
    def _do_get() -> requests.Response:
        resp = _serpapi_cb.call(
            requests.get, _SERPAPI_URL, params=params, timeout=timeout
        )
        resp.raise_for_status()
        return resp

    return _do_get().json()


def _render_text_blocks(blocks: list) -> str:
    """Flatten SerpAPI ``text_blocks`` into plain text.

    Used as a fallback when ``reconstructed_markdown`` is not present.
    Preserves heading / list structure so the LLM can still parse named
    entities cleanly.
    """
    lines: list[str] = []
    for blk in blocks or []:
        if not isinstance(blk, dict):
            continue
        btype = blk.get("type")
        snippet = (blk.get("snippet") or "").strip()
        if btype == "heading" and snippet:
            lines.append(f"\n## {snippet}")
        elif btype == "paragraph" and snippet:
            lines.append(snippet)
        elif btype == "list":
            for item in blk.get("list", []) or []:
                if isinstance(item, dict):
                    item_text = (item.get("snippet") or "").strip()
                    if item_text:
                        lines.append(f"- {item_text}")
        elif snippet:
            lines.append(snippet)
    return "\n".join(lines).strip()


def _ai_mode_summary_result(payload: dict) -> Optional[dict]:
    """Build a pinned synthetic result carrying the AI Mode answer body.

    Google AI Mode puts the *actual* answer (named companies, amounts,
    dates) in ``reconstructed_markdown`` / ``text_blocks``. The
    ``references[]`` snippets are only source citations and are often
    truncated table fragments — feeding the LLM only those starves the
    extractor of facts. This synthetic result surfaces the AI summary
    as the highest-scored hit so it is always seen first.
    """
    body = (payload.get("reconstructed_markdown") or "").strip()
    if not body:
        body = _render_text_blocks(payload.get("text_blocks") or [])
    if not body:
        return None
    meta = payload.get("search_metadata") or {}
    url = (
        meta.get("google_ai_mode_url")
        or meta.get("json_endpoint")
        or "https://www.google.com/search?udm=50"
    )
    return {
        "title": "Google AI Mode summary",
        "url": url,
        "content": body,
        "score": 1.0,
        "published_date": None,
    }


def _serpapi_to_tavily_results(payload: dict) -> list[dict]:
    """Translate a full SerpAPI Google AI Mode payload into Tavily-shaped results.

    Order: ``[ai_mode_summary?, *references]``. The AI summary is pinned
    first with score 1.0; references are scored just below by their
    original rank so the summary always wins ordering.
    """
    out: list[dict] = []
    summary = _ai_mode_summary_result(payload)
    if summary is not None:
        out.append(summary)

    refs = payload.get("references") or []
    if isinstance(refs, list) and refs:
        n = len(refs)
        for i, ref in enumerate(refs):
            if not isinstance(ref, dict):
                continue
            url = (ref.get("link") or "").strip()
            if not url:
                continue
            out.append({
                "title": ref.get("title") or "",
                "url": url,
                "content": ref.get("snippet") or "",
                # Rank-derived score, capped just under the AI summary so
                # the summary always wins ordering.
                "score": round(0.99 - (i / max(n, 1)) * 0.99, 4),
                "published_date": None,
            })
    return out


# Back-compat alias (kept for tests / callers using the previous name).
_references_to_tavily_results = _serpapi_to_tavily_results


class SerpApiClient:
    """Async-friendly SerpAPI Google AI Mode wrapper.

    Mirrors the surface of :class:`TavilyClient` for the subset the
    agentic pipeline uses (``enabled``, ``asearch``). No ``aextract``.
    """

    def __init__(
        self,
        api_key: Optional[str],
        timeout_s: int = 10,
        max_results: int = 10,
        gl: str = "us",
        hl: str = "en",
        location: Optional[str] = None,
    ) -> None:
        self._api_key = api_key
        self._timeout_s = timeout_s
        self._max_results = max_results
        self._gl = gl
        self._hl = hl
        self._location = location

    @property
    def enabled(self) -> bool:
        return bool(self._api_key)

    async def asearch(
        self,
        query: str,
        *,
        max_results: Optional[int] = None,
        include_raw_content: bool = False,  # noqa: ARG002 — no SerpAPI equivalent
    ) -> dict[str, Any]:
        """GET /search.json?engine=google_ai_mode.

        Returns a ``{"results": [...]}`` dict matching the Tavily shape.
        Returns ``{}`` when the key is missing or the breaker is open.
        """
        if not self._api_key:
            return {}
        params: dict[str, Any] = {
            "engine": "google_ai_mode",
            "q": query,
            "api_key": self._api_key,
            "gl": self._gl,
            "hl": self._hl,
            "output": "json",
        }
        if self._location:
            params["location"] = self._location
        try:
            payload = await asyncio.to_thread(
                _get_sync, params, self._timeout_s
            )
        except CircuitOpenError:
            logger.warning("serpapi_search_circuit_open", query=query[:80])
            return {}
        except Exception as exc:
            logger.warning("serpapi_search_failed", query=query[:80], error=str(exc))
            return {}

        if isinstance(payload, dict) and payload.get("error"):
            logger.warning(
                "serpapi_search_api_error",
                query=query[:80],
                error=str(payload.get("error"))[:200],
            )
            return {}

        results = _serpapi_to_tavily_results(payload or {})
        cap = max_results or self._max_results
        if cap and len(results) > cap:
            results = results[:cap]

        logger.info(
            "serpapi_search_done",
            query=query[:80],
            total=len(results),
            has_summary=bool(
                results and results[0].get("title") == "Google AI Mode summary"
            ),
        )
        return {"results": results}
