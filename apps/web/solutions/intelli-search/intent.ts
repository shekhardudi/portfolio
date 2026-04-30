/**
 * Intent banner config — ported from intelli-search/frontend/src/components/ResultsList.tsx.
 */

export type Intent = 'regular' | 'semantic' | 'agentic';

export interface IntentBannerConfig {
  label: string;
  color: string;
  banner: (q: string, n: number) => string;
}

export const INTENT_CFG: Record<Intent, IntentBannerConfig> = {
  regular: {
    label: 'Exact Match',
    color: '#2563eb',
    banner: (q, n) => `${n.toLocaleString()} companies matching "${q}"`,
  },
  semantic: {
    label: 'Semantic',
    color: '#7c3aed',
    banner: (q, n) => `${n.toLocaleString()} semantically related results for "${q}"`,
  },
  agentic: {
    label: '🤖 Agentic',
    color: '#d97706',
    banner: (_q, n) => `AI agent surfaced ${n.toLocaleString()} companies using live data`,
  },
};

export const INTENT_DEFAULT: IntentBannerConfig = INTENT_CFG.semantic;

export function intentConfig(intent: string | undefined): IntentBannerConfig {
  if (!intent) return INTENT_DEFAULT;
  return INTENT_CFG[intent as Intent] ?? INTENT_DEFAULT;
}
