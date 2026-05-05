'use client';

const CHAT_REQUEST = `{
  "session_id": "demo-7f42c1ab",
  "message": "I need access to Gitea",
  "employee_email": "alexis.johnson@demo.local"
}`;

const CHAT_RESPONSE = `{
  "session_id": "demo-7f42c1ab",
  "reply": "I have created request AR-1024 and sent it for manager approval.",
  "status": "pending_approval",
  "request_id": "AR-1024",
  "citations": []
}`;

const APPROVAL_DECISION = `{
  "decision": "approved",
  "approver_email": "vanshika.puri@demo.local",
  "reason": "Required for sprint onboarding"
}`;

const CURL_CHAT = `curl -X POST "$NEXT_PUBLIC_AGENTIC_HR_API/chat" \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "demo-7f42c1ab",
    "message": "How much PTO do I have?",
    "employee_email": "alexis.johnson@demo.local"
  }'`;

const CURL_APPROVALS = `curl -X GET "$NEXT_PUBLIC_AGENTIC_HR_API/approvals"`;

const CURL_DECIDE = `curl -X POST "$NEXT_PUBLIC_AGENTIC_HR_API/approvals/AR-1024" \\
  -H "Content-Type: application/json" \\
  -d '{
    "decision": "approved",
    "approver_email": "vanshika.puri@demo.local",
    "reason": "Policy check complete"
  }'`;

const STATUSES = [
  'complete: Turn finished with no pending action',
  'pending_approval: Tool action queued for manager decision',
  'needs_clarification: Assistant needs one follow-up value before proceeding',
];

const OPERATIONAL = [
  'GET /health',
  'GET /approvals',
  'POST /approvals/{id}',
];

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground">
      <code>{code}</code>
    </pre>
  );
}

function Endpoint({ method, path, summary }: { method: string; path: string; summary: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide">
          {method}
        </span>
        <span className="font-mono text-sm text-foreground">{path}</span>
      </div>
      <p className="mt-2 text-sm text-foreground/85">{summary}</p>
    </div>
  );
}

export default function API() {
  return (
    <div className="space-y-10">
      <div className="max-w-3xl space-y-3">
        <p className="text-base leading-relaxed text-foreground">
          Agentic HR exposes a task-oriented API for conversational HR workflows with approvals.
          The same surface supports policy Q&A, leave operations, and software-access requests that
          can pause for manager review.
        </p>
        <p className="text-sm text-foreground/85">
          Base URL is read from <span className="font-mono">NEXT_PUBLIC_AGENTIC_HR_API</span>{' '}
          (falls back to <span className="font-mono">/agentic-hr</span> in the web app).
        </p>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Core endpoints
        </h3>
        <div className="grid gap-3">
          <Endpoint
            method="POST"
            path="/chat"
            summary="Runs intent routing + tools and returns assistant reply with optional citations and approval status."
          />
          <Endpoint
            method="GET"
            path="/approvals"
            summary="Lists pending/processed access-approval requests for manager workflows."
          />
          <Endpoint
            method="POST"
            path="/approvals/{id}"
            summary="Records a manager decision (approved/denied) for a queued request."
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Chat request shape
        </h3>
        <CodeBlock code={CHAT_REQUEST} />
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Chat response shape
        </h3>
        <CodeBlock code={CHAT_RESPONSE} />
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Approval decision payload
        </h3>
        <CodeBlock code={APPROVAL_DECISION} />
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Status semantics
        </h3>
        <ul className="space-y-2 text-sm text-foreground/85">
          {STATUSES.map((line) => (
            <li key={line} className="rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Operational endpoints
        </h3>
        <ul className="space-y-2 text-sm text-foreground/85">
          {OPERATIONAL.map((line) => (
            <li key={line} className="rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Quick test commands
        </h3>
        <CodeBlock code={CURL_CHAT} />
        <CodeBlock code={CURL_APPROVALS} />
        <CodeBlock code={CURL_DECIDE} />
      </section>
    </div>
  );
}
