# linkedin-generator

CrewAI multi-agent system that drafts authority-style LinkedIn posts from a topic and
leader angle. The Streamlit UI from the source repo isn't ported — production uses an
async FastAPI wrapper instead.

## Why async + job-based

A single Authority Crew run is ~60–180s: researcher agent issues Tavily queries,
strategist plans the post, writer drafts and self-edits. Synchronous responses would:

- Tie up an nginx connection for ≥1 min (CloudFront caps origin response at 60s by default).
- Make UX terrible — no progress indicator, no error recovery, hung browsers.

Job-based fixes both: the `POST /generate` returns a `job_id` in <1s, the frontend
polls `GET /jobs/{id}` every 3s.

## Endpoints

```
POST /generate     { topic, leader_angle, author_* }     -> 202 { job_id, status: "queued" }
GET  /jobs/{id}                                          -> JobRecord
GET  /jobs                                               -> JobRecord[]
GET  /health
```

`JobRecord.status` ∈ `queued | running | succeeded | failed`. On success, `result` is the
final post text. On failure, `error` has the traceback.

## Job store

In-memory `dict` guarded by a `threading.Lock`. Process restart drops jobs — that's fine
for the portfolio because each run is independent and short-lived. Rationale:

- Adding Redis just for this would be infrastructure for nothing.
- Demo traffic is single-digit RPS at peak.
- Jobs have no value after completion (results are shown once, then forgotten).

If this scales beyond one box: swap `_jobs` for a Redis hash, no other changes.

## Local dev

```bash
cd services/linkedin-generator
docker build -t linkedin-generator .
docker run --rm -p 8003:8000 --env-file .env linkedin-generator
curl -X POST http://localhost:8003/generate \
  -H 'Content-Type: application/json' \
  -d '{"topic":"agents","leader_angle":"most are overengineered"}'
```

## Required keys

`OPENAI_API_KEY` (Crew uses it by default). `ANTHROPIC_API_KEY` and `TAVILY_API_KEY`
are recommended — without Tavily the researcher agent has no web access.
