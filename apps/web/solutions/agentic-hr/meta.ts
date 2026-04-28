import type { SolutionMeta } from '../_types';

export const meta: SolutionMeta = {
  slug: 'agentic-hr',
  title: 'Agentic HR',
  tagline:
    'LangGraph-orchestrated HR assistant with RAG over policy PDFs, tool-calling for HRIS systems, and human-in-the-loop approvals.',
  category: 'agents',
  status: 'live',
  featured: true,
  hero: { accent: 'from-violet-500 to-fuchsia-700', icon: 'Users' },
  stack: ['FastAPI', 'LangGraph', 'pgvector', 'NocoDB', 'Gitea', 'Mattermost'],
  highlights: [
    'Conversational with persistent session_id',
    'Approval queue gates destructive tool calls',
    'pgvector RAG over hr_policy_pdfs corpus',
    'Tools wired into NocoDB / Gitea / Mattermost',
  ],
  tabs: ['overview', 'demo', 'architecture', 'api'],
  apiBaseEnvVar: 'NEXT_PUBLIC_AGENTIC_HR_API',
};

export default meta;
