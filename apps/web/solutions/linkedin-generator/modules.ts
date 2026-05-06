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
  { label: 'Tooling & Tactics',    key: 'tooling_and_tactics',  hint: 'releases + patterns' },
  { label: 'Long-form Strategy',   key: 'long_form_strategy',   hint: 'deep takes + essays' },
  { label: 'Frontier Labs',        key: 'frontier_labs',        hint: 'lab announcements' },
  { label: 'Expert Synthesis',     key: 'expert_synthesis',     hint: 'cross-source themes' },
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
