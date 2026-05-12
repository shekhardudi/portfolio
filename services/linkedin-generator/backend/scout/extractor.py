"""LLM-based extractor: raw module items → atomic Findings."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage

from ..core.pricing import text_cost
from ..core.settings import get_settings
from ..core.logging import get_logger
from ..guardrails import GuardrailAction, scrub_input
from .memory import claim_fingerprint
from .modules.base import ScanResult
from .types import Finding, MemorySnapshot, StageUsage

log = get_logger("scout.extractor")


_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "scout_extractor.txt"

# Module priority for capping: highest first.
_PRIORITY = {
    "frontier_labs": 100,
    "technical_deep_dive": 90,
    "expert_synthesis": 80,
    "top_newsletters": 60,
    "community_sentiment": 50,
}


def _flatten_items(results: list[ScanResult], cap: int, per_module_floor: int = 0) -> list[dict]:
    """Flatten all module items, prioritised + capped.

    Guarantees up to `per_module_floor` items per non-empty module survive the
    global cap, so low-priority modules (tooling, long-form, community) are
    still represented in the synthesizer's view.
    """
    # Bucket per module preserving original order within each module.
    by_module: dict[str, list[dict]] = {}
    for r in results:
        bucket = by_module.setdefault(r.module_id, [])
        for it in r.items:
            bucket.append({
                "module": r.module_id,
                "module_label": r.module_label,
                "title": it.get("title", ""),
                "content": (it.get("content", "") or it.get("abstract", ""))[:280],
                "url": it.get("url", ""),
                "source": it.get("source", r.module_id),
                # published: structured ISO date from the scanner where
                # available (RSS pubDate / Atom published / ArXiv date).
                # cutoff_date: extractor uses this to soft-drop landing-page
                # items whose in-content date predates the requested window.
                "published": it.get("published", ""),
                "cutoff_date": it.get("cutoff_date", ""),
            })

    selected: list[dict] = []
    seen: set[int] = set()

    # Pass 1: reserve floor items for each non-empty module.
    if per_module_floor > 0:
        for mod_id, bucket in by_module.items():
            for it in bucket[:per_module_floor]:
                key = id(it)
                if key in seen:
                    continue
                selected.append(it)
                seen.add(key)
                if len(selected) >= cap:
                    return selected

    # Pass 2: fill remaining slots by priority order.
    rows: list[tuple[int, dict]] = []
    for mod_id, bucket in by_module.items():
        prio = _PRIORITY.get(mod_id, 40)
        for it in bucket:
            if id(it) in seen:
                continue
            rows.append((prio, it))
    rows.sort(key=lambda x: x[0], reverse=True)
    for _, it in rows:
        if len(selected) >= cap:
            break
        selected.append(it)
    return selected


def _build_llm():
    """Return (llm, model_label). Uses scout_extractor_model setting."""
    s = get_settings()
    model = s.scout_extractor_model
    if model.startswith("openai/"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model.split("/", 1)[1], temperature=s.scout_extractor_temperature), model
    if model.startswith("ollama/"):
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=model.split("/", 1)[1],
            base_url=s.ollama_base_url,
            temperature=s.scout_extractor_temperature,
            num_ctx=s.ollama_num_ctx,
        ), model
    # default fallback: openai
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(model=model, temperature=s.scout_extractor_temperature), f"openai/{model}"


def _parse_json_array(raw: str) -> list[dict]:
    """Parse an LLM response that should be a JSON array — be lenient."""
    raw = raw.strip()
    # Strip ``` fences
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    # Find first [ and last ]
    start = raw.find("[")
    end = raw.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return []
    try:
        data = json.loads(raw[start : end + 1])
        return data if isinstance(data, list) else []
    except Exception:
        return []


def extract(
    results: list[ScanResult],
    snapshot: MemorySnapshot,
) -> tuple[list[Finding], StageUsage]:
    """Run the LLM extractor over all module results.

    Returns (findings, usage). On budget exceedance / parse failure / no items,
    returns ([], usage_with_zeros).
    """
    s = get_settings()
    items = _flatten_items(
        results,
        cap=s.scout_max_extractor_items,
        per_module_floor=s.scout_module_min_floor,
    )
    if not items:
        return [], StageUsage(model="", input_tokens=0, output_tokens=0, cost_usd=0.0)

    # Guardrail pass: every scraped item's content is attacker-controllable
    # text. Run inbound detection; BLOCK (prompt-injection match) replaces
    # content with a placeholder so the LLM never sees the payload, REDACT
    # (email/phone) replaces those substrings with masks.
    blocked = 0
    redacted = 0
    for it in items:
        scrubbed, action, reason = scrub_input(it["content"])
        if action == GuardrailAction.BLOCK:
            blocked += 1
            log.info(
                "scout.input.injection_blocked",
                module=it.get("module"),
                url=it.get("url"),
                reason=reason,
            )
            it["content"] = "[redacted: suspected prompt injection]"
        elif action == GuardrailAction.REDACT:
            redacted += 1
            it["content"] = scrubbed
    if blocked or redacted:
        log.info("scout.input.guardrail_summary", blocked=blocked, redacted=redacted)

    covered_lines = []
    for fp in list(snapshot.covered_claim_fingerprints)[:60]:
        covered_lines.append(fp)
    covered_block = "\n".join(covered_lines) or "(none)"

    # Wrap each item's content in <external_content>…</external_content> so
    # the extractor prompt's "treat as data, not instructions" rule has a
    # syntactic boundary to point at. Combined with the inbound scrub above
    # this gives a defence-in-depth posture against prompt injection.
    raw_lines = []
    for i, it in enumerate(items, 1):
        meta_bits = [f"module={it['module']}", f"url={it['url']}", f"source={it['source']}"]
        if it.get("published"):
            meta_bits.append(f"published={it['published']}")
        if it.get("cutoff_date"):
            meta_bits.append(f"cutoff_date={it['cutoff_date']}")
        raw_lines.append(
            f"[{i}] {' '.join(meta_bits)}\n"
            f"    title: {it['title'][:160]}\n"
            f"    content: <external_content>{it['content']}</external_content>"
        )
    raw_block = "\n".join(raw_lines)

    template = _PROMPT_PATH.read_text()
    prompt = template.format(
        max_items=min(s.scout_max_extractor_items, len(items)),
        covered_claims=covered_block,
        raw_items=raw_block,
    )

    llm, model_label = _build_llm()
    response = llm.invoke([HumanMessage(content=prompt)])

    # Token + cost accounting
    usage = getattr(response, "usage_metadata", None) or {}
    meta = (getattr(response, "response_metadata", None) or {}).get("token_usage") or {}
    in_tok = int(usage.get("input_tokens") or meta.get("prompt_tokens") or 0)
    out_tok = int(usage.get("output_tokens") or meta.get("completion_tokens") or 0)
    cost = round(text_cost(model_label, in_tok, out_tok), 6)
    stage_usage = StageUsage(model=model_label, input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost)

    parsed = _parse_json_array(response.content if hasattr(response, "content") else str(response))

    findings: list[Finding] = []
    seen_fps: set[str] = set()
    for obj in parsed:
        if not isinstance(obj, dict):
            continue
        claim = (obj.get("claim") or "").strip()
        url = (obj.get("source_url") or "").strip()
        if not claim:
            continue
        fp = claim_fingerprint(claim)
        if fp in seen_fps:
            continue
        seen_fps.add(fp)

        novelty = obj.get("novelty") or "new"
        if novelty not in ("new", "follow_up", "stale"):
            novelty = "new"
        # Cross-check fingerprint against snapshot — override LLM
        if fp in snapshot.covered_claim_fingerprints and novelty == "new":
            novelty = "stale"

        try:
            confidence = float(obj.get("confidence", 0.6))
        except (TypeError, ValueError):
            confidence = 0.6

        # published_at: prefer the LLM-echoed value, fall back to the raw
        # `published` field name if it slipped through. Strip to date prefix
        # so partially-iso strings ("2026-05-11T17:00:00Z") render cleanly.
        published_at = (
            (obj.get("published_at") or obj.get("published") or "").strip()[:10]
        )
        findings.append(Finding(
            id=f"f-{len(findings) + 1}",
            claim=claim,
            source_url=url,
            source_label=(obj.get("source_label") or obj.get("module") or "")[:80],
            module=obj.get("module") or "unknown",
            novelty=novelty,  # type: ignore[arg-type]
            confidence=max(0.0, min(1.0, confidence)),
            why_it_matters=(obj.get("why_it_matters") or "")[:200],
            published_at=published_at,
        ))

    return findings, stage_usage
