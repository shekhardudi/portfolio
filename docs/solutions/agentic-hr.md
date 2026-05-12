# agentic-hr — high-level flow

An HR copilot built on **LangGraph**: a single chat endpoint routes the
employee's message through an intent classifier, then dispatches to one of
several worker pipelines (leave balance, leave application, policy RAG,
access provisioning, access-request status). Destructive actions
(provisioning, leave application) are gated behind a manager-approval
queue. Long-running LangGraph runs survive client disconnects via a
detached-task pattern with a polling endpoint.

## Diagram

```
┌──────────────────────┐   POST /chat {session_id, message, request_id}
│   Next.js frontend   │  ────────────────────────────────────────────►
│  Chat / Approvals    │
│  PersonaSelector     │  ◄────────────────────────────────────────────
└──────────┬───────────┘   ChatResponse OR  202 + poll via
           │                GET /chat/result/{request_id}
           ▼
┌────────────────────────────────────────────────────────────────────┐
│                  FastAPI :8000  (api/chat.py)                       │
│                                                                     │
│  Detached task model:                                               │
│    • asyncio.shield wraps the LangGraph invocation                  │
│    • Client disconnect does NOT kill the task — result lands in     │
│      _RESULT_CACHE keyed by request_id (10-min TTL)                 │
│    • GET /chat/result/{request_id} → "running" | "completed"        │
│      | "error" | 404                                                │
│    • DELETE /chat/{session_id} explicitly cancels the task          │
│                                                                     │
│  Inbound guardrail:                                                 │
│    GuardrailPolicy.evaluate_inbound(message)                        │
│    → BLOCK on prompt-injection / high-risk PII                      │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              LangGraph compiled state machine                       │
│                 (graph/builder.py — 19 nodes)                       │
│                                                                     │
│  ┌──────────────────────┐                                           │
│  │   classify_intent    │  (entry point)                            │
│  └──────────┬───────────┘                                           │
│             │  route_intent                                         │
│   ┌─────────┼──────────┬──────────────┬───────────────┐             │
│   ▼         ▼          ▼              ▼               ▼             │
│ clarify  resolve_user  policy_rewrite unsupported    (compose)      │
│            │                                                        │
│   ┌────────┼────────────┬───────────────────┐                       │
│   ▼        ▼            ▼                   ▼                       │
│ leave_   leave_apply_   provision_map   access_request_status       │
│ balance   gather                                                    │
│   │       │              │                                          │
│   │   calculate         eligibility ─► request ─► fulfill ─► verify │
│   │       │              │                                          │
│   │   update             ▼                                          │
│   │       │           (creates AR-* pending-approval row in         │
│   │       │            Postgres; surfaces in Approvals UI)          │
│   │       ▼                                                         │
│   └────► compose_response ───► audit ───► END                       │
│             │                                                       │
│             ▼                                                       │
│   ChatResponse { response, citations, request_id?, status }         │
└────────────────────────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼───────────────────────────┐
        ▼                        ▼                           ▼
  ┌─────────────┐         ┌──────────────┐           ┌───────────────┐
  │  Postgres   │         │ Policy docs  │           │ Tool clients  │
  │  pgvector   │         │ + child-     │           │ (MCP-style)   │
  │  + audit    │         │ chunk RAG    │           │ NocoDB / Gitea│
  │  + AR-*     │         │ embeddings   │           │ / Mattermost  │
  └─────────────┘         └──────────────┘           └───────────────┘
```

## Request lifecycle

1. **Chat send** — Frontend mints a `request_id` (UUID), persists it in
   sessionStorage, then `POST /chat`.
2. **Guardrail** — Inbound message runs through `GuardrailPolicy`;
   prompt-injection or high-risk PII returns 400.
3. **LangGraph runs** as an `asyncio.Task` shielded from the request's
   own cancellation. Nodes execute in sequence based on intent:
   * **Leave balance** — `leave_balance` reads from NocoDB → composes.
   * **Leave application** — `leave_apply_gather` → `calculate` →
     `update` (or compose for clarification).
   * **Policy query** — `policy_rewrite` → `retrieve` (pgvector child
     chunks) → `expand` (parent sections) → `grade_answer`.
   * **Access provisioning** — `provision_map` → `eligibility` →
     `request` (creates AR-* row, status=pending) → after manager
     approval: `fulfill` → `verify`.
   * **Access status** — `access_request_status` reads AR-* rows for
     the employee.
4. **compose_response** turns the populated `AgentState` into a markdown
   reply with citations.
5. **audit** writes the run to Postgres `audit` table.
6. **Result lands** in `_RESULT_CACHE[request_id]`. If the original
   request is still listening, response returns directly; otherwise the
   client reattaches via `GET /chat/result/{request_id}` on remount
   ([Demo.tsx](../../apps/web/solutions/agentic-hr/Demo.tsx) resume
   effect).

## Approvals queue (manager flow)

Provisioning and leave application emit pending **AR-\*** rows. The
Approvals tab polls `GET /approvals` every 10s. Manager picks a persona,
clicks Approve/Reject, frontend `POST /approvals/{id}` → backend records
decision → audit → eventual fulfillment kicks in for approved rows.

## Key files

| Concern | Path |
|---|---|
| HTTP routes | [services/agentic-hr/backend/api/chat.py](../../services/agentic-hr/backend/api/chat.py) |
| Graph definition | [services/agentic-hr/backend/graph/builder.py](../../services/agentic-hr/backend/graph/builder.py) |
| Per-node logic | [services/agentic-hr/backend/graph/nodes/](../../services/agentic-hr/backend/graph/nodes/) |
| Guardrails | [services/agentic-hr/backend/guardrails/policy.py](../../services/agentic-hr/backend/guardrails/policy.py) |
| Frontend resume polling | [apps/web/solutions/agentic-hr/Demo.tsx](../../apps/web/solutions/agentic-hr/Demo.tsx) |
| Chat client | [apps/web/solutions/agentic-hr/client.ts](../../apps/web/solutions/agentic-hr/client.ts) |
