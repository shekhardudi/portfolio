# agentic-hr

LangGraph-orchestrated HR assistant with RAG over policy PDFs, tool-calling for HRIS systems (NocoDB / Gitea / Mattermost), and a human-in-the-loop approval workflow.

## Endpoints

| Method | Path                          | Notes                                    |
|--------|-------------------------------|------------------------------------------|
| POST   | `/chat`                       | Conversational endpoint (`session_id`)   |
| GET    | `/approvals`                  | List pending approvals                   |
| POST   | `/approvals`                  | Approve/reject a tool call               |
| GET    | `/health`                     | Liveness                                 |

## Local run

```
docker build -t agentic-hr ./backend
docker run --rm -p 8002:8000 \
  --env-file backend/.env \
  -e BACKEND_PORT=8000 \
  agentic-hr
```

## Prod port

`8002` on the host (mapped to container `:8000` by default; container respects `BACKEND_PORT`).

## Data dependencies

- Postgres (with pgvector) — chat history + RAG embeddings + nocodb/gitea/mattermost DBs
- NocoDB — HR record CRUD UI
- Gitea — code-review workflow demo
- Mattermost — chat-driven request demo

All four are wired up in `infra/docker/docker-compose.prod.yml`.

## Bootstrapping the DB

`init-db.sh` creates `agentic_hr`, `nocodb`, `gitea`, `mattermost` databases + the `vector` extension on first Postgres boot.
