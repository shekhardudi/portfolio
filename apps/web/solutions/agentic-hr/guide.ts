/**
 * Inline help content — port of HOW_IT_WORKS + TIPS markdown blocks
 * from agentic_hr/ui/pages/chat.py.
 */

export const HOW_IT_WORKS = `This is an **agentic HR assistant** powered by a LangGraph state-machine. Each query flows through a multi-step pipeline:

**1 — Intent Detection**
Your message is classified into one of the supported intents by an LLM triage agent.

**2 — Employee Resolution**
Your persona is looked up in NocoDB to fetch your employee profile and team info.

**3 — Specialised Processing**
Based on intent, the request is routed to a dedicated pipeline:

- **Leave Balance** — Fetches leave data from NocoDB and formats balances by type.
- **Apply for Leave** — Collects leave type & duration, calculates hours (1 day = 8 hrs), validates against your balance, and updates NocoDB.
- **Policy Query** — Rewrites your query, retrieves matching chunks from pgvector, grades evidence, and synthesises an answer with citations.
- **Software Access** — Maps to access packages, checks eligibility, creates a Postgres request, provisions accounts via Gitea / Mattermost APIs.
- **Access Status** — Queries Postgres for your requests joined with package details.

**4 — Response Composition**
Output is formatted into a Markdown-rich response with citations where applicable.

**5 — Audit Trail**
Every interaction is logged with intent, status, and timing metadata.`;

export const TIPS: { title: string; body: string }[] = [
  {
    title: 'Switching personas',
    body: 'Use the dropdown to test as different employees. Each persona has its own leave balances, manager, and access packages.',
  },
  {
    title: 'Apply for leave',
    body: 'Say “I want to take 3 days annual leave”. If you omit the type or duration the assistant will ask one follow-up question before submitting.',
  },
  {
    title: 'Check access requests',
    body: 'Ask “What’s the status of my Gitea request?” for a specific system, or “Show all my requests” for everything.',
  },
  {
    title: 'Manager approvals',
    body: 'Open the Approvals tab to approve or deny pending software-access requests. Provisioning in Gitea and Mattermost runs automatically once approved.',
  },
  {
    title: 'Policy citations',
    body: 'Policy answers include the source document and section. Ask follow-up questions — the assistant rewrites and re-searches on each turn.',
  },
  {
    title: 'Integrated systems',
    body: 'The chips above the chat link to the live NocoDB, Gitea, and Mattermost instances backing every response.',
  },
];
