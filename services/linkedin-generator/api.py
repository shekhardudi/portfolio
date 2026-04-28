"""
FastAPI wrapper around the LinkedIn Post Generator Authority Crew.

Endpoints
- POST /generate     -> kicks off a crew run in a background thread, returns job_id
- GET  /jobs/{id}    -> poll job status / fetch result
- GET  /health       -> liveness probe

Job store is in-memory (dict). Process restart wipes jobs — that's fine for the
portfolio demo. Swap to Redis if multi-replica becomes a real concern.
"""

from __future__ import annotations

import logging
import os
import threading
import traceback
import uuid
from datetime import date, datetime, timedelta
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("linkedin-generator-api")

JobStatus = Literal["queued", "running", "succeeded", "failed"]


class GenerateRequest(BaseModel):
    topic: str = Field(..., min_length=3, max_length=500)
    leader_angle: str = Field(..., min_length=3, max_length=1000)
    author_name: Optional[str] = None
    author_title: Optional[str] = None
    author_location: Optional[str] = None
    author_vibe: Optional[str] = "calm, direct, and slightly skeptical"


class JobRecord(BaseModel):
    job_id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    request: GenerateRequest
    result: Optional[str] = None
    error: Optional[str] = None


_jobs: dict[str, JobRecord] = {}
_jobs_lock = threading.Lock()


def _set_status(job_id: str, status: JobStatus, *, result: str | None = None, error: str | None = None) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.status = status
        job.updated_at = datetime.utcnow()
        if result is not None:
            job.result = result
        if error is not None:
            job.error = error


def _build_inputs(req: GenerateRequest) -> dict:
    today = date.today()
    return {
        "topic": req.topic,
        "leader_angle": req.leader_angle,
        "author_name": req.author_name or "Shekhar Dudi",
        "author_title": req.author_title or "AI Engineer",
        "author_location": req.author_location or "Remote",
        "author_vibe": req.author_vibe or "calm, direct, and slightly skeptical",
        "current_year": str(today.year),
        "current_date": today.strftime("%B %d, %Y"),
        "current_date_minus_90": (today - timedelta(days=90)).strftime("%B %d, %Y"),
    }


def _run_crew(job_id: str, req: GenerateRequest) -> None:
    """Worker that runs in a background thread."""
    try:
        _set_status(job_id, "running")
        log.info("crew.start", extra={"job_id": job_id, "topic": req.topic})
        # Imported lazily so module import (and FastAPI startup) stays fast.
        from linkedin_post_generator.engines.authority_crew.crew import AuthorityCrew

        output = AuthorityCrew().crew().kickoff(inputs=_build_inputs(req))
        # CrewAI returns either a string or an object with .raw — normalize.
        text = getattr(output, "raw", None) or str(output)
        _set_status(job_id, "succeeded", result=text)
        log.info("crew.done", extra={"job_id": job_id, "chars": len(text)})
    except Exception as e:
        log.exception("crew.failed job=%s", job_id)
        _set_status(
            job_id,
            "failed",
            error=f"{type(e).__name__}: {e}\n\n{traceback.format_exc(limit=3)}",
        )


# ---------------------------------------------------------------------------

app = FastAPI(
    title="LinkedIn Post Generator API",
    description="FastAPI wrapper around the Authority Crew (CrewAI).",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "jobs_in_memory": len(_jobs)}


@app.post("/generate", status_code=202)
def generate(req: GenerateRequest) -> dict:
    job_id = uuid.uuid4().hex
    now = datetime.utcnow()
    record = JobRecord(
        job_id=job_id,
        status="queued",
        created_at=now,
        updated_at=now,
        request=req,
    )
    with _jobs_lock:
        _jobs[job_id] = record
    threading.Thread(target=_run_crew, args=(job_id, req), daemon=True).start()
    return {"job_id": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> JobRecord:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.get("/jobs")
def list_jobs(limit: int = 20) -> list[JobRecord]:
    with _jobs_lock:
        return sorted(_jobs.values(), key=lambda j: j.created_at, reverse=True)[:limit]
