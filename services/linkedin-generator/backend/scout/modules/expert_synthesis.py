"""
Expert Synthesis — curated industry summaries via Tavily domain-restricted search.

Sources: deeplearning.ai, huggingface.co, anthropic.com, openai.com,
ai.googleblog.com, ai.meta.com. Two queries per run picked from a 4-bank by
deterministic rotation, plus an optional memory-aware gap probe. Cached.
"""

from __future__ import annotations

from typing import Any, Optional

from tavily import TavilyClient

from ..cache import cached_call
from ..query_bank import EXPERT_SYNTHESIS_BANK, gap_probe, pick_queries
from ..types import MemorySnapshot
from ..url_utils import canonical_url
from .base import BaseScanner, ProgressFn, ScanResult


_DOMAINS = [
    "deeplearning.ai",
    "huggingface.co",
    "anthropic.com",
    "openai.com",
    "ai.googleblog.com",
    "ai.meta.com",
]


class ExpertSynthesisScanner(BaseScanner):
    MODULE_ID = "expert_synthesis"
    MODULE_LABEL = "Expert Synthesis"

    def __init__(self, tavily_key: str):
        self._tavily = TavilyClient(api_key=tavily_key) if tavily_key else None

    def scan(self, days: int) -> ScanResult:
        return self.gather(days=days)

    def gather(
        self,
        days: int,
        snapshot: Optional[MemorySnapshot] = None,
        progress: Optional[ProgressFn] = None,
    ) -> ScanResult:
        if not self._tavily:
            return ScanResult(self.MODULE_ID, self.MODULE_LABEL, [], error="Tavily API key not set")

        days_arg = days if days > 0 else None
        items: list[dict] = []
        queries_used: list[str] = []
        covered_urls = snapshot.covered_urls if snapshot else set()

        def _emit(msg: str, phase: str = "progress", **extra: Any) -> None:
            if progress:
                progress({"module": self.MODULE_ID, "phase": phase, "message": msg, **extra})

        queries = pick_queries(EXPERT_SYNTHESIS_BANK, snapshot, k=2, module_id=self.MODULE_ID)
        probe = gap_probe(snapshot)
        if probe:
            queries.append(probe)

        for q in queries:
            queries_used.append(q)
            try:
                resp = cached_call(
                    provider="tavily.expert",
                    query=q,
                    days=days_arg or 0,
                    fn=lambda: self._tavily.search(
                        query=q,
                        search_depth="advanced",
                        topic="news",
                        include_domains=_DOMAINS,
                        days=days_arg,
                        max_results=6,
                    ),
                    on_hit=lambda age, _q=q: _emit(
                        f"📦 cache · {_q[:48]}… (age {age // 60}m)", phase="cache"
                    ),
                )
                for r in resp.get("results", []):
                    url = canonical_url(r.get("url", ""))
                    if url and url in covered_urls:
                        continue
                    items.append({
                        "title": r.get("title", ""),
                        "content": (r.get("content", "") or "")[:300],
                        "url": url or r.get("url", ""),
                        "source": "expert_curated",
                        "query": q,
                    })
            except Exception as e:
                _emit(f"tavily '{q[:32]}…' failed: {e}", phase="warn")

        _emit(f"{len(items)} items ({len(queries_used)} queries)", phase="done")
        return ScanResult(
            module_id=self.MODULE_ID,
            module_label=self.MODULE_LABEL,
            items=items,
            queries_used=queries_used,
        )
