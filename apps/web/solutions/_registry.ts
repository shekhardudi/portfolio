import type { SolutionPlugin } from './_types';

import intelliSearch from './intelli-search';
import agenticHr from './agentic-hr';
import linkedinGenerator from './linkedin-generator';

/**
 * Order = display order on the homepage. Add new plugins by importing them
 * here. Each plugin lives under `solutions/<slug>/index.ts` and re-exports a
 * SolutionPlugin object.
 */
export const SOLUTIONS: readonly SolutionPlugin[] = [
  intelliSearch,
  agenticHr,
  linkedinGenerator,
] as const;

export const SOLUTIONS_BY_SLUG = Object.fromEntries(
  SOLUTIONS.map((s) => [s.meta.slug, s]),
) as Record<string, SolutionPlugin>;

export function getSolution(slug: string): SolutionPlugin | undefined {
  return SOLUTIONS_BY_SLUG[slug];
}

export function listFeatured(): SolutionPlugin[] {
  return SOLUTIONS.filter((s) => s.meta.featured);
}
