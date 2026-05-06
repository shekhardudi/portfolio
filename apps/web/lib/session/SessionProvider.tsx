'use client';

import * as React from 'react';
import {
  readSessionJson,
  removeSession,
  SITE_SESSION_STORAGE_KEY,
  solutionSessionKey,
  writeSessionJson,
} from './storage';
import { jobRegistry } from './jobRegistry';
import type {
  JobHandle,
  JobRegistrySnapshot,
  LinkedinWorkspace,
  SiteSession,
  SolutionSessionState,
  SolutionSlug,
  SolutionStatus,
} from './types';

// ─── Site-session bootstrap ────────────────────────────────────────────────

// Stamp put on `window.name` to identify a tab as already-initialised. Most
// browsers (Chrome, Firefox, Safari) do **not** copy `window.name` when a
// tab is duplicated, so a session-storage entry combined with an empty
// `window.name` is a strong signal that this is a duplicated tab. We use
// that to re-mint the per-tab session and clear inherited demo state so
// the duplicated tab doesn't reattach to the original tab's running jobs.
const TAB_MARKER_PREFIX = 'pf-tab-';

// sessionStorage keys per-demo that hold runtime / in-flight state. Cleared
// on detected tab duplication so the duplicated tab doesn't pick up the
// original tab's polling loops, SSE reattach ids, or chat session ids.
const DEMO_RUNTIME_KEYS: ReadonlyArray<string> = [
  'intelli-search-demo-v1',
  'intelli-search-resume-v1',
  'agentic-hr-demo-v1',
  'linkedin-runtime-v1',
];

function newVisitId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stampTabMarker(visitId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.name = `${TAB_MARKER_PREFIX}${visitId}`;
  } catch {
    /* extension nuked it; harmless — we'll re-mint next mount */
  }
}

function hasTabMarker(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return typeof window.name === 'string' && window.name.startsWith(TAB_MARKER_PREFIX);
  } catch {
    return false;
  }
}

function clearInheritedDemoState(): void {
  if (typeof window === 'undefined') return;
  // Drop the per-solution session shells the SessionProvider itself owns.
  for (const slug of SOLUTION_SLUGS) {
    try {
      window.sessionStorage.removeItem(solutionSessionKey(slug));
    } catch {
      /* ignore */
    }
  }
  // Drop the per-demo runtime/state blobs that hold backend correlators
  // (search_id, chat session_id, scout/studio job_id) so we don't reattach
  // to the original tab's in-flight backend sessions.
  for (const key of DEMO_RUNTIME_KEYS) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function ensureSiteSession(): SiteSession {
  const existing = readSessionJson<SiteSession>(SITE_SESSION_STORAGE_KEY);
  const tabAlreadyInitialised = hasTabMarker();

  if (
    existing &&
    typeof existing.anonymousVisitId === 'string' &&
    existing.anonymousVisitId
  ) {
    if (tabAlreadyInitialised) {
      // Same tab being re-mounted (or hard-refreshed) — keep the session.
      return existing;
    }
    // sessionStorage carried over but no tab marker → treat as duplication.
    // Re-mint the visit id, scrub inherited demo state, and stamp a fresh
    // marker so subsequent mounts in this tab are recognised.
    clearInheritedDemoState();
    const fresh: SiteSession = {
      anonymousVisitId: newVisitId(),
      startedAt: Date.now(),
    };
    writeSessionJson(SITE_SESSION_STORAGE_KEY, fresh);
    stampTabMarker(fresh.anonymousVisitId);
    return fresh;
  }

  const fresh: SiteSession = {
    anonymousVisitId: newVisitId(),
    startedAt: Date.now(),
  };
  writeSessionJson(SITE_SESSION_STORAGE_KEY, fresh);
  stampTabMarker(fresh.anonymousVisitId);
  return fresh;
}

// ─── Per-solution defaults ─────────────────────────────────────────────────

const SOLUTION_SLUGS: SolutionSlug[] = [
  'intelli-search',
  'agentic-hr',
  'linkedin-generator',
];

function defaultSolutionState(slug: SolutionSlug): SolutionSessionState {
  return {
    slug,
    version: 1,
    workspaceVersions:
      slug === 'linkedin-generator' ? { scout: 1, studio: 1 } : null,
    status: 'ready',
    inflightJobIds: [],
    updatedAt: 0, // 0 marks "never persisted" — flips on first real update
  };
}

function loadSolutionState(slug: SolutionSlug): SolutionSessionState {
  const existing = readSessionJson<SolutionSessionState>(
    solutionSessionKey(slug),
  );
  if (
    existing &&
    typeof existing.version === 'number' &&
    typeof existing.status === 'string'
  ) {
    // Drop any stale inflight IDs — sessionStorage carries them across page
    // refreshes within the same tab, but a fresh mount has no polling loop
    // running, so anything listed there is by definition orphaned.
    return { ...existing, inflightJobIds: [] };
  }
  return defaultSolutionState(slug);
}

type SolutionMap = Record<SolutionSlug, SolutionSessionState>;

const SSR_SITE_SESSION: SiteSession = {
  anonymousVisitId: '',
  startedAt: 0,
};

const SSR_SOLUTIONS: SolutionMap = {
  'intelli-search': defaultSolutionState('intelli-search'),
  'agentic-hr': defaultSolutionState('agentic-hr'),
  'linkedin-generator': defaultSolutionState('linkedin-generator'),
};

// ─── Mutators (pure helpers used by setState updaters) ─────────────────────

function withStatus(
  state: SolutionSessionState,
  status: SolutionStatus,
): SolutionSessionState {
  if (state.status === status) return state;
  return { ...state, status, updatedAt: Date.now() };
}

function withSolutionReset(state: SolutionSessionState): SolutionSessionState {
  const nextWorkspace =
    state.workspaceVersions != null
      ? {
          scout: state.workspaceVersions.scout + 1,
          studio: state.workspaceVersions.studio + 1,
        }
      : null;
  return {
    ...state,
    version: state.version + 1,
    workspaceVersions: nextWorkspace,
    status: 'ready',
    inflightJobIds: [],
    updatedAt: Date.now(),
  };
}

function withWorkspaceReset(
  state: SolutionSessionState,
  workspace: LinkedinWorkspace,
): SolutionSessionState {
  if (state.workspaceVersions == null) return state;
  const nextWv = {
    ...state.workspaceVersions,
    [workspace]: state.workspaceVersions[workspace] + 1,
  };
  // If the relevant running flag matches the workspace being reset, drop to
  // ready. Other statuses (e.g. studio_running while resetting scout) survive.
  const nextStatus: SolutionStatus =
    (workspace === 'scout' && state.status === 'scout_running') ||
    (workspace === 'studio' && state.status === 'studio_running')
      ? 'ready'
      : state.status;
  return {
    ...state,
    version: state.version + 1,
    workspaceVersions: nextWv,
    status: nextStatus,
    inflightJobIds: [],
    updatedAt: Date.now(),
  };
}

function withInflightAdded(
  state: SolutionSessionState,
  jobId: string,
): SolutionSessionState {
  if (state.inflightJobIds.includes(jobId)) return state;
  return {
    ...state,
    inflightJobIds: [...state.inflightJobIds, jobId],
    updatedAt: Date.now(),
  };
}

function withInflightRemoved(
  state: SolutionSessionState,
  jobId: string,
): SolutionSessionState {
  if (!state.inflightJobIds.includes(jobId)) return state;
  return {
    ...state,
    inflightJobIds: state.inflightJobIds.filter((id) => id !== jobId),
    updatedAt: Date.now(),
  };
}

// ─── Context shape ─────────────────────────────────────────────────────────

interface SessionContextValue {
  site: SiteSession;
  solutions: SolutionMap;
  resetAll: () => void;
  clearAllDrafts: () => void;
  setSolutionStatus: (slug: SolutionSlug, status: SolutionStatus) => void;
  resetSolution: (slug: SolutionSlug) => void;
  resetSolutionWorkspace: (
    slug: SolutionSlug,
    workspace: LinkedinWorkspace,
  ) => void;
  addInflightJob: (slug: SolutionSlug, jobId: string) => void;
  removeInflightJob: (slug: SolutionSlug, jobId: string) => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [site, setSite] = React.useState<SiteSession>(SSR_SITE_SESSION);
  const [solutions, setSolutions] = React.useState<SolutionMap>(SSR_SOLUTIONS);
  const [hydrated, setHydrated] = React.useState(false);

  // Mint / restore the site + solution sessions client-side. Done in an
  // effect (not during render) to avoid SSR/CSR hydration mismatches —
  // the server has no sessionStorage, so SSR renders the empty defaults
  // and we upgrade after the first client paint.
  React.useEffect(() => {
    setSite(ensureSiteSession());
    setSolutions({
      'intelli-search': loadSolutionState('intelli-search'),
      'agentic-hr': loadSolutionState('agentic-hr'),
      'linkedin-generator': loadSolutionState('linkedin-generator'),
    });
    setHydrated(true);
  }, []);

  // Persist site session changes (only when populated — SSR placeholder
  // would otherwise overwrite the real one in a race).
  React.useEffect(() => {
    if (!hydrated || !site.anonymousVisitId) return;
    writeSessionJson(SITE_SESSION_STORAGE_KEY, site);
  }, [hydrated, site]);

  // Persist solution updates whenever any slot changes.
  React.useEffect(() => {
    if (!hydrated) return;
    for (const slug of SOLUTION_SLUGS) {
      writeSessionJson(solutionSessionKey(slug), solutions[slug]);
    }
  }, [hydrated, solutions]);

  // ─── Mutator helpers ─────────────────────────────────────────────────
  // Track pending error→ready auto-clears so we don't stack timers when
  // a demo dispatches `error` repeatedly.
  const errorClearTimers = React.useRef<Partial<Record<SolutionSlug, ReturnType<typeof setTimeout>>>>({});

  const setSolutionStatus = React.useCallback(
    (slug: SolutionSlug, status: SolutionStatus) => {
      setSolutions((prev) => {
        const next = withStatus(prev[slug], status);
        if (next === prev[slug]) return prev;
        return { ...prev, [slug]: next };
      });

      // Errors are transient on the session-level surface. Demos render
      // their own error UI inline; the per-solution status — which feeds
      // the home-card pill and the floating session widget — should auto
      // -revert to `ready` so a failed run doesn't leave a stale "Error"
      // badge stuck on the home page until the user navigates away.
      if (typeof window === 'undefined') return;
      const pending = errorClearTimers.current[slug];
      if (pending) {
        clearTimeout(pending);
        delete errorClearTimers.current[slug];
      }
      if (status === 'error') {
        errorClearTimers.current[slug] = setTimeout(() => {
          delete errorClearTimers.current[slug];
          setSolutions((prev) => {
            // Only clear if still in error — don't clobber a newer status
            // (e.g. the user kicked off another run in the meantime).
            if (prev[slug].status !== 'error') return prev;
            const next = withStatus(prev[slug], 'ready');
            if (next === prev[slug]) return prev;
            return { ...prev, [slug]: next };
          });
        }, 1500);
      }
    },
    [],
  );

  const resetSolution = React.useCallback((slug: SolutionSlug) => {
    jobRegistry.cancelForSlug(slug);
    setSolutions((prev) => ({
      ...prev,
      [slug]: withSolutionReset(prev[slug]),
    }));
  }, []);

  const resetSolutionWorkspace = React.useCallback(
    (slug: SolutionSlug, workspace: LinkedinWorkspace) => {
      jobRegistry.cancelForSlug(slug);
      setSolutions((prev) => ({
        ...prev,
        [slug]: withWorkspaceReset(prev[slug], workspace),
      }));
    },
    [],
  );

  const addInflightJob = React.useCallback(
    (slug: SolutionSlug, jobId: string) => {
      setSolutions((prev) => {
        const next = withInflightAdded(prev[slug], jobId);
        if (next === prev[slug]) return prev;
        return { ...prev, [slug]: next };
      });
    },
    [],
  );

  const removeInflightJob = React.useCallback(
    (slug: SolutionSlug, jobId: string) => {
      setSolutions((prev) => {
        const next = withInflightRemoved(prev[slug], jobId);
        if (next === prev[slug]) return prev;
        return { ...prev, [slug]: next };
      });
    },
    [],
  );

  const resetAll = React.useCallback(() => {
    jobRegistry.cancelAll();
    setSolutions((prev) => {
      const next: SolutionMap = { ...prev };
      for (const slug of SOLUTION_SLUGS) {
        next[slug] = withSolutionReset(prev[slug]);
      }
      return next;
    });
  }, []);

  const clearAllDrafts = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      // Today only linkedin-generator persists drafts to localStorage. New
      // solutions register their keys here as needed.
      window.localStorage.removeItem('linkedin-demo-v2');
    } catch {
      /* ignore */
    }
    for (const slug of SOLUTION_SLUGS) {
      removeSession(solutionSessionKey(slug));
    }
    // Per-demo runtime blobs hold the actual rendered output (last response,
    // generated post, chat transcript, scout candidates, etc.) plus the
    // backend correlator ids. Without dropping these the page reloads and
    // each demo immediately rehydrates its previous results — defeating
    // "reset to initial state". Wipe the same set the tab-duplication
    // guard wipes so a manual reset is at least as thorough.
    for (const key of DEMO_RUNTIME_KEYS) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    removeSession(SITE_SESSION_STORAGE_KEY);
    window.location.reload();
  }, []);

  const value = React.useMemo<SessionContextValue>(
    () => ({
      site,
      solutions,
      resetAll,
      clearAllDrafts,
      setSolutionStatus,
      resetSolution,
      resetSolutionWorkspace,
      addInflightJob,
      removeInflightJob,
    }),
    [
      site,
      solutions,
      resetAll,
      clearAllDrafts,
      setSolutionStatus,
      resetSolution,
      resetSolutionWorkspace,
      addInflightJob,
      removeInflightJob,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

function useCtx(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) {
    throw new Error('Session hooks must be used inside <SessionProvider>');
  }
  return ctx;
}

export function useSiteSession() {
  const ctx = useCtx();
  return {
    anonymousVisitId: ctx.site.anonymousVisitId,
    startedAt: ctx.site.startedAt,
    resetAll: ctx.resetAll,
    clearAllDrafts: ctx.clearAllDrafts,
  };
}

export interface UseSolutionSession {
  state: SolutionSessionState;
  setStatus: (status: SolutionStatus) => void;
  /** Bump the solution's main version (and per-workspace if present). */
  resetSolution: () => void;
  /** Linkedin-only: bump just one workspace's version. No-op for solutions
   *  without `workspaceVersions`. */
  resetWorkspace: (workspace: LinkedinWorkspace) => void;
  registerJob: (handle: JobHandle) => void;
  unregisterJob: (jobId: string) => void;
  /**
   * Stale-result guard. Pass the version snapshotted when the call was made.
   * Returns false if the user reset the solution (or workspace) in the
   * meantime — caller should drop the result silently.
   */
  shouldAccept: (
    versionAtCallTime: number,
    workspace?: LinkedinWorkspace,
  ) => boolean;
}

export function useSolutionSession(slug: SolutionSlug): UseSolutionSession {
  const ctx = useCtx();
  const state = ctx.solutions[slug];

  const setStatus = React.useCallback(
    (status: SolutionStatus) => ctx.setSolutionStatus(slug, status),
    [ctx, slug],
  );

  const resetSolution = React.useCallback(
    () => ctx.resetSolution(slug),
    [ctx, slug],
  );

  const resetWorkspace = React.useCallback(
    (workspace: LinkedinWorkspace) =>
      ctx.resetSolutionWorkspace(slug, workspace),
    [ctx, slug],
  );

  const registerJob = React.useCallback(
    (handle: JobHandle) => {
      jobRegistry.register({ ...handle, slug });
      ctx.addInflightJob(slug, handle.id);
    },
    [ctx, slug],
  );

  const unregisterJob = React.useCallback(
    (jobId: string) => {
      jobRegistry.unregister(jobId);
      ctx.removeInflightJob(slug, jobId);
    },
    [ctx, slug],
  );

  const shouldAccept = React.useCallback(
    (versionAtCallTime: number, workspace?: LinkedinWorkspace) => {
      if (workspace && state.workspaceVersions) {
        return versionAtCallTime === state.workspaceVersions[workspace];
      }
      return versionAtCallTime === state.version;
    },
    [state.version, state.workspaceVersions],
  );

  return {
    state,
    setStatus,
    resetSolution,
    resetWorkspace,
    registerJob,
    unregisterJob,
    shouldAccept,
  };
}

// ─── Job registry hook ─────────────────────────────────────────────────────

export function useJobRegistry(): {
  count: number;
  list: JobHandle[];
  cancelAll: () => void;
} {
  const snapshot = React.useSyncExternalStore<JobRegistrySnapshot>(
    jobRegistry.subscribe,
    jobRegistry.getSnapshot,
    jobRegistry.getServerSnapshot,
  );
  return {
    count: snapshot.count,
    list: snapshot.list,
    cancelAll: jobRegistry.cancelAll.bind(jobRegistry),
  };
}
