"""
Expert Synthesis — curated *individual voices* in the AI sector.

Previously this module did a Tavily domain-restricted search across the
big labs (anthropic.com, openai.com, ai.googleblog.com, ai.meta.com), which
was effectively a duplicate of Frontier Labs. Rewritten to surface the
analysis of named practitioners instead:

  * Andrej Karpathy        (karpathy.github.io)        — Jekyll RSS
  * Ethan Mollick          (oneusefulthing.org)         — Substack RSS
  * Simon Willison         (simonwillison.net)         — Atom feed
  * Andrew Ng / The Batch  (deeplearning.ai/the-batch) — crawl (no RSS)
  * Yann LeCun             (AMI Labs + NYU)            — Tavily + crawl

LeCun has no canonical personal blog RSS — he posts on X / Threads and
publishes through AMI Labs. We use Tavily over his current affiliations
plus a crawl of amilabs.xyz/updates as the best available proxy.
"""

from __future__ import annotations

from typing import Any, Optional

from tavily import TavilyClient

from ..cache import cached_call
from ..types import MemorySnapshot
from ..url_utils import canonical_url
from ._feeds import fetch_feed, parse_date
from .base import BaseScanner, ProgressFn, ScanResult
from .crawl4ai_helper import crawl_urls_sync
from .time_utils import days_to_cutoff


# (voice_slug, feed_url) — verified live in May 2026.
_RSS_VOICES: list[tuple[str, str]] = [
    ("karpathy", "https://karpathy.github.io/feed.xml"),
    ("mollick",  "https://www.oneusefulthing.org/feed"),
    ("willison", "https://simonwillison.net/atom/everything/"),
]

# Voices without a personal RSS — crawl the landing/index page instead.
_CRAWL_VOICES: list[tuple[str, str]] = [
    ("andrew_ng", "https://www.deeplearning.ai/the-batch/"),
    ("lecun",     "https://amilabs.xyz/updates"),
]

# Yann LeCun has no clean RSS. We use Tavily over the domains where his
# current voice lives (his Paris startup + NYU faculty page) keyed to his
# name, so anything new he co-authors / is quoted in turns up.
_LECUN_DOMAINS = ["amilabs.xyz", "nyu.edu"]


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
        cutoff = days_to_cutoff(days) if days > 0 else None
        days_arg = days if days > 0 else None
        items: list[dict] = []
        queries_used: list[str] = []
        covered_urls = snapshot.covered_urls if snapshot else set()

        def _emit(msg: str, phase: str = "progress", **extra: Any) -> None:
            if progress:
                progress({"module": self.MODULE_ID, "phase": phase, "message": msg, **extra})

        # --- RSS voices: hard date filter ----------------------------------
        for slug, feed_url in _RSS_VOICES:
            queries_used.append(feed_url)
            try:
                entries = fetch_feed(feed_url)
            except Exception as e:
                _emit(f"{slug} feed failed: {e}", phase="warn")
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
                    "source": f"expert:{slug}",
                    "published": (pub_dt.isoformat() if pub_dt else "")[:10],
                })
                kept += 1
            _emit(f"{slug}: {kept} new")

        # --- Crawl voices: soft cutoff hint via cutoff_date ----------------
        crawl_urls = [u for _, u in _CRAWL_VOICES]
        queries_used.extend(crawl_urls)
        cutoff_iso = cutoff.date().isoformat() if cutoff else ""
        try:
            crawled = crawl_urls_sync(crawl_urls)
            url_to_slug = {u: slug for slug, u in _CRAWL_VOICES}
            for page in crawled:
                src_url = page.get("url", "")
                slug = url_to_slug.get(src_url, "expert")
                norm = canonical_url(src_url) or src_url
                if norm in covered_urls:
                    continue
                items.append({
                    "title": f"{slug} index",
                    "content": page.get("content", ""),
                    "url": norm,
                    "source": f"expert:{slug}",
                    "cutoff_date": cutoff_iso,
                })
        except Exception as e:
            _emit(f"expert crawl failed: {e}", phase="warn")

        # --- LeCun via Tavily ---------------------------------------------
        if self._tavily:
            q = "Yann LeCun"
            queries_used.append(f"tavily:{q}")
            try:
                resp = cached_call(
                    provider="tavily.expert.lecun",
                    query=q,
                    days=days_arg or 0,
                    fn=lambda: self._tavily.search(
                        query=q,
                        search_depth="advanced",
                        topic="news",
                        include_domains=_LECUN_DOMAINS,
                        days=days_arg,
                        max_results=4,
                    ),
                    on_hit=lambda age: _emit(
                        f"📦 cache · {q} (age {age // 60}m)", phase="cache"
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
                        "source": "expert:lecun",
                        # Tavily doesn't always return a published date.
                        # Hand the extractor a cutoff_date so it can drop
                        # items whose in-content date predates the window.
                        "cutoff_date": cutoff_iso,
                    })
            except Exception as e:
                _emit(f"tavily lecun failed: {e}", phase="warn")
        else:
            _emit("Tavily API key not set — skipping LeCun branch", phase="warn")

        _emit(f"{len(items)} items", phase="done")
        return ScanResult(
            module_id=self.MODULE_ID,
            module_label=self.MODULE_LABEL,
            items=items,
            queries_used=queries_used,
        )
