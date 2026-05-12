"""
Frontier Labs — direct, low-noise feed from major lab blogs.

Strategy:
  1. Try RSS/Atom for each lab (cheap, structured).
  2. For labs without a usable feed (x.ai, mistral.ai), fall back to crawl4ai
     on the blog index page.

URL diff against MemorySnapshot.covered_urls dedupes already-covered posts.
"""

from __future__ import annotations

from typing import Any, Optional

from ..types import MemorySnapshot
from ..url_utils import canonical_url
from ._feeds import fetch_feed, parse_date
from .base import BaseScanner, ProgressFn, ScanResult
from .crawl4ai_helper import crawl_urls_sync
from .time_utils import days_to_cutoff


# (label, feed_url) — verified live in May 2026. Anthropic and Meta AI used
# to expose /news/rss.xml and /blog/rss/ respectively but both now 404 with
# no <link rel="alternate"> on the news index pages, so they moved to the
# crawl path below.
_RSS_FEEDS: list[tuple[str, str]] = [
    ("OpenAI", "https://openai.com/news/rss.xml"),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml"),
    ("HuggingFace", "https://huggingface.co/blog/feed.xml"),
]

# Labs without a stable RSS — crawl their blog index. Anthropic + Meta AI
# joined xAI / Mistral here when their RSS endpoints went 404.
_CRAWL_FALLBACKS: list[tuple[str, str]] = [
    ("Anthropic", "https://www.anthropic.com/news"),
    ("Meta AI", "https://ai.meta.com/blog/"),
    ("xAI", "https://x.ai/blog"),
    ("Mistral", "https://mistral.ai/news/"),
]


class FrontierLabsScanner(BaseScanner):
    MODULE_ID = "frontier_labs"
    MODULE_LABEL = "Frontier Labs"

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

        # --- RSS feeds ---
        for lab, feed_url in _RSS_FEEDS:
            queries_used.append(feed_url)
            try:
                entries = fetch_feed(feed_url)
            except Exception as e:
                _emit(f"{lab} feed failed: {e}", phase="warn")
                continue
            kept = 0
            for e in entries[:8]:
                pub_dt = parse_date(e.get("published", ""))
                if cutoff and pub_dt and pub_dt < cutoff:
                    continue
                url = canonical_url(e.get("link", ""))
                if not url or url in covered_urls:
                    continue
                items.append({
                    "title": e.get("title", ""),
                    "content": e.get("summary", ""),
                    "url": url,
                    "source": f"frontier:{lab.lower().replace(' ', '_')}",
                    "published": (pub_dt.isoformat() if pub_dt else "")[:10],
                })
                kept += 1
            _emit(f"{lab}: {kept} new")

        # --- crawl fallbacks ---
        fallback_urls = [u for _, u in _CRAWL_FALLBACKS]
        queries_used.extend(fallback_urls)
        try:
            crawled = crawl_urls_sync(fallback_urls)
            url_to_lab = {u: lab for lab, u in _CRAWL_FALLBACKS}
            for page in crawled:
                src_url = page.get("url", "")
                lab = url_to_lab.get(src_url, "frontier")
                norm = canonical_url(src_url)
                if norm in covered_urls:
                    continue
                items.append({
                    "title": f"{lab} blog index",
                    "content": page.get("content", ""),
                    "url": norm or src_url,
                    "source": f"frontier:{lab.lower()}",
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
