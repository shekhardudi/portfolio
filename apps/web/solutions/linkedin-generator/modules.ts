/**
 * Pulse Scout module list — kept in sync with the backend's MODULE_REGISTRY in
 * services/linkedin-generator/backend/scout/engine.py.
 *
 * Each module is a separate scanner that produces its own scan results before
 * synthesis stitches them into the final briefing.
 */

export interface ScoutModule {
  /** Friendly label shown in the UI (matches MODULE_LABEL on the backend). */
  label: string;
  /** Backend module key (matches MODULE_ID). */
  key: string;
  /** Short, glanceable hint shown under the module pill in the pipeline. */
  hint: string;
}

export const MODULE_OPTIONS: ScoutModule[] = [
  { label: 'Community Sentiment', key: 'community_sentiment', hint: 'practitioner chatter' },
  { label: 'Technical Deep Dive',  key: 'technical_deep_dive',  hint: 'arXiv + research' },
  { label: 'Top Newsletters',      key: 'top_newsletters',      hint: 'curated weekly digests' },
  { label: 'Frontier Labs',        key: 'frontier_labs',        hint: 'lab announcements' },
  { label: 'Expert Synthesis',     key: 'expert_synthesis',     hint: 'individual expert voices' },
];

export const MODULE_LOOKUP: Record<string, ScoutModule> = MODULE_OPTIONS.reduce<Record<string, ScoutModule>>(
  (acc, m) => {
    acc[m.key] = m;
    return acc;
  },
  {},
);

export const TIME_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];
