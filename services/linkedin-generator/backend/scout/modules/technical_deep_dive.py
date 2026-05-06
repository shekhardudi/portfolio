"""Technical Deep Dive — 5 sub-area ArXiv queries, dedupe by paper id."""

from __future__ import annotations

from typing import Any, Optional

import arxiv

from ..cache import cached_call
from ..query_bank import TECHNICAL_DEEP_DIVE_QUERIES
from ..types import MemorySnapshot
from ..url_utils import canonical_url
from .base import BaseScanner, ProgressFn, ScanResult
from .time_utils import days_to_cutoff


_PER_QUERY_MAX = 8
_TOTAL_MAX = 12


def _fetch_one(query: str, per_query: int) -> list[dict]:
    client = arxiv.Client()
    search = arxiv.Search(
        query=query,
        max_results=per_query,
        sort_by=arxiv.SortCriterion.SubmittedDate,
        sort_order=arxiv.SortOrder.Descending,
    )
    out: list[dict] = []
    for paper in client.results(search):
        out.append({
            "id": paper.entry_id,
            "title": paper.title,
            "authors": [a.name for a in paper.authors[:3]],
            "abstract": paper.summary[:400].replace("\n", " "),
            "published": paper.published.isoformat(),
            "url": paper.entry_id,
        })
    return out


class TechnicalDeepDiveScanner(BaseScanner):
    MODULE_ID = "technical_deep_dive"
    MODULE_LABEL = "Technical Deep Dive"

    def scan(self, days: int) -> ScanResult:
        return self.gather(days=days)

    def gather(
        self,
        days: int,
        snapshot: Optional[MemorySnapshot] = None,
        progress: Optional[ProgressFn] = None,
    ) -> ScanResult:
        cutoff = days_to_cutoff(days) if days > 0 else None
        seen: dict[str, dict] = {}
        queries_used: list[str] = []
        covered_urls = snapshot.covered_urls if snapshot else set()

        def _emit(msg: str, phase: str = "progress", **extra: Any) -> None:
            if progress:
                progress({"module": self.MODULE_ID, "phase": phase, "message": msg, **extra})

        for q in TECHNICAL_DEEP_DIVE_QUERIES:
            queries_used.append(q)
            try:
                raw = cached_call(
                    provider="arxiv",
                    query=q,
                    days=days or 0,
                    fn=lambda: _fetch_one(q, _PER_QUERY_MAX),
                    on_hit=lambda age, _q=q: _emit(
                        f"📦 cache · {_q[:48]}… (age {age // 60}m)", phase="cache"
                    ),
                )
            except Exception as e:
                _emit(f"arxiv '{q[:32]}…' failed: {e}", phase="warn")
                continue

            for paper in raw:
                pid = str(paper.get("id") or paper.get("url") or "")
                if not pid or pid in seen:
                    continue
                # Cutoff filter (cached payload may be older than requested window)
                pub = paper.get("published", "")
                if cutoff and pub:
                    try:
                        from datetime import datetime
                        pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                        if pub_dt < cutoff:
                            continue
                    except Exception:
                        pass
                url = canonical_url(paper.get("url", ""))
                if url and url in covered_urls:
                    continue
                seen[pid] = {
                    "title": paper.get("title", ""),
                    "authors": paper.get("authors", []),
                    "abstract": paper.get("abstract", ""),
                    "published": (paper.get("published") or "")[:10],
                    "url": url or paper.get("url", ""),
                    "source": "arxiv",
                    "query": q,
                }

        # Top N by recency
        items = sorted(seen.values(), key=lambda i: i.get("published", ""), reverse=True)[:_TOTAL_MAX]
        _emit(f"{len(items)} unique papers ({len(queries_used)} queries)", phase="done")
        return ScanResult(
            module_id=self.MODULE_ID,
            module_label=self.MODULE_LABEL,
            items=items,
            queries_used=queries_used,
        )
