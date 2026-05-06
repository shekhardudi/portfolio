"""
Pulse Scout v2 — Memory → Gather → Extract → Synthesize → Persist.

Orchestrates the v2 pipeline. Keeps a legacy ``synthesize`` method as a
0-finding fallback so older callers / tests continue to work.

Returns ``(markdown_report, cost_breakdown)`` where ``cost_breakdown`` matches
the shape consumed by the frontend ``CostTracker`` component, and additionally
exposes the structured briefing dict via ``run_with_briefing``.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Callable, Optional

import httpx

from backend.core.paths import (
    new_run_id,
    outputs_dir,
    scout_index_path,
    scout_run_dir,
)
from backend.core.settings import get_settings

from . import memory as scout_memory
from .extractor import extract
from .modules.base import BaseScanner, ScanResult
from .modules.community_sentiment import CommunitySentimentScanner
from .modules.expert_synthesis import ExpertSynthesisScanner
from .modules.frontier_labs import FrontierLabsScanner
from .modules.long_form_strategy import LongFormStrategyScanner
from .modules.technical_deep_dive import TechnicalDeepDiveScanner
from .modules.tooling_and_tactics import ToolingAndTacticsScanner
from .renderer import render_briefing
from .synthesizer import synthesize as synth_briefing
from .types import Briefing, CoveredClaim, IndexRow, StageUsage


ProgressCallback = Callable[[int, int, Optional[dict[str, Any]]], None]


class PulseScout:
    """Orchestrates the Pulse Scout v2 pipeline."""

    def __init__(self):
        s = get_settings()
        self._tavily_key = s.tavily_api_key
        self._concurrency = max(1, s.scout_module_concurrency)
        self._memory_days = s.scout_memory_days

        self.MODULE_REGISTRY: dict[str, BaseScanner] = {
            "frontier_labs": FrontierLabsScanner(),
            "community_sentiment": CommunitySentimentScanner(self._tavily_key),
            "technical_deep_dive": TechnicalDeepDiveScanner(),
            "tooling_and_tactics": ToolingAndTacticsScanner(),
            "long_form_strategy": LongFormStrategyScanner(),
            "expert_synthesis": ExpertSynthesisScanner(self._tavily_key),
        }

    # ------------------------------------------------------------------
    # Health / metadata
    # ------------------------------------------------------------------

    def synthesis_backend_label(self) -> str:
        s = get_settings()
        return f"extractor={s.scout_extractor_model} · synth={s.scout_synthesizer_model}"

    def check_ollama_health(self) -> bool:
        s = get_settings()
        try:
            r = httpx.get(f"{s.ollama_base_url}/api/tags", timeout=3.0)
            return r.status_code == 200
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Legacy fallback — used when extractor produces zero findings
    # ------------------------------------------------------------------

    def synthesize(self, results: list[ScanResult], days: int) -> tuple[str, dict]:
        sections: list[str] = []
        for r in results:
            if not r.items:
                continue
            sections.append(f"## {r.module_label}")
            for it in r.items[:5]:
                line = f"- **{(it.get('title') or '')[:160]}** — {(it.get('content') or '')[:200]}"
                if it.get("url"):
                    line += f" ([source]({it['url']}))"
                sections.append(line)
        body = "\n".join(sections) or "_No data collected._"
        return body, {}

    # ------------------------------------------------------------------
    # Main pipeline
    # ------------------------------------------------------------------

    def run(
        self,
        modules: list[str],
        days: int = 7,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> tuple[str, dict]:
        report, breakdown, _ = self.run_with_briefing(modules, days, progress_callback)
        return report, breakdown

    def run_with_briefing(
        self,
        modules: list[str],
        days: int = 7,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> tuple[str, dict, dict | None]:
        """Run the v2 pipeline. Returns (markdown, cost_breakdown, briefing_dict)."""
        selected = [self.MODULE_REGISTRY[m] for m in modules if m in self.MODULE_REGISTRY]
        if not selected:
            return "_No valid modules selected._", {}, None

        run_id = new_run_id()
        run_dir = scout_run_dir(run_id)

        total_steps = 1 + len(selected) + 1 + 1 + 1  # memory + N + extract + synth + persist
        step = 0

        def _tick(meta: dict | None = None) -> None:
            nonlocal step
            step += 1
            if progress_callback:
                progress_callback(step, total_steps, meta)

        # ---- 1. Memory ----
        index_rows = scout_memory.read_index(scout_index_path(), days=self._memory_days)
        snapshot = scout_memory.build_snapshot(index_rows)
        _tick({
            "module": "memory",
            "phase": "done",
            "message": (
                f"Memory loaded: {len(snapshot.covered_urls)} URLs, "
                f"{len(snapshot.covered_claim_fingerprints)} claims, "
                f"{snapshot.briefings_count} prior briefings."
            ),
        })

        # ---- 2. Gather (parallel) ----
        scan_results: list[ScanResult] = []

        def _module_progress(meta: dict) -> None:
            if progress_callback:
                progress_callback(step, total_steps, meta)

        def _run_one(scanner: BaseScanner) -> ScanResult:
            try:
                return scanner.gather(days=days, snapshot=snapshot, progress=_module_progress)
            except Exception as e:
                return ScanResult(
                    module_id=scanner.MODULE_ID,
                    module_label=scanner.MODULE_LABEL,
                    items=[],
                    error=str(e),
                )

        if self._concurrency > 1 and len(selected) > 1:
            with ThreadPoolExecutor(max_workers=min(self._concurrency, len(selected))) as pool:
                futures = {pool.submit(_run_one, sc): sc for sc in selected}
                for fut in as_completed(futures):
                    sc = futures[fut]
                    res = fut.result()
                    scan_results.append(res)
                    _tick({
                        "module": sc.MODULE_ID,
                        "phase": "error" if res.error else "done",
                        "message": (
                            f"{sc.MODULE_LABEL} failed: {res.error}"
                            if res.error
                            else f"{sc.MODULE_LABEL}: {len(res.items)} items"
                        ),
                    })
        else:
            for sc in selected:
                res = _run_one(sc)
                scan_results.append(res)
                _tick({
                    "module": sc.MODULE_ID,
                    "phase": "error" if res.error else "done",
                    "message": (
                        f"{sc.MODULE_LABEL} failed: {res.error}"
                        if res.error
                        else f"{sc.MODULE_LABEL}: {len(res.items)} items"
                    ),
                })

        # ---- 3. Extract ----
        findings, extractor_usage = extract(scan_results, snapshot)
        _tick({
            "module": "extractor",
            "phase": "done",
            "message": f"Extracted {len(findings)} findings.",
        })

        # ---- 4. Synthesize ----
        module_activity = {r.module_id: len(r.items) for r in scan_results}
        modules_used = [r.module_id for r in scan_results if r.items]
        if findings:
            briefing, synth_usage = synth_briefing(findings, modules_used, snapshot)
            briefing.module_activity = module_activity
        else:
            briefing = Briefing(
                lead="No findings extracted from collected sources.",
                modules_used=modules_used,
                module_activity=module_activity,
                memory_signals={
                    "covered_urls": len(snapshot.covered_urls),
                    "covered_claims": len(snapshot.covered_claim_fingerprints),
                    "briefings_count": snapshot.briefings_count,
                },
            )
            synth_usage = StageUsage()
        _tick({
            "module": "synthesizer",
            "phase": "done",
            "message": f"Briefing: {len(briefing.themes)} themes · {len(briefing.tensions)} tensions.",
        })

        # ---- 5. Persist ----
        markdown = render_briefing(briefing, days=days, run_id=run_id)
        (run_dir / "briefing.json").write_text(briefing.model_dump_json(indent=2))
        (run_dir / "briefing.md").write_text(markdown)

        claims = [
            CoveredClaim(
                id=f.id,
                claim=f.claim,
                source_url=f.source_url,
                fingerprint=scout_memory.claim_fingerprint(f.claim),
            )
            for f in briefing.findings
        ]
        index_row = IndexRow(
            run_id=run_id,
            created_at=datetime.now().isoformat(),
            modules=modules_used,
            days=days,
            lead=briefing.lead,
            claims=claims,
            gaps=briefing.gaps,
            rotation_cursor=snapshot.rotation_cursor + 1,
        )
        scout_memory.append_index(scout_index_path(), index_row)

        # Backwards-compat: legacy pulse_report.md location.
        legacy_path = outputs_dir() / "pulse_report.md"
        legacy_path.write_text(markdown)

        # Errors footer.
        errs = [(r.module_label, r.error) for r in scan_results if r.error]
        if errs:
            err_block = "\n".join(f"- **{lbl}**: {e}" for lbl, e in errs)
            markdown += f"\n\n---\n_Scanner warnings:_\n{err_block}\n"
            (run_dir / "briefing.md").write_text(markdown)
            legacy_path.write_text(markdown)

        _tick({
            "module": "persist",
            "phase": "done",
            "message": f"Saved briefing to {run_dir.relative_to(outputs_dir().parent)}.",
        })

        # ---- Cost breakdown (legacy shape + new stage detail) ----
        total_cost = round(extractor_usage.cost_usd + synth_usage.cost_usd, 6)
        cost_breakdown = {
            "scout": {
                "model": synth_usage.model or extractor_usage.model,
                "prompt_tokens": extractor_usage.input_tokens + synth_usage.input_tokens,
                "completion_tokens": extractor_usage.output_tokens + synth_usage.output_tokens,
                "total_tokens": (
                    extractor_usage.input_tokens + extractor_usage.output_tokens
                    + synth_usage.input_tokens + synth_usage.output_tokens
                ),
                "cost_usd": total_cost,
                "extractor": extractor_usage.model_dump(),
                "synthesizer": synth_usage.model_dump(),
            },
            "total_cost_usd": total_cost,
        }

        return markdown, cost_breakdown, briefing.model_dump()
