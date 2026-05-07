import type { SolutionMeta } from '../_types';

export const meta: SolutionMeta = {
  slug: 'agentic-hr',
  title: 'Agentic HR',
  tagline:
    'LangGraph HR copilot that triages intent into policy RAG, leave operations, or access provisioning — with manager approvals before anything mutates.',
  category: 'agents',
  status: 'live',
  featured: true,
  hero: { accent: 'from-violet-500 to-fuchsia-700', icon: 'Users' },
  stack: ['FastAPI', 'LangGraph', 'pgvector', 'NocoDB', 'Gitea', 'Mattermost'],
  highlights: [
    'Intent triage routes to policy / leave / access subgraphs',
    'Self-grading policy RAG over pgvector with citations',
    'Human-in-the-loop approval gate on every write',
    'Approved actions fulfill via Gitea + Mattermost; full audit trail',
  ],
  tabs: ['overview', 'demo', 'architecture', 'api'],
  architecture: {
    strategy: 'mermaid',
    image: '/architectures/agentic-hr/diagram.png',
    alt: 'Agentic HR architecture diagram',
    mermaid: {
      sourcePath: '/architectures/agentic-hr/diagram.mmd',
      theme: 'dark',
    },
  },
  apiBaseEnvVar: 'NEXT_PUBLIC_AGENTIC_HR_API',
};

export default meta;
