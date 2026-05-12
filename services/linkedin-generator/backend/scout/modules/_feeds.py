"""Shared RSS / Atom helpers used by frontier_labs, top_newsletters, and
expert_synthesis. Originally lived inside frontier_labs.py — promoted to a
module-private helper when multiple scanners needed the same parsing path.

`fetch_feed` returns a list of normalised item dicts with keys
``title / link / summary / published`` (published is the raw date string,
parse it with ``parse_date``).
"""

from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
from xml.etree import ElementTree as ET

import httpx


def parse_date(s: str) -> Optional[datetime]:
    """Parse RSS RFC-822 ``pubDate`` or Atom ISO 8601 ``published/updated``.
    Returns timezone-aware UTC datetime or None on unparseable / empty input.
    """
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


def fetch_feed(url: str, timeout: float = 8.0) -> list[dict]:
    """Fetch + parse an RSS 2.0 or Atom 1.0 feed.

    Returns a list of dicts with keys ``title``, ``link``, ``summary``,
    ``published`` (raw date string). RSS is tried first; if no ``<item>``
    elements are present the function falls through to Atom ``<entry>``
    parsing using the standard 2005 namespace. Both yield the same shape.
    """
    resp = httpx.get(
        url,
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": "PulseScout/2.0"},
    )
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
