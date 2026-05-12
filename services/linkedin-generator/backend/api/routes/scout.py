"""Pulse Scout endpoints — POST starts a job, GET polls."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.api.deps import get_job_runner, get_job_store
from backend.api.schemas import JobRef, ScoutJob, ScoutJobResult, ScoutRequest
from backend.core.jobs import Job, JobRunner, JobStore
from backend.core.logging import get_logger
from backend.guardrails import scrub_output

router = APIRouter(prefix="/scout", tags=["scout"])
log = get_logger("api.scout")


def _scrub_briefing_pii(briefing: dict | None) -> dict | None:
    """Walk a briefing dict and strip emails/phones from every user-visible
    text field. Names + everything else pass through. No-op for empty/None.

    Mutates and returns the same dict for caller convenience.
    """
    if not isinstance(briefing, dict):
        return briefing
    if briefing.get("lead"):
        briefing["lead"] = scrub_output(briefing["lead"])
    for sig in briefing.get("signals") or []:
        for field in ("headline", "summary", "post_angle"):
            if isinstance(sig.get(field), str):
                sig[field] = scrub_output(sig[field])
    for f in briefing.get("findings") or []:
        for field in ("claim", "why_it_matters"):
            if isinstance(f.get(field), str):
                f[field] = scrub_output(f[field])
    return briefing


@router.post("", response_model=JobRef, status_code=202)
async def start_scout(
    body: ScoutRequest,
    store: JobStore = Depends(get_job_store),
    runner: JobRunner = Depends(get_job_runner),
) -> JobRef:
    job = store.create("scout", body.model_dump())
    runner.schedule(job, _scout_worker)
    return JobRef(job_id=job.id, status=job.status.value)


@router.get("/{job_id}", response_model=ScoutJob)
def get_scout(job_id: str, store: JobStore = Depends(get_job_store)) -> ScoutJob:
    job = store.get(job_id)
    if not job or job.kind != "scout":
        raise HTTPException(status_code=404, detail="scout job not found")
    return _to_schema(job)


@router.delete("/{job_id}", status_code=202)
def cancel_scout(
    job_id: str,
    store: JobStore = Depends(get_job_store),
    runner: JobRunner = Depends(get_job_runner),
) -> dict[str, Any]:
    """Best-effort cancel — frees the worker slot in real time.

    Returns 202 even when the job is already terminal so the client doesn't
    need to special-case races between its own reset click and a job that
    just finished server-side.
    """
    job = store.get(job_id)
    if not job or job.kind != "scout":
        raise HTTPException(status_code=404, detail="scout job not found")
    cancelled = runner.cancel(job_id)
    return {"job_id": job_id, "cancelled": cancelled, "status": store.get(job_id).status.value if store.get(job_id) else "unknown"}


def _to_schema(job: Job) -> ScoutJob:
    result = None
    if job.result:
        result = ScoutJobResult(**job.result)
    return ScoutJob(
        job_id=job.id,
        status=job.status.value,
        created_at=job.created_at,
        updated_at=job.updated_at,
        progress=job.progress,
        result=result,
        error=job.error,
    )


# ---------------------------------------------------------------------------
# Worker — runs the Pulse Scout sync engine in a thread.
# ---------------------------------------------------------------------------

async def _scout_worker(job: Job, store: JobStore) -> dict[str, Any]:
    from backend.scout.engine import PulseScout
    from datetime import datetime, timezone

    scout = PulseScout()
    modules: list[str] = job.inputs["modules"]
    days: int = int(job.inputs.get("days", 7))
    callbacks: list[dict[str, Any]] = []

    loop = asyncio.get_running_loop()

    def progress_cb(step: int, total: int, meta: dict[str, Any] | None = None) -> None:
        # Called from worker thread. JobStore.update has its own lock,
        # so it's safe to call directly.
        data = meta or {}
        cb = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "module": data.get("module") or "",
            "phase": data.get("phase") or "progress",
            "message": data.get("message") or f"step {step}/{total}",
        }
        callbacks.append(cb)
        store.update(
            job.id,
            progress={
                "step": step,
                "total": total,
                "module": cb["module"],
                "phase": cb["phase"],
                "message": cb["message"],
                "callbacks": callbacks[-60:],
            },
        )

    def _run() -> tuple[str, dict, dict | None]:
        return scout.run_with_briefing(modules=modules, days=days, progress_callback=progress_cb)

    report, cost_breakdown, briefing = await loop.run_in_executor(None, _run)
    # Output guardrail: strip emails / phone numbers from every user-visible
    # text in the briefing so stray PII the LLM may have echoed never reaches
    # the client. Names + dates + URLs pass through unchanged so attribution
    # ("Andrej Karpathy said X") and timestamps stay intact.
    briefing = _scrub_briefing_pii(briefing)
    return {
        "report_md": scrub_output(report) if isinstance(report, str) else report,
        "modules": modules,
        "days": days,
        "cost_breakdown": cost_breakdown,
        "briefing": briefing,
    }
