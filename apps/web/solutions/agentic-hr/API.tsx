'use client';

// ── Request bodies ──────────────────────────────────────────────────────────

const CHAT_REQUEST = `POST /chat
{
  "employee_email": "alexis.johnson@demo.local",
  "message": "I need access to Gitea for the new sprint",
  "session_id": "demo-7f42c1ab"   // optional — generated if omitted
}`;

const CHAT_RESPONSE_COMPLETE = `// status === "complete" — policy Q&A answer
{
  "response": "You have **14.5 hours** of annual leave remaining this quarter.",
  "intent": "leave_balance",
  "citations": [],
  "request_id": null,
  "status": "complete"
}`;

const CHAT_RESPONSE_POLICY = `// status === "complete" — policy query with citations
{
  "response": "Under the Remote Work Policy (§3.2), approval is required for stays…",
  "intent": "policy_query",
  "citations": [
    {
      "document": "hr_policy.pdf",
      "section": "3.2 Extended Remote Work",
      "chunk_id": "chunk_0042"
    }
  ],
  "request_id": null,
  "status": "complete"
}`;

const CHAT_RESPONSE_PENDING = `// status === "pending_approval" — access request created
{
  "response": "I have raised access request AR-1024 and notified your manager.",
  "intent": "access_request",
  "citations": [],
  "request_id": "AR-1024",
  "status": "pending_approval"
}`;

const PENDING_APPROVAL = `// GET /approvals — returns list[PendingApproval]
[
  {
    "request_id": "AR-1024",
    "requester_email": "alexis.johnson@demo.local",
    "requester_name": "Alexis Johnson",
    "packages": ["gitea-developer"],
    "status": "pending_approval",
    "created_ts": "2026-05-06T08:14:22"
  }
]`;

const APPROVAL_REQUEST = `POST /approvals/{request_id}
{
  "decision": "approved",     // "approved" | "denied"
  "approver_email": "vanshika.puri@demo.local"
}`;

const APPROVAL_RESPONSE = `// On approval — fulfillment triggers automatically
{ "request_id": "AR-1024", "status": "approved" }

// On approval with fulfillment error — access record preserved
{ "request_id": "AR-1024", "status": "approved",
  "fulfillment_error": "Gitea API timeout after 10s" }

// On denial
{ "request_id": "AR-1024", "status": "denied" }`;

// ── curl quick-tests ────────────────────────────────────────────────────────

const CURL_CHAT = `# Leave balance
curl -sX POST "$API/chat" \\
  -H "Content-Type: application/json" \\
  -d '{
    "employee_email": "alexis.johnson@demo.local",
    "message": "How much annual leave do I have left?"
  }' | jq .

# Access request — may return pending_approval
curl -sX POST "$API/chat" \\
  -H "Content-Type: application/json" \\
  -d '{
    "employee_email": "alexis.johnson@demo.local",
    "message": "I need access to Gitea for the sprint",
    "session_id": "demo-7f42c1ab"
  }' | jq .`;

const CURL_APPROVALS = `# List pending requests
curl "$API/approvals" | jq .

# Approve AR-1024 (triggers Gitea/Mattermost fulfillment)
curl -sX POST "$API/approvals/AR-1024" \\
  -H "Content-Type: application/json" \\
  -d '{
    "decision": "approved",
    "approver_email": "vanshika.puri@demo.local"
  }' | jq .

# Deny
curl -sX POST "$API/approvals/AR-1024" \\
  -H "Content-Type: application/json" \\
  -d '{
    "decision": "denied",
    "approver_email": "vanshika.puri@demo.local"
  }' | jq .`;

// ── sub-components ──────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:    'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  POST:   'border-blue-500/40   bg-blue-500/10   text-blue-200',
  PATCH:  'border-amber-500/40  bg-amber-500/10  text-amber-200',
  DELETE: 'border-red-500/40    bg-red-500/10    text-red-200',
};

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide ${METHOD_COLORS[method]}`}
    >
      {method}
    </span>
  );
}

function Endpoint({
  method,
  path,
  summary,
  note,
}: {
  method: HttpMethod;
  path: string;
  summary: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge method={method} />
        <span className="font-mono text-sm text-foreground">{path}</span>
      </div>
      <p className="mt-2 text-sm text-foreground/85">{summary}</p>
      {note && <p className="mt-1 text-xs text-foreground/60">{note}</p>}
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/65">
          {label}
        </p>
      )}
      <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-4 text-[13px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
      {children}
    </h3>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function API() {
  return (
    <div className="space-y-12">

      {/* Intro */}
      <div className="max-w-3xl space-y-3">
        <p className="text-base leading-relaxed text-foreground">
          Agentic HR exposes a compact task-oriented API built with FastAPI. A single{' '}
          <strong>chat turn</strong> routes through a LangGraph pipeline — intent triage, policy
          RAG, leave operations, or access provisioning — and returns a structured response with
          optional citations and an approval status. Inbound messages are evaluated by a configurable{' '}
          <strong>guardrail policy</strong> before reaching the graph.
        </p>
        <p className="text-sm text-foreground/80">
          Base URL:{' '}
          <code className="rounded bg-muted px-1 text-sm">NEXT_PUBLIC_AGENTIC_HR_API</code>{' '}
          env var (falls back to{' '}
          <code className="rounded bg-muted px-1 text-sm">/agentic-hr</code> inside the web app).
          Version:{' '}
          <code className="rounded bg-muted px-1 text-sm">0.1.0</code>.
        </p>
      </div>

      {/* Chat endpoint */}
      <section className="space-y-4">
        <SectionTitle>Chat</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          The primary endpoint. One message in, one structured reply out. The LangGraph pipeline
          handles routing transparently — the caller only needs to inspect{' '}
          <code className="rounded bg-muted px-1 text-sm">status</code> and{' '}
          <code className="rounded bg-muted px-1 text-sm">request_id</code> to know whether a
          follow-up action (approval, clarification) is required.
        </p>
        <div className="grid gap-3">
          <Endpoint
            method="POST"
            path="/chat"
            summary="Submit an employee message. Runs guardrail check, then routes through intent triage → tools → response synthesis."
            note="Returns 400 if the guardrail policy blocks the request."
          />
        </div>
        <CodeBlock label="Request" code={CHAT_REQUEST} />
        <div className="grid gap-4 lg:grid-cols-3">
          <CodeBlock label="Response — leave / policy (complete)" code={CHAT_RESPONSE_COMPLETE} />
          <CodeBlock label="Response — policy with citations" code={CHAT_RESPONSE_POLICY} />
          <CodeBlock label="Response — access request (pending_approval)" code={CHAT_RESPONSE_PENDING} />
        </div>
      </section>

      {/* Status semantics */}
      <section className="space-y-4">
        <SectionTitle>Status semantics</SectionTitle>
        <ul className="space-y-2">
          {[
            ['complete',             'Turn finished. No further action required from the client.'],
            ['pending_approval',     'An access request (AR-*) was raised and is awaiting manager decision.'],
            ['needs_clarification',  'The agent needs one more value before it can proceed (e.g. leave duration).'],
          ].map(([status, desc]) => (
            <li
              key={status}
              className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2"
            >
              <span className="font-mono text-[13px] text-foreground">{status}</span>
              <span className="text-sm text-foreground/70">— {desc}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Approvals endpoints */}
      <section className="space-y-4">
        <SectionTitle>Approvals</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          When the chat turn returns{' '}
          <code className="rounded bg-muted px-1 text-sm">pending_approval</code>, the manager
          reviews the request queue and posts a decision. Approval triggers automatic fulfillment
          (Gitea account creation, Mattermost channel invite); denial simply updates the record.
          Fulfillment errors are reported non-fatally so the approval is still preserved.
        </p>
        <div className="grid gap-3">
          <Endpoint
            method="GET"
            path="/approvals"
            summary="List all access requests currently in pending_approval status."
          />
          <Endpoint
            method="POST"
            path="/approvals/{request_id}"
            summary="Record a manager decision. 'approved' triggers async fulfillment; 'denied' closes the request."
            note="Returns 400 for invalid decision values. Returns 502 on database errors."
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeBlock label="GET /approvals response" code={PENDING_APPROVAL} />
          <CodeBlock label="POST /approvals/{id} request + responses" code={`${APPROVAL_REQUEST}\n\n${APPROVAL_RESPONSE}`} />
        </div>
      </section>

      {/* Health */}
      <section className="space-y-4">
        <SectionTitle>Health</SectionTitle>
        <div className="grid gap-3">
          <Endpoint
            method="GET"
            path="/health"
            summary='Returns {"status": "ok"}. Used for load-balancer and container health probes.'
          />
        </div>
      </section>

      {/* Quick test */}
      <section className="space-y-4">
        <SectionTitle>Quick test (curl)</SectionTitle>
        <CodeBlock label="Chat — leave query + access request" code={CURL_CHAT} />
        <CodeBlock label="Approvals — list → approve / deny" code={CURL_APPROVALS} />
      </section>

    </div>
  );
}
