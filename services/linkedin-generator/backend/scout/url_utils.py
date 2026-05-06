"""URL canonicalization for memory dedup.

Strips tracking parameters and fragments, lowercases the host, drops a
trailing slash. Pure function — no I/O — so it's trivial to test.
"""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "fbclid", "mc_cid", "mc_eid", "ref", "ref_src", "ref_url",
    "_hsenc", "_hsmi", "igshid",
}


def canonical_url(url: str) -> str:
    """Return a normalized form of ``url`` suitable for set membership.

    - Lowercase scheme + host.
    - Drop fragment.
    - Drop common tracking query params (utm_*, gclid, fbclid, ...).
    - Drop trailing slash from path (except root).
    Empty / invalid input is returned unchanged.
    """
    if not url:
        return url
    try:
        parts = urlsplit(url.strip())
    except Exception:
        return url
    if not parts.scheme or not parts.netloc:
        return url

    scheme = parts.scheme.lower()
    netloc = parts.netloc.lower()
    path = parts.path or ""
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    query_pairs = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS
    ]
    query = urlencode(query_pairs, doseq=True)

    return urlunsplit((scheme, netloc, path, query, ""))
