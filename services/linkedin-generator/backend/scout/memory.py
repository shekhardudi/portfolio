"""Read/write the Pulse Scout memory index.

The memory file (`outputs/scout/index.jsonl`) is append-only; one JSON object
per finalized briefing. The reader applies a TTL window and yields a compact
``MemorySnapshot`` for the gather + extractor stages.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from .types import CoveredClaim, IndexRow, MemorySnapshot
from .url_utils import canonical_url


_WORD_RE = re.compile(r"[a-z0-9]+")


def claim_fingerprint(claim: str) -> str:
    """Stable token-bag fingerprint, immune to wording shuffles."""
    if not claim:
        return ""
    tokens = sorted(set(_WORD_RE.findall(claim.lower())))
    digest = hashlib.sha1(" ".join(tokens).encode("utf-8")).hexdigest()
    return digest[:16]


def _parse_iso(ts: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def read_index(
    index_path: Path,
    *,
    days: int = 30,
    now: datetime | None = None,
) -> list[IndexRow]:
    """Load index rows newer than ``days``, oldest → newest."""
    if not index_path.exists():
        return []
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=max(days, 1))
    rows: list[IndexRow] = []
    for raw in index_path.read_text().splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        ts = _parse_iso(str(data.get("created_at") or ""))
        if ts and ts < cutoff:
            continue
        try:
            rows.append(IndexRow.model_validate(data))
        except Exception:
            continue
    rows.sort(key=lambda r: r.created_at)
    return rows


def build_snapshot(
    rows: Iterable[IndexRow],
    *,
    max_recent_gaps: int = 3,
) -> MemorySnapshot:
    covered_urls: set[str] = set()
    fingerprints: set[str] = set()
    last_gaps: list[str] = []
    rotation_cursor = 0
    count = 0

    for row in rows:
        count += 1
        rotation_cursor = max(rotation_cursor, int(row.rotation_cursor or 0))
        for c in row.claims:
            url = canonical_url(c.source_url or "")
            if url:
                covered_urls.add(url)
            fp = c.fingerprint or claim_fingerprint(c.claim)
            if fp:
                fingerprints.add(fp)
        if row.gaps:
            last_gaps = list(row.gaps)

    return MemorySnapshot(
        covered_urls=covered_urls,
        covered_claim_fingerprints=fingerprints,
        recent_gaps=last_gaps[:max_recent_gaps],
        rotation_cursor=rotation_cursor,
        briefings_count=count,
    )


def append_index(index_path: Path, row: IndexRow) -> None:
    index_path.parent.mkdir(parents=True, exist_ok=True)
    with index_path.open("a", encoding="utf-8") as f:
        f.write(row.model_dump_json() + "\n")


def claims_from_findings(findings) -> list[CoveredClaim]:
    """Convert ``Finding`` objects into ``CoveredClaim`` rows for memory."""
    out: list[CoveredClaim] = []
    for f in findings or []:
        # Accept dicts (loose JSON path) or pydantic models alike.
        get = f.get if isinstance(f, dict) else lambda k, default="": getattr(f, k, default)
        claim = get("claim", "") or ""
        out.append(CoveredClaim(
            id=str(get("id", "") or ""),
            claim=claim,
            source_url=canonical_url(get("source_url", "") or ""),
            fingerprint=claim_fingerprint(claim),
        ))
    return out


__all__ = [
    "append_index",
    "build_snapshot",
    "claim_fingerprint",
    "claims_from_findings",
    "read_index",
]
