import type { SolutionMeta } from '../_types';

export const meta: SolutionMeta = {
  slug: 'linkedin-generator',
  title: 'LinkedIn Generator',
  tagline:
    'Multi-agent CrewAI system that drafts authority-style LinkedIn posts from a topic + leader angle. Async job model.',
  category: 'content',
  status: 'live',
  featured: true,
  hero: { accent: 'from-amber-500 to-orange-700', icon: 'PenLine' },
  stack: ['CrewAI', 'FastAPI', 'OpenAI', 'Anthropic', 'Tavily'],
  highlights: [
    'Async POST /generate → poll GET /jobs/{id}',
    'Multi-agent reasoning with web research',
    'Configurable author voice + cadence',
    '60-180s typical run; survives nginx timeouts',
  ],
  tabs: ['overview', 'demo', 'architecture', 'api'],
  apiBaseEnvVar: 'NEXT_PUBLIC_LINKEDIN_API',
};

export default meta;
