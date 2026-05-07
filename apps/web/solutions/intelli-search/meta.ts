import type { SolutionMeta } from '../_types';

export const meta: SolutionMeta = {
  slug: 'intelli-search',
  title: 'Intelli Search',
  tagline:
    'Hybrid search over millions of company profiles — an intent classifier routes each query through BM25, vector kNN, or an agentic web-augmented pipeline.',
  category: 'search',
  status: 'live',
  featured: true,
  hero: { accent: 'from-cyan-500 to-blue-700', icon: 'Search' },
  stack: ['FastAPI', 'OpenSearch', 'sentence-transformers', 'GPT-4o-mini', 'Redis', 'Tavily / SerpAPI'],
  highlights: [
    'LLM intent classifier picks regular / semantic / agentic per query',
    'BM25 + vector kNN fused with Reciprocal Rank Fusion',
    'Agentic mode plans, web-searches, and rewrites for off-corpus questions',
    'Redis cache, circuit breakers, PII scrubbing on the hot path',
  ],
  tabs: ['overview', 'demo', 'architecture', 'api'],
  architecture: {
    strategy: 'mermaid',
    image: '/architectures/intelli-search/diagram.png',
    alt: 'IntelliSearch architecture diagram',
    mermaid: {
      sourcePath: '/architectures/intelli-search/diagram.mmd',
      theme: 'dark',
    },
  },
  apiBaseEnvVar: 'NEXT_PUBLIC_INTELLI_SEARCH_API',
};

export default meta;
