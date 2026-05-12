'use client';

import { ClipboardCheck, Database, FileSearch, ShieldCheck, Users, Wrench } from 'lucide-react';

const FLOW = [
  {
    name: 'RAG Policy Retrieval',
    tag: 'pgvector',
    description:
      'Pulls grounded context from HR policy PDFs so answers stay anchored to company rules, not model guesswork.',
  },
  {
    name: 'Tool Execution',
    tag: 'NocoDB · Gitea · Mattermost',
    description:
      'Routes action-oriented requests to system tools for records, collaboration, and task operations.',
  },
  {
    name: 'Human Approval Gate',
    tag: '/approvals',
    description:
      'Pauses sensitive or destructive actions and requires explicit human approval before execution.',
  },
];

const PILLARS = [
  {
    icon: FileSearch,
    title: 'Policy-First Answers',
    body: 'The assistant starts with retrieval over embedded policy documents before drafting a response. This sharply reduces hallucinations in compliance-sensitive HR scenarios.',
  },
  {
    icon: Wrench,
    title: 'Actionable, Not Just Conversational',
    body: 'Beyond Q&A, the graph can trigger structured tool calls against HRIS-style systems and internal workflows. It can read, reason, and act within one conversation loop.',
  },
  {
    icon: ShieldCheck,
    title: 'Guardrails on Input and Output',
    body: 'Requests and model outputs run through safety checks for PII leakage, prompt-injection patterns, and policy violations before anything reaches end users.',
  },
  {
    icon: ClipboardCheck,
    title: 'Approval Queue for Risky Actions',
    body: 'Potentially destructive actions are intercepted and parked in an approval queue. Human reviewers can approve or reject with reason codes through API endpoints.',
  },
  {
    icon: Database,
    title: 'Persistent Sessions via LangGraph Checkpoints',
    body: 'Conversation state is checkpointed in Postgres by session id, so context survives restarts and users can continue from where they left off.',
  },
  {
    icon: Users,
    title: 'Built for Enterprise HR Operations',
    body: 'The architecture is intentionally auditable: traceable decisions, explicit tools, deterministic approvals, and a clear boundary between retrieval and action.',
  },
];

export default function Overview() {
  return (
    <div className="space-y-12">
      <div className="max-w-5xl space-y-4">
        <p className="text-lg leading-relaxed text-foreground md:text-justify">
          Agentic HR is a LangGraph-orchestrated HR assistant designed for environments where
          answers must be grounded and actions must be controlled. It combines policy-aware RAG,
          tool-calling into HR systems, and a mandatory human approval path for risky operations.
        </p>
        <p className="text-base leading-relaxed text-foreground/85 md:text-justify">
          In short: this is not a generic chatbot. It is an execution framework for HR workflows
          where correctness, safety, and auditability matter as much as language quality.
        </p>
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Operating flow
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {FLOW.map((item) => (
            <div key={item.name} className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">{item.name}</span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground/80">
                  {item.tag}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-foreground/85">{item.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Why this architecture works
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                <Icon className="h-4 w-4 text-foreground/80" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-foreground/95">{title}</div>
                <p className="text-sm leading-relaxed text-foreground/85">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Stack
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            'FastAPI',
            'LangGraph',
            'Postgres + pgvector',
            'NocoDB',
            'Gitea',
            'Mattermost',
            'Approval Queue API',
            'Policy RAG Pipeline',
            'Claude Haiku 4-5 (intent routing · grading)',
            'Claude Sonnet 4-6 (answer generation)',
            'all-MiniLM-L6-v2 (policy embeddings)',
          ].map((item) => (
            <span
              key={item}
              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-sm text-foreground/90"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
