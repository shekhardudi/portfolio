import {
  SOLUTIONS,
  SOLUTIONS_BY_SLUG,
  getSolution,
  listFeatured,
} from '@/solutions/_registry';
import type { SolutionMeta, SolutionPlugin } from '@/solutions/_types';

export type { SolutionMeta, SolutionPlugin };
export { SOLUTIONS, SOLUTIONS_BY_SLUG, getSolution, listFeatured };

export function getAllSlugs(): string[] {
  return SOLUTIONS.map((s) => s.meta.slug);
}

export function getApiBase(meta: SolutionMeta): string {
  // Read NEXT_PUBLIC_* vars at build time on the server.
  const fromEnv = process.env[meta.apiBaseEnvVar];
  return fromEnv || `/${meta.slug}`; // graceful fallback for previews
}
