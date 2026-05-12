"""LLM-based synthesizer: Findings → structured Briefing JSON."""

from __future__ import annotations

import json
import re
from pathlib import Path

from langchain_core.messages import HumanMessage

from ..core.pricing import text_cost
from ..core.settings import get_settings
from .types import Briefing, Finding, MemorySnapshot, Signal, StageUsage, Theme, Tension


_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "scout_synthesizer.txt"

# When the synthesizer LLM omits a module despite the Coverage requirement,
# we fabricate one fallback Signal per missing module. category is required
# on Signal but the fallback path has no LLM-picked one, so we pick a
# sensible default per known module.
_DEFAULT_CATEGORY_BY_MODULE: dict[str, str] = {
    "frontier_labs": "release",
    "technical_deep_dive": "research",
    "top_newsletters": "strategy",
    "community_sentiment": "debate",
    "expert_synthesis": "strategy",
}


def _build_llm():
    s = get_settings()
    model = s.scout_synthesizer_model
    if model.startswith("openai/"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model.split("/", 1)[1], temperature=s.scout_synthesizer_temperature), model
    if model.startswith("ollama/"):
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=model.split("/", 1)[1],
            base_url=s.ollama_base_url,
            temperature=s.scout_synthesizer_temperature,
            num_ctx=s.ollama_num_ctx,
        ), model
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(model=model, temperature=s.scout_synthesizer_temperature), f"openai/{model}"


def _parse_json_object(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        data = json.loads(raw[start : end + 1])
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _quiet_briefing(findings: list[Finding], modules_used: list[str], snapshot: MemorySnapshot) -> Briefing:
    """Fallback when there's not enough non-stale signal to synthesize."""
    return Briefing(
        lead="Quiet week — no new high-signal stories this period.",
        themes=[],
        tensions=[],
        gaps=list(snapshot.recent_gaps)[:3],
        action_items=["Re-run with a wider time window or different module mix."],
        findings=findings,
        modules_used=modules_used,
        memory_signals={
            "covered_urls": len(snapshot.covered_urls),
            "covered_claims": len(snapshot.covered_claim_fingerprints),
            "briefings_count": snapshot.briefings_count,
        },
    )


def synthesize(
    findings: list[Finding],
    modules_used: list[str],
    snapshot: MemorySnapshot,
) -> tuple[Briefing, StageUsage]:
    """Synthesize Findings into a Briefing. Returns (briefing, usage)."""
    non_stale = [f for f in findings if f.novelty != "stale"]
    if len(non_stale) <= 3:
        return _quiet_briefing(findings, modules_used, snapshot), StageUsage(
            model="", input_tokens=0, output_tokens=0, cost_usd=0.0
        )

    # Group findings by module so the LLM physically sees each module as a
    # distinct bucket instead of one long ranked list. Combined with the
    # tightened Coverage Requirement in the prompt, this is what stops
    # frontier_labs / technical_deep_dive monopolising the signal slots.
    by_module: dict[str, list[dict]] = {}
    for f in findings:
        mod = f.module or "unknown"
        by_module.setdefault(mod, []).append(
            {
                "id": f.id,
                "claim": f.claim,
                "module": f.module,
                "source_label": f.source_label,
                "novelty": f.novelty,
                "confidence": f.confidence,
                "why_it_matters": f.why_it_matters,
                "published_at": f.published_at,
            }
        )
    findings_block = json.dumps(by_module, indent=2)

    coverage_modules = sorted(by_module.keys())
    coverage_block = (
        "\n".join(f"- {m}" for m in coverage_modules)
        if coverage_modules
        else "- (none)"
    )

    recent_gaps_block = "\n".join(f"- {g}" for g in snapshot.recent_gaps) or "(none)"

    prompt = _PROMPT_PATH.read_text().format(
        recent_gaps=recent_gaps_block,
        coverage_modules=coverage_block,
        findings=findings_block,
    )

    llm, model_label = _build_llm()
    response = llm.invoke([HumanMessage(content=prompt)])

    usage = getattr(response, "usage_metadata", None) or {}
    meta = (getattr(response, "response_metadata", None) or {}).get("token_usage") or {}
    in_tok = int(usage.get("input_tokens") or meta.get("prompt_tokens") or 0)
    out_tok = int(usage.get("output_tokens") or meta.get("completion_tokens") or 0)
    cost = round(text_cost(model_label, in_tok, out_tok), 6)
    stage_usage = StageUsage(model=model_label, input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost)

    parsed = _parse_json_object(response.content if hasattr(response, "content") else str(response))
    if not parsed:
        return _quiet_briefing(findings, modules_used, snapshot), stage_usage

    valid_ids = {f.id for f in findings}

    def _theme_list(key: str, cls):
        out = []
        for t in parsed.get(key, []) or []:
            if not isinstance(t, dict):
                continue
            ids = [i for i in (t.get("finding_ids") or []) if i in valid_ids]
            title = (t.get("title") or "").strip()
            summary = (t.get("summary") or "").strip()
            if not title or not summary:
                continue
            out.append(cls(title=title, summary=summary, finding_ids=ids))
        return out

    themes = _theme_list("themes", Theme)
    tensions = _theme_list("tensions", Tension)

    # Parse signals (the new pickable-topic primary output).
    valid_categories = {"release", "research", "tool", "debate", "lesson", "strategy"}
    findings_by_id = {f.id: f for f in findings}
    signals: list[Signal] = []
    for idx, s_raw in enumerate(parsed.get("signals") or [], 1):
        if not isinstance(s_raw, dict):
            continue
        ids = [i for i in (s_raw.get("finding_ids") or []) if i in valid_ids]
        if not ids:
            continue
        headline = (s_raw.get("headline") or "").strip()
        summary = (s_raw.get("summary") or "").strip()
        if not headline or not summary:
            continue
        category = (s_raw.get("category") or "").strip().lower()
        if category not in valid_categories:
            category = "release"
        primary_module = (s_raw.get("primary_module") or "").strip()
        if not primary_module:
            primary_module = findings_by_id[ids[0]].module
        # Signal's published_at = newest published_at among its referenced
        # findings. Strings compare lexicographically when both sides are
        # ISO YYYY-MM-DD, which is what we emit. Empty strings sort first
        # so genuine dates win.
        pub_dates = [
            findings_by_id[fid].published_at
            for fid in ids
            if findings_by_id[fid].published_at
        ]
        signal_pub = max(pub_dates) if pub_dates else ""
        signals.append(
            Signal(
                id=(s_raw.get("id") or f"s-{idx}").strip() or f"s-{idx}",
                category=category,  # type: ignore[arg-type]
                headline=headline[:140],
                summary=summary,
                post_angle=(s_raw.get("post_angle") or "").strip()[:400],
                finding_ids=ids,
                primary_module=primary_module,
                published_at=signal_pub,
            )
        )

    # Coverage safety net: if any non-empty module ended up without a signal
    # despite the prompt's hard rule, fabricate one Signal from its
    # highest-confidence non-stale finding. Lower quality than an LLM-crafted
    # signal (empty post_angle, headline = raw claim), but better than
    # silently dropping the module from the briefing.
    modules_with_findings = {
        f.module for f in findings if f.novelty != "stale" and f.module
    }
    modules_with_signals = {s.primary_module for s in signals if s.primary_module}
    missing = modules_with_findings - modules_with_signals
    # Solo-run guard: with one module in play and the LLM having returned at
    # least one signal, accept the run as well-covered even if primary_module
    # is unset on those signals. Avoids fabricating a duplicate fallback.
    if len(modules_with_findings) <= 1 and signals:
        missing = set()
    for mod_id in sorted(missing):
        cand = max(
            (f for f in findings if f.module == mod_id and f.novelty != "stale"),
            key=lambda f: (f.confidence, f.published_at or ""),
            default=None,
        )
        if cand is None:
            continue
        signals.append(
            Signal(
                id=f"s-fallback-{mod_id}",
                category=_DEFAULT_CATEGORY_BY_MODULE.get(mod_id, "strategy"),  # type: ignore[arg-type]
                headline=cand.claim[:140],
                summary=cand.why_it_matters or cand.claim,
                post_angle="",
                finding_ids=[cand.id],
                primary_module=mod_id,
                published_at=cand.published_at,
            )
        )

    gaps = [str(g).strip() for g in (parsed.get("gaps") or []) if str(g).strip()][:6]
    actions = [str(a).strip() for a in (parsed.get("action_items") or []) if str(a).strip()][:6]
    lead = (parsed.get("lead") or "").strip() or "Briefing for the period."

    briefing = Briefing(
        lead=lead,
        signals=signals,
        themes=themes,
        tensions=tensions,
        gaps=gaps,
        action_items=actions,
        findings=findings,
        modules_used=modules_used,
        memory_signals={
            "covered_urls": len(snapshot.covered_urls),
            "covered_claims": len(snapshot.covered_claim_fingerprints),
            "briefings_count": snapshot.briefings_count,
        },
    )
    return briefing, stage_usage
