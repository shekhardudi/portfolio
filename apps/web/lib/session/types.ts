/**
 * Two-level session model for the portfolio:
 *
 *   anonymous site visit (one per browser tab)
 *   └── per-solution session (intelli-search | agentic-hr | linkedin-generator)
 *       └── per-workspace versioning (linkedin only — scout / studio)
 *
 * Site sessions and solution sessions live in **sessionStorage** (per-tab,
 * dies on close). User-authored content (drafts, briefings, images) lives in
 * **localStorage** so it survives tab close — handled separately by each
 * solution's existing reducer (e.g. linkedin's `linkedin-demo-v2`).
 */

export type SolutionSlug =
  | 'intelli-search'
  | 'agentic-hr'
  | 'linkedin-generator';

export type LinkedinWorkspace = 'scout' | 'studio';

/**
 * Status surfaced by the navbar pill and home-card badges.
 *
 * `ready` is the resting state. The other states convey what the demo is
 * actively doing — chosen so the home cards feel alive and contextual
 * (e.g. "Approval pending" beats a generic "Working").
 */
export type SolutionStatus =
  | 'ready'
  | 'searching'           // intelli-search: SSE in flight
  | 'thinking'            // agentic-hr: chat round-trip in flight
  | 'approval_pending'    // agentic-hr: ≥1 pending approval
  | 'scout_running'
  | 'studio_running'
  | 'error';

export interface SiteSession {
  /** uuidv4, minted once per tab. Threaded into outbound API calls for log
   *  correlation. Never sent to identity systems — anonymous by design. */
  anonymousVisitId: string;
  startedAt: number;
}

export interface SolutionSessionState {
  slug: SolutionSlug;
  /** Monotonic counter, bumped on any reset of the solution as a whole. */
  version: number;
  /** Per-workspace version for solutions that need finer-grained resets
   *  (currently linkedin's scout vs studio). Null for solutions that don't. */
  workspaceVersions: { scout: number; studio: number } | null;
  status: SolutionStatus;
  /** Job IDs still in flight; populated by Demo components, drained by the
   *  navbar pill via the JobRegistry. */
  inflightJobIds: string[];
  updatedAt: number;
}

export interface JobHandle {
  /** Stable ID — backend job_id when known, otherwise a UI-side uuid. */
  id: string;
  slug: SolutionSlug;
  workspace?: LinkedinWorkspace | 'chat' | 'search';
  startedAt: number;
  /** Optional client-side cancel (e.g. for SSE AbortController). The
   *  registry's `cancelAll()` calls this when the user clicks "Reset all". */
  cancel?: () => void;
}

/** Event broadcast on every JobRegistry mutation (push to subscribers). */
export interface JobRegistrySnapshot {
  count: number;
  list: JobHandle[];
}
