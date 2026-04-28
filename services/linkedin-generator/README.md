# linkedin-generator

CrewAI multi-agent system that drafts authority-style LinkedIn posts from a topic + leader angle. Streamlit UI lives in the source repo; this package ships only the FastAPI wrapper for the portfolio demo.

## Endpoints

| Method | Path             | Notes                                       |
|--------|------------------|---------------------------------------------|
| POST   | `/generate`      | 202 Accepted; returns `job_id`              |
| GET    | `/jobs/{id}`     | Poll status (`queued`/`running`/`succeeded`/`failed`) + final post |
| GET    | `/jobs`          | List recent jobs                            |
| GET    | `/health`        | Liveness                                    |

## Local run

```
docker build -t linkedin-generator .
docker run --rm -p 8003:8000 --env-file .env linkedin-generator
```

## Prod port

`8003` on the host (mapped to container `:8000`).

## Why async / job-based

A single Authority Crew run can take 60-180s (multi-agent reasoning + Tavily lookups). Synchronous responses would tie up nginx / CloudFront connections. The job model lets the frontend show progress and hides cold starts.

## Job store

In-memory dict, single-process. Sufficient for the portfolio's expected QPS. Swap for Redis if multi-replica becomes a concern.
