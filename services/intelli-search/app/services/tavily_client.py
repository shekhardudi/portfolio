"""
Single Tavily client used by the agentic pipeline for both event search
and LinkedIn enrichment. Owns the breaker + tenacity retry; the underlying
HTTP call (sync ``requests.post``) is wrapped at the leaf via
``asyncio.to_thread`` so callers stay on the event loop.

Why a separate module
---------------------
``agent_service.py`` is going away in Phase 4. Centralising the Tavily
integration here means:
  - ``agentic_pipeline`` only needs one import for all Tavily traffic
  - the LinkedIn discovery / extract flow doesn't need to ride on top of
    LangChain tool wrappers
  - the breaker / retry policy lives in one place
"""
from __future__ import annotations

import asyncio
import logging as _logging
import structlog
from typing import Any, Optional

import requests
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.services.circuit_breaker import CircuitBreaker, CircuitOpenError

logger = structlog.get_logger(__name__)

_TAVILY_SEARCH_URL = "https://api.tavily.com/search"
_TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"

# Shared breaker — one Tavily backend, one circuit. Module-level so the
# state is shared across pipeline instances (which are themselves
# singletons via the orchestrator).
_tavily_cb = CircuitBreaker("tavily", failure_threshold=5, timeout=60.0)


def _post_sync(url: str, payload: dict, timeout: int) -> dict:
    """Blocking Tavily POST with retry + breaker. Raises on persistent failure."""

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


class TavilyClient:
    """Async-friendly Tavily wrapper.

    Holds the API key, default timeout and search depth. Methods return
    the raw decoded JSON; parsing into Pydantic models is the caller's
    responsibility (kept here to mirror the existing pipeline contract).
    """

    def __init__(
        self,
        api_key: Optional[str],
        timeout_s: int = 8,
        search_depth: str = "basic",
        max_results: int = 6,
    ) -> None:
        self._api_key = api_key
        self._timeout_s = timeout_s
        self._search_depth = search_depth
        self._max_results = max_results

    @property
    def enabled(self) -> bool:
        return bool(self._api_key)

    async def asearch(
        self,
        query: str,
        *,
        max_results: Optional[int] = None,
        search_depth: Optional[str] = None,
        include_published_date: bool = True,
        include_raw_content: bool = False,
    ) -> dict[str, Any]:
        """POST /search. Returns ``{}`` when the key is missing or the breaker is open."""
        if not self._api_key:
            return {}
        payload = {
            "api_key": self._api_key,
            "query": query,
            "max_results": max_results or self._max_results,
            "search_depth": search_depth or self._search_depth,
            "include_published_date": include_published_date,
        }
        if include_raw_content:
            payload["include_raw_content"] = True
        try:
            return await asyncio.to_thread(
                _post_sync, _TAVILY_SEARCH_URL, payload, self._timeout_s
            )
        except CircuitOpenError:
            logger.warning("tavily_search_circuit_open", query=query[:80])
            return {}
        except Exception as exc:
            logger.warning("tavily_search_failed", query=query[:80], error=str(exc))
            return {}

    async def aextract(self, url: str) -> dict[str, Any]:
        """POST /extract. Returns ``{}`` when the key is missing or the breaker is open."""
        if not self._api_key:
            return {}
        payload = {"api_key": self._api_key, "urls": [url]}
        try:
            return await asyncio.to_thread(
                _post_sync, _TAVILY_EXTRACT_URL, payload, self._timeout_s
            )
        except CircuitOpenError:
            logger.warning("tavily_extract_circuit_open", url=url[:120])
            return {}
        except Exception as exc:
            logger.warning("tavily_extract_failed", url=url[:120], error=str(exc))
            return {}
