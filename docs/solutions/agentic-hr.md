# agentic-hr

LangGraph-orchestrated HR assistant with RAG, tool-use, and human-in-the-loop approvals.

## Why this shape

A pure RAG bot answers questions but can't *do* anything. A pure tool-using agent can do
anything — including wrong things. The compromise:

1. **RAG node** for retrieval over policy PDFs (pgvector, sentence-transformers).
2. **Tool router** for actions on NocoDB (HR records), Gitea (code review), Mattermost (chat).
3. **Guardrails** filter both inputs (PII / prompt injection) and outputs.
4. **Approval queue** intercepts tool calls flagged as destructive — they pause until a
   human approves via the `/approvals` endpoint.

## Endpoints

```
POST /chat              { session_id, message }      -> { reply, tool_calls?, pending_approvals? }
GET  /approvals         ?session_id=...              -> ApprovalItem[]
POST /approvals         { id, decision, reason? }    -> ApprovalItem
GET  /health
```

## Sessions

`session_id` is opaque — anything client-generated works (the Demo uses `crypto.randomUUID()`).
LangGraph checkpoints state in Postgres keyed on this id, so conversations persist across
restarts. No auth in v1.

## Data deps

| Service | Role |
|---|---|
| Postgres + pgvector | LangGraph state, RAG embeddings, NocoDB/Gitea/Mattermost backing DBs |
| NocoDB | HR records (employees, leave, payroll demo data) |
| Gitea | Internal git for code-review agent demo |
| Mattermost | Chat app for the chat-driven request demo |

`init-db.sh` creates all four databases + the `vector` extension on first Postgres boot.

## Local dev

```bash
cd services/agentic-hr/backend
docker build -t agentic-hr .
docker run --rm -p 8002:8000 --env-file .env -e BACKEND_PORT=8000 agentic-hr
```

You'll need a Postgres instance running externally (or use the full
`infra/single-ec2/docker/docker-compose.prod.yml`).
