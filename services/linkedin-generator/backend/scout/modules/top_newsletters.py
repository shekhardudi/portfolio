"""
Top Newsletters — daily + weekly AI digests.

Replaces the old ``long_form_strategy`` and ``tooling_and_tactics`` modules,
both of which crawled AI newsletter landing pages without enforcing the
``days`` window. This module partitions sources into:

  RSS branch — Latent Space, Import AI, MIT Technology Review (AI topic),
  TLDR AI. Hard-filtered against ``days_to_cutoff(days)`` so old digests are
  dropped before the LLM extractor ever sees them.

  CRAWL branch — The Neuron, The Rundown AI, and AINews (smol.ai). These
  are Beehiiv landing pages without working RSS endpoints. We crawl the
  landing page and attach a ``cutoff_date`` field on each item so the
  extractor's prompt can soft-filter items older than the window.
"""

from __future__ import annotations

from typing import Any, Optional

from ..types import MemorySnapshot
from ..url_utils import canonical_url
from ._feeds import fetch_feed, parse_date
from .base import BaseScanner, ProgressFn, ScanResult
from .crawl4ai_helper import crawl_urls_sync
from .time_utils import days_to_cutoff


# (label, feed_url) — verified RSS endpoints (May 2026).
_RSS_FEEDS: list[tuple[str, str]] = [
    ("Latent Space",       "https://www.latent.space/feed"),
    ("Import AI",          "https://importai.substack.com/feed"),
    ("MIT Tech Review AI", "https://www.technologyreview.com/topic/artificial-intelligence/feed"),
    ("TLDR AI",            "https://tldr.tech/api/rss/ai"),
]

# Beehiiv-style landing pages — no RSS available, crawl the index.
_CRAWL_FALLBACKS: list[tuple[str, str]] = [
    ("The Neuron",     "https://www.theneurondaily.com"),
    ("The Rundown AI", "https://www.therundown.ai"),
    ("AINews",         "https://news.smol.ai/"),
]


class TopNewslettersScanner(BaseScanner):
    MODULE_ID = "top_newsletters"
    MODULE_LABEL = "Top Newsletters"

    def scan(self, days: int) -> ScanResult:
        return self.gather(days=days)

    def gather(
        self,
        days: int,
        snapshot: Optional[MemorySnapshot] = None,
        progress: Optional[ProgressFn] = None,
    ) -> ScanResult:
        cutoff = days_to_cutoff(days) if days > 0 else None
        items: list[dict] = []
        queries_used: list[str] = []
        covered_urls = snapshot.covered_urls if snapshot else set()

        def _emit(msg: str, phase: str = "progress", **extra: Any) -> None:
            if progress:
                progress({"module": self.MODULE_ID, "phase": phase, "message": msg, **extra})

        # --- RSS branch: hard date filter -----------------------------------
        for outlet, feed_url in _RSS_FEEDS:
            queries_used.append(feed_url)
            try:
                entries = fetch_feed(feed_url)
            except Exception as e:
                _emit(f"{outlet} feed failed: {e}", phase="warn")
                continue
            kept = 0
            for entry in entries[:8]:
                pub_dt = parse_date(entry.get("published", ""))
                if cutoff and pub_dt and pub_dt < cutoff:
                    continue
                url = canonical_url(entry.get("link", ""))
                if not url or url in covered_urls:
                    continue
                items.append({
                    "title": entry.get("title", ""),
                    "content": entry.get("summary", ""),
                    "url": url,
                    "source": f"newsletter:{outlet.lower().replace(' ', '_')}",
                    "published": (pub_dt.isoformat() if pub_dt else "")[:10],
                })
                kept += 1
            _emit(f"{outlet}: {kept} new")

        # --- Crawl branch: soft date hint via cutoff_date -------------------
        fallback_urls = [u for _, u in _CRAWL_FALLBACKS]
        queries_used.extend(fallback_urls)
        cutoff_iso = cutoff.date().isoformat() if cutoff else ""
        try:
            crawled = crawl_urls_sync(fallback_urls)
            url_to_outlet = {u: outlet for outlet, u in _CRAWL_FALLBACKS}
            for page in crawled:
                src_url = page.get("url", "")
                outlet = url_to_outlet.get(src_url, "newsletter")
                norm = canonical_url(src_url) or src_url
                if norm in covered_urls:
                    continue
                items.append({
                    "title": f"{outlet} digest",
                    "content": page.get("content", ""),
                    "url": norm,
                    "source": f"newsletter:{outlet.lower().replace(' ', '_')}",
                    # No structured publish date for crawled landing pages.
                    # cutoff_date lets the extractor drop entries whose
                    # in-content date predates the requested window.
                    "cutoff_date": cutoff_iso,
                })
        except Exception as e:
            _emit(f"crawl fallback failed: {e}", phase="warn")

        _emit(f"{len(items)} items", phase="done")
        return ScanResult(
            module_id=self.MODULE_ID,
            module_label=self.MODULE_LABEL,
            items=items,
            queries_used=queries_used,
        )
