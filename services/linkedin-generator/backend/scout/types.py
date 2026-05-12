"""Pydantic models shared across the Pulse Scout v2 pipeline."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Novelty = Literal["new", "follow_up", "stale"]

# Pickable signal categories — drives renderer grouping + UI "Write this post" buttons.
SignalCategory = Literal[
    "release",     # model / product / API launches
    "research",    # papers, benchmarks, evals
    "tool",        # libraries, frameworks, infra
    "debate",      # tensions, contrarian takes, controversies
    "lesson",      # practitioner war stories, post-mortems, how-tos
    "strategy",    # market / career / long-form takes
]


class Finding(BaseModel):
    """A single structured fact extracted from raw scanner items."""

    id: str
    claim: str
    source_url: str = ""
    source_label: str = ""
    module: str = ""
    novelty: Novelty = "new"
    confidence: float = Field(0.7, ge=0.0, le=1.0)
    why_it_matters: str = ""
    # ISO YYYY-MM-DD when the underlying item was published (where the
    # scanner could detect it — RSS pubDate, Atom published, ArXiv date).
    # Empty string when unknown (e.g. crawled landing pages).
    published_at: str = ""


class Theme(BaseModel):
    title: str
    summary: str
    finding_ids: list[str] = Field(default_factory=list)


class Tension(BaseModel):
    title: str
    summary: str
    finding_ids: list[str] = Field(default_factory=list)


class Signal(BaseModel):
    """A pickable, post-ready story.

    Each signal is something a user could plausibly write a LinkedIn post about
    in one click. The synthesizer should aim for one signal per non-empty
    module when material allows.
    """

    id: str
    category: SignalCategory = "release"
    headline: str = ""
    summary: str = ""
    post_angle: str = ""           # ready-to-paste LinkedIn hook (1-2 sentences)
    finding_ids: list[str] = Field(default_factory=list)
    primary_module: str = ""       # which module surfaced this (for attribution)
    # Newest published_at across the signal's referenced findings — gives
    # the picker a freshness pill without needing to drill into findings.
    # Empty when no underlying finding has a dated source.
    published_at: str = ""


class Briefing(BaseModel):
    """Top-level structured output of a Pulse Scout run."""

    schema_version: int = 2
    lead: str = ""
    signals: list[Signal] = Field(default_factory=list)
    themes: list[Theme] = Field(default_factory=list)
    tensions: list[Tension] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    modules_used: list[str] = Field(default_factory=list)
    module_activity: dict[str, int] = Field(default_factory=dict)
    memory_signals: dict = Field(default_factory=dict)


class CoveredClaim(BaseModel):
    id: str = ""
    claim: str = ""
    source_url: str = ""
    fingerprint: str = ""


class MemorySnapshot(BaseModel):
    """Compact view of recent briefings handed to the extractor + gather."""

    covered_urls: set[str] = Field(default_factory=set)
    covered_claim_fingerprints: set[str] = Field(default_factory=set)
    recent_gaps: list[str] = Field(default_factory=list)
    rotation_cursor: int = 0
    briefings_count: int = 0

    model_config = {"arbitrary_types_allowed": True}

    def has_url(self, url: str) -> bool:
        return bool(url) and url in self.covered_urls


class IndexRow(BaseModel):
    """One line of outputs/scout/index.jsonl."""

    schema_version: int = 1
    run_id: str
    created_at: str
    modules: list[str] = Field(default_factory=list)
    days: int = 7
    lead: str = ""
    claims: list[CoveredClaim] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    rotation_cursor: int = 0


class StageUsage(BaseModel):
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


__all__ = [
    "Briefing",
    "CoveredClaim",
    "Finding",
    "IndexRow",
    "MemorySnapshot",
    "Novelty",
    "Signal",
    "SignalCategory",
    "StageUsage",
    "Tension",
    "Theme",
]
