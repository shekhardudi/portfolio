import type { SolutionMeta } from '../_types';

export const meta: SolutionMeta = {
  slug: 'intelli-search',
  title: 'IntelliSearch',
  tagline:
    'Hybrid search over millions of LinkedIn profiles — BM25 + kNN + agentic re-ranking, routed by an intent classifier.',
  category: 'search',
  status: 'live',
  featured: true,
  hero: { accent: 'from-cyan-500 to-blue-700', icon: 'Search' },
  stack: ['FastAPI', 'OpenSearch', 'sentence-transformers', 'GPT-4o-mini', 'Redis'],
  highlights: [
    'Three execution modes: regular / semantic / agentic',
    'Reciprocal Rank Fusion across signals',
    'Pre-warmed HNSW graph (5–7 GB) on cold start',
    'Server-Sent Events for streaming results',
  ],
  tabs: ['overview', 'demo', 'architecture', 'api'],
  architecture: {
    image: '/architectures/intelli-search.png',
    alt: 'IntelliSearch architecture diagram',
  },
  apiBaseEnvVar: 'NEXT_PUBLIC_INTELLI_SEARCH_API',
};

export default meta;
