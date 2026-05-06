"""
Tooling & Tactics — new AI products and engineering workflows.

Sources scraped via crawl4ai:
  - The Neuron        (theneurondaily.com)
  - The Rundown AI    (therundown.ai)
  - TLDR AI           (tldr.tech/ai)        — moved here from community_sentiment
  - smol.ai AI News   (buttondown.com/ainews)

Date filtering is not applicable to web scraping — the LLM extractor handles
recency context. crawl4ai is not cached (frontier_labs already does URL diff;
this module's pages are digest landing pages where caching wouldn't add
value within the 24h TTL).
"""

from __future__ import annotations

from typing import Any, Optional

from ..types import MemorySnapshot
from ..url_utils import canonical_url
from .base import BaseScanner, ProgressFn, ScanResult
from .crawl4ai_helper import crawl_urls_sync


_NEWSLETTER_URLS = [
    "https://www.theneurondaily.com",
    "https://www.therundown.ai",
    "https://tldr.tech/ai",
    "https://buttondown.com/ainews",
]

_NEWSLETTER_NAMES = {
    "https://www.theneurondaily.com": "The Neuron",
    "https://www.therundown.ai": "The Rundown AI",
    "https://tldr.tech/ai": "TLDR AI",
    "https://buttondown.com/ainews": "smol.ai AI News",
}


class ToolingAndTacticsScanner(BaseScanner):
    MODULE_ID = "tooling_and_tactics"
    MODULE_LABEL = "Tooling & Tactics"

    def scan(self, days: int) -> ScanResult:
        return self.gather(days=days)

    def gather(
        self,
        days: int,
        snapshot: Optional[MemorySnapshot] = None,
        progress: Optional[ProgressFn] = None,
    ) -> ScanResult:
        def _emit(msg: str, phase: str = "progress", **extra: Any) -> None:
            if progress:
                progress({"module": self.MODULE_ID, "phase": phase, "message": msg, **extra})

        crawled = crawl_urls_sync(_NEWSLETTER_URLS)
        items: list[dict] = []
        for page in crawled:
            url = canonical_url(page.get("url", ""))
            items.append({
                "title": _NEWSLETTER_NAMES.get(page.get("url", ""), page.get("url", "")),
                "content": page.get("content", ""),
                "url": url or page.get("url", ""),
                "source": "crawl4ai",
            })

        _emit(f"{len(items)} digests", phase="done")
        return ScanResult(
            module_id=self.MODULE_ID,
            module_label=self.MODULE_LABEL,
            items=items,
            queries_used=list(_NEWSLETTER_URLS),
        )
