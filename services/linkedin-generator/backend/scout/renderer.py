"""Briefing → markdown renderer."""

from __future__ import annotations

from datetime import datetime

from .types import Briefing, Finding, Signal


MODULE_LABELS: dict[str, str] = {
    "frontier_labs": "Frontier Labs",
    "community_sentiment": "Community Sentiment",
    "technical_deep_dive": "Technical Deep Dive",
    "tooling_and_tactics": "Tooling & Tactics",
    "long_form_strategy": "Long-form Strategy",
    "expert_synthesis": "Expert Synthesis",
}


CATEGORY_HEADERS: dict[str, str] = {
    "release":  "🚀 Releases",
    "research": "🔬 Research",
    "tool":     "🛠 Tools",
    "debate":   "⚖️ Debates",
    "lesson":   "📒 Lessons",
    "strategy": "🧭 Strategy",
}

_CATEGORY_ORDER = ["release", "research", "tool", "debate", "lesson", "strategy"]


def _module_label(module_id: str) -> str:
    return MODULE_LABELS.get(module_id, module_id or "unknown")


def _findings_by_id(findings: list[Finding]) -> dict[str, Finding]:
    return {f.id: f for f in findings}


def _format_source(f: Finding) -> str:
    label = f.source_label or f.module or "source"
    base = f"[{label}]({f.source_url})" if f.source_url else label
    return f"{base} _[{_module_label(f.module)}]_"


def render_briefing(
    briefing: Briefing,
    *,
    days: int,
    run_id: str,
    generated_at: datetime | None = None,
) -> str:
    generated_at = generated_at or datetime.now()
    by_id = _findings_by_id(briefing.findings)

    lines: list[str] = []
    lines.append("# Pulse Scout Briefing")
    lines.append(
        f"_Generated: {generated_at.strftime('%Y-%m-%d %H:%M')} · "
        f"Run: `{run_id}` · Window: last {days} days · "
        f"Modules: {', '.join(briefing.modules_used) or '—'}_"
    )
    lines.append("")
    lines.append("## Lead")
    lines.append(briefing.lead or "_(no lead)_")
    lines.append("")

    # Signals — grouped by category, the primary "pickable post topic" output.
    signals = briefing.signals or []
    if signals:
        by_cat: dict[str, list[Signal]] = {}
        for s in signals:
            by_cat.setdefault(s.category, []).append(s)
        lines.append("## Signals")
        lines.append("_Pick any signal below to write a post about it._")
        lines.append("")
        for cat in _CATEGORY_ORDER:
            bucket = by_cat.get(cat) or []
            if not bucket:
                continue
            lines.append(f"### {CATEGORY_HEADERS.get(cat, cat.title())}")
            for s in bucket:
                lines.append(f"#### {s.headline}")
                lines.append(s.summary)
                if s.post_angle:
                    lines.append("")
                    lines.append(f"> **Post angle:** {s.post_angle}")
                cited = [by_id[i] for i in s.finding_ids if i in by_id]
                if cited:
                    src = " · ".join(_format_source(f) for f in cited)
                    lines.append(f"_Sources: {src}_")
                lines.append("")

    if briefing.themes:
        lines.append("## Themes")
        for t in briefing.themes:
            lines.append(f"### {t.title}")
            lines.append(t.summary)
            cited = [by_id[i] for i in t.finding_ids if i in by_id]
            if cited:
                src = " · ".join(_format_source(f) for f in cited)
                lines.append(f"_Sources: {src}_")
            lines.append("")

    if briefing.tensions:
        lines.append("## Tensions")
        for t in briefing.tensions:
            lines.append(f"### {t.title}")
            lines.append(t.summary)
            cited = [by_id[i] for i in t.finding_ids if i in by_id]
            if cited:
                src = " · ".join(_format_source(f) for f in cited)
                lines.append(f"_Sources: {src}_")
            lines.append("")

    if briefing.gaps:
        lines.append("## Gaps to investigate next")
        for g in briefing.gaps:
            lines.append(f"- {g}")
        lines.append("")

    if briefing.action_items:
        lines.append("## Action items this week")
        for a in briefing.action_items:
            lines.append(f"- {a}")
        lines.append("")

    # Sources appendix
    if briefing.findings:
        lines.append("## All findings")
        for f in briefing.findings:
            badge = {"new": "🆕", "follow_up": "↪", "stale": "·"}.get(f.novelty, "·")
            lines.append(
                f"- {badge} **{f.claim}** "
                f"({_format_source(f)}, conf {f.confidence:.2f})"
            )
            if f.why_it_matters:
                lines.append(f"  - _why:_ {f.why_it_matters}")

    # Module activity (shows zeros so silent modules are visible)
    activity = briefing.module_activity or {}
    if activity:
        lines.append("")
        lines.append("## Module activity")
        for mod_id, count in sorted(activity.items(), key=lambda kv: (-kv[1], kv[0])):
            marker = "✅" if count > 0 else "⚫"
            lines.append(f"- {marker} **{_module_label(mod_id)}** — {count} item(s) gathered")
        lines.append("")

    sig = briefing.memory_signals or {}
    if sig:
        lines.append("")
        lines.append(
            f"---\n_Memory: {sig.get('briefings_count', 0)} prior briefings · "
            f"{sig.get('covered_urls', 0)} covered URLs · "
            f"{sig.get('covered_claims', 0)} covered claims._"
        )

    return "\n".join(lines).rstrip() + "\n"
