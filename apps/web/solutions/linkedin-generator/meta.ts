import type { SolutionMeta } from '../_types';

export const meta: SolutionMeta = {
  slug: 'linkedin-generator',
  title: 'LinkedIn Auth',
  tagline:
    'Two-stage pipeline — Pulse Scout briefs from the open web, Authority Crew turns a chosen angle into a posted-ready draft and cover image.',
  category: 'content',
  status: 'live',
  featured: true,
  hero: { accent: 'from-amber-500 to-orange-700', icon: 'PenLine' },
  stack: ['CrewAI', 'FastAPI', 'OpenAI', 'Anthropic', 'Tavily', 'gpt-image-1'],
  highlights: [
    'Pulse Scout: Agentic Market Analyst for AI trends, across multiple signals and sources',
    'Multi-agent Crew: Researcher → Writer → Critic → Visual Director',
    'Async job API with streaming progress; survives long timeouts',
    'Per-IP rate limits, cover image via gpt-image-1, configurable voice',
  ],
  tabs: ['overview', 'demo', 'architecture', 'api'],
  architecture: {
    strategy: 'mermaid',
    mermaid: {
      sourcePath: '/architectures/linkedin-generator/diagram.mmd',
      theme: 'dark',
    },
  },
  apiBaseEnvVar: 'NEXT_PUBLIC_LINKEDIN_API',
};

export default meta;
