/**
 * Module list for Pulse Scout — verbatim from
 * linkedin_post_generator/app.py MODULE_OPTIONS.
 */

export interface ScoutModule {
  /** Friendly label shown in the UI. */
  label: string;
  /** Backend module key. */
  key: string;
}

export const MODULE_OPTIONS: ScoutModule[] = [
  { label: 'Community Sentiment', key: 'community_sentiment' },
  { label: 'Technical Deep Dive', key: 'technical_deep_dive' },
  { label: 'Tooling & Tactics', key: 'tooling_and_tactics' },
  { label: 'Long-form Strategy', key: 'long_form_strategy' },
  { label: 'Expert Synthesis', key: 'expert_synthesis' },
];

export const TIME_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];
