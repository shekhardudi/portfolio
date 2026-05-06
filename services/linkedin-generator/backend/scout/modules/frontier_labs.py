"""
Frontier Labs — direct, low-noise feed from major lab blogs.

Strategy:
  1. Try RSS/Atom for each lab (cheap, structured).
  2. For labs without a usable feed (x.ai, mistral.ai), fall back to crawl4ai
     on the blog index page.

URL diff against MemorySnapshot.covered_urls dedupes already-covered posts.
"""

from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Optional
from xml.etree import ElementTree as ET

import httpx

from ..types import MemorySnapshot
from ..url_utils import canonical_url
from .base import BaseScanner, ProgressFn, ScanResult
from .crawl4ai_helper import crawl_urls_sync
from .time_utils import days_to_cutoff


# (label, feed_url) — feeds verified as Atom/RSS endpoints.
_RSS_FEEDS: list[tuple[str, str]] = [
    ("OpenAI", "https://openai.com/news/rss.xml"),
    ("Anthropic", "https://www.anthropic.com/news/rss.xml"),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml"),
    ("Meta AI", "https://ai.meta.com/blog/rss/"),
    ("HuggingFace", "https://huggingface.co/blog/feed.xml"),
]

# Labs without a stable RSS — crawl their blog index.
_CRAWL_FALLBACKS: list[tuple[str, str]] = [
    ("xAI", "https://x.ai/blog"),
    ("Mistral", "https://mistral.ai/news/"),
]


def _parse_date(s: str) -> Optional[datetime]:
    if not s:
        return None
    # RSS pubDate (RFC-822)
    try:
        dt = parsedate_to_datetime(s)
        if dt and dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        pass
    # Atom updated/published (ISO 8601)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _fetch_feed(url: str, timeout: float = 8.0) -> list[dict]:
    """Fetch + parse an RSS or Atom feed. Returns list of {title, link, summary, published}."""
    resp = httpx.get(url, timeout=timeout, follow_redirects=True,
                     headers={"User-Agent": "PulseScout/2.0"})
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    # RSS 2.0
    items: list[dict] = []
    for item in root.iter("item"):
        items.append({
            "title": (item.findtext("title") or "").strip(),
            "link": (item.findtext("link") or "").strip(),
            "summary": (item.findtext("description") or "").strip()[:400],
            "published": item.findtext("pubDate") or "",
        })
    if items:
        return items

    # Atom
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
        link_el = entry.find("a:link", ns)
        link = link_el.get("href") if link_el is not None else ""
        items.append({
            "title": (entry.findtext("a:title", default="", namespaces=ns) or "").strip(),
            "link": link,
            "summary": (
                entry.findtext("a:summary", default="", namespaces=ns)
                or entry.findtext("a:content", default="", namespaces=ns)
                or ""
            ).strip()[:400],
            "published": (
                entry.findtext("a:updated", default="", namespaces=ns)
                or entry.findtext("a:published", default="", namespaces=ns)
                or ""
            ),
        })
    return items


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
                entries = _fetch_feed(feed_url)
            except Exception as e:
                _emit(f"{lab} feed failed: {e}", phase="warn")
                continue
            kept = 0
            for e in entries[:8]:
                pub_dt = _parse_date(e.get("published", ""))
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
