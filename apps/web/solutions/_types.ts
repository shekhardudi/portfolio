import type { ComponentType } from 'react';

/**
 * Plugin contract every solution must satisfy. Drop a folder under
 * `solutions/<slug>/` with a `meta.ts` that default-exports a SolutionMeta
 * and (optionally) a `Demo`, `Architecture`, and `content.mdx` — the registry
 * picks them up automatically.
 */
export interface SolutionMeta {
  slug: string;
  title: string;
  tagline: string;
  category: 'search' | 'agents' | 'content' | 'ml';
  status: 'live' | 'beta' | 'archived';
  featured?: boolean;
  hero?: {
    accent?: string;          // tailwind class, e.g. "from-cyan-500 to-blue-700"
    icon?: string;            // lucide icon name
  };
  stack: readonly string[];
  // Free-form bullets for the homepage card
  highlights: readonly string[];
  // Anchor for tabs the solution provides — order is preserved
  tabs?: readonly ('overview' | 'demo' | 'architecture' | 'api' | 'lessons')[];
  apiBaseEnvVar: string;      // e.g. NEXT_PUBLIC_INTELLI_SEARCH_API
}

export interface SolutionPlugin {
  meta: SolutionMeta;
  Demo?: ComponentType;
  Architecture?: ComponentType;
  // Loaded lazily from content.mdx
  hasContent?: boolean;
}
