'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Filter, Sparkles, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { ApiError } from '@/lib/api';
import IntelliSearchBar from './IntelliSearchBar';
import GhostChips from './GhostChips';
import FilterPanel, { EMPTY_FILTERS, filtersToBackend, type FiltersState } from './FilterPanel';
import ThinkingPanel from './ThinkingPanel';
import ResultsList from './ResultsList';
import { extractChips, type IntentChip } from './chips';
import {
  cancelSearch,
  streamSearch,
  type SearchResponse,
  type StreamEvent,
} from './client';
import {
  useSiteSession,
  useSolutionSession,
} from '@/lib/session/SessionProvider';

// Inline example queries shown on the empty Search tab, grouped by search mode.
const CATEGORIZED_QUERIES = [
  {
    label: 'BM25 — Keyword',
    queries: ['Apple', 'IBM Inc', 'Google'],
  },
  {
    label: 'Semantic — Conceptual',
    queries: ['tech companies in california', 'biotech companies in boston'],
  },
  {
    label: 'Agentic — Live Research',
    queries: [
      'find me companies that announced fund raising in last year in australia'],
  },
  {
    label: 'Agentic — Live Research +linkedin',
    queries: ['give me more information about infosys'],
  },
];

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
type Status = 'idle' | 'searching' | 'results' | 'error';

interface State {
  query: string;
  filters: FiltersState;
  status: Status;
  /** Backend-classified intent (semantic | agentic | regular). Drives which
   *  thinking panel renders. Null until the first `classification` SSE event. */
  lastIntent: string | null;
  /** Active phase for the semantic 3-step panel. Only `embedding` and
   *  `vector_search` are recorded here — mirrors the original Vite App. */
  semanticPhase: string | null;
  progressMessage: string | null;
  agenticLogs: string[];
  startTime?: number;
  response: SearchResponse | null;
  error: string | null;
  rawSse: StreamEvent[];
  /** Server-side correlator for the current search. Persisted so a remount
   *  can reattach to the same in-flight session instead of starting over. */
  searchId: string | null;
}

type Action =
  | { type: 'SET_QUERY'; q: string }
  | { type: 'SET_FILTERS'; filters: FiltersState }
  | { type: 'START'; searchId: string }
  | { type: 'RESUME'; searchId: string }
  | { type: 'INTENT'; intent: string; message?: string }
  | { type: 'SEMANTIC_PHASE'; phase: string; message: string }
  | { type: 'PROGRESS_MESSAGE'; message: string }
  | { type: 'AGENTIC_LOG'; line: string }
  | { type: 'SUCCESS'; response: SearchResponse }
  | { type: 'ERROR'; message: string }
  | { type: 'RAW_SSE'; event: StreamEvent }
  | { type: 'CLEAR' };

const INITIAL: State = {
  query: '',
  filters: EMPTY_FILTERS,
  status: 'idle',
  lastIntent: null,
  semanticPhase: null,
  progressMessage: null,
  agenticLogs: [],
  response: null,
  error: null,
  rawSse: [],
  searchId: null,
};

// Persist the demo across route changes so the user can navigate away while a
// search is running and come back to live progress.  The backend now keeps
// the orchestrator task alive when the SSE client disconnects (see
// services/intelli-search/app/api/routes.py); on remount we reattach to the
// same `searchId` and the server replays buffered events.
const STORAGE_KEY = 'intelli-search-demo-v1';
const RESUME_FLAG_KEY = 'intelli-search-resume-v1';
const RUN_TIMEOUT_MS = 5 * 60_000;

function loadInitial(): State {
  if (typeof window === 'undefined') return INITIAL;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL;
    const parsed = JSON.parse(raw) as Partial<State> & { _savedAt?: number };
    const merged: State = {
      ...INITIAL,
      ...parsed,
      filters: parsed.filters ?? EMPTY_FILTERS,
      agenticLogs: Array.isArray(parsed.agenticLogs) ? parsed.agenticLogs : [],
      rawSse: Array.isArray(parsed.rawSse) ? parsed.rawSse : [],
      searchId: parsed.searchId ?? null,
    };
    if (merged.status === 'searching') {
      const stale =
        !parsed._savedAt || Date.now() - parsed._savedAt > RUN_TIMEOUT_MS;
      const canResume = !!merged.searchId && !!merged.query.trim();
      if (stale || !canResume) {
        return {
          ...merged,
          status: 'idle',
          progressMessage: null,
          searchId: null,
        };
      }
      // Flag a one-shot reattach for the mount effect. The backend session
      // is still running (or already finished and buffered); we reconnect
      // to it via POST /intelligent/stream with the same search_id and
      // replay events in order.
      try {
        window.sessionStorage.setItem(RESUME_FLAG_KEY, merged.searchId!);
      } catch {
        /* ignore */
      }
      // Keep status='searching' so the thinking panel stays visible while
      // we reconnect; clear the per-tick log fields — the replay rebuilds
      // them in order so we don't end up with duplicates.
      return {
        ...merged,
        agenticLogs: [],
        rawSse: [],
        progressMessage: null,
        error: null,
      };
    }
    return merged;
  } catch {
    return INITIAL;
  }
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'SET_QUERY':
      return { ...s, query: a.q };
    case 'SET_FILTERS':
      return { ...s, filters: a.filters };
    case 'START':
      return {
        ...s,
        status: 'searching',
        lastIntent: null,
        semanticPhase: null,
        progressMessage: null,
        agenticLogs: [],
        startTime: Date.now(),
        error: null,
        rawSse: [],
        searchId: a.searchId,
      };
    case 'RESUME':
      // Reattach to an in-flight backend search after navigation. Keep the
      // query and filters; clear the per-tick log fields because the server
      // will replay them in order.
      return {
        ...s,
        status: 'searching',
        progressMessage: null,
        agenticLogs: [],
        rawSse: [],
        error: null,
        searchId: a.searchId,
      };
    case 'INTENT':
      return {
        ...s,
        lastIntent: a.intent,
        progressMessage: a.message ?? s.progressMessage,
      };
    case 'SEMANTIC_PHASE':
      return { ...s, semanticPhase: a.phase, progressMessage: a.message };
    case 'PROGRESS_MESSAGE':
      return { ...s, progressMessage: a.message };
    case 'AGENTIC_LOG':
      return {
        ...s,
        agenticLogs: [...s.agenticLogs, a.line],
        progressMessage: a.line,
      };
    case 'SUCCESS':
      return {
        ...s,
        status: 'results',
        response: a.response,
        // Lock in the final classified intent from the response payload too,
        // in case the SSE classification event was missed.
        lastIntent:
          a.response.metadata?.query_classification?.category ?? s.lastIntent ?? 'semantic',
      };
    case 'ERROR':
      return { ...s, status: 'error', error: a.message };
    case 'RAW_SSE':
      return { ...s, rawSse: [...s.rawSse, a.event] };
    case 'CLEAR':
      // "Clear search" — wipes everything except the cached filter facets the
      // user might still want. Filter selections are kept; the query, status,
      // results, and SSE log all reset.
      return {
        ...INITIAL,
        filters: s.filters,
      };
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------
export default function Demo() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);
  const [innerTab, setInnerTab] = useState<'search' | 'raw'>('search');
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile drawer
  // Glow on AI-extracted filters auto-decays 2.5s after a successful search,
  // matching the original Vite App's UX.
  const [glowActive, setGlowActive] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  /** Stable handle for the SSE job in the registry; rotates per search. */
  const jobIdRef = useRef<string | null>(null);

  // Session integration. Intelli-search is stateless server-side, so the
  // only "cancel" we have is the SSE AbortController held in cancelRef.
  // The version guard still useful — protects against late progress events
  // after the user clicks Clear search.
  const session = useSolutionSession('intelli-search');
  const { anonymousVisitId } = useSiteSession();
  const sessionVersion = session.state.version;

  // Drive the per-solution status surface.
  useEffect(() => {
    switch (state.status) {
      case 'searching':
        session.setStatus('searching');
        break;
      case 'error':
        session.setStatus('error');
        break;
      case 'idle':
      case 'results':
      default:
        session.setStatus('ready');
        break;
    }
  }, [state.status, session]);

  // Persist demo state across route navigation so coming back shows the same
  // query, results, and SSE log instead of an empty form.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const blob = JSON.stringify({ ...state, _savedAt: Date.now() });
      window.sessionStorage.setItem(STORAGE_KEY, blob);
    } catch {
      /* quota / disabled — drop persistence */
    }
  }, [state]);

  // One-shot: when we rehydrate a search that was in flight, reattach to the
  // server-side session via its persisted `searchId`. The backend keeps the
  // orchestrator task alive across the client disconnect (see
  // services/intelli-search/app/api/routes.py), so reconnecting just replays
  // the buffered events and tails any new ones — the user picks up exactly
  // where they left off without restarting the search.
  const didResumeRef = useRef(false);
  useEffect(() => {
    if (didResumeRef.current) return;
    if (typeof window === 'undefined') return;
    let resumeId: string | null = null;
    try {
      resumeId = window.sessionStorage.getItem(RESUME_FLAG_KEY);
      if (resumeId) window.sessionStorage.removeItem(RESUME_FLAG_KEY);
    } catch {
      /* ignore */
    }
    didResumeRef.current = true;
    if (resumeId && state.query.trim()) {
      run(undefined, { resumeId });
    }
    // Run only on mount — `run()` reads the latest state via closure on each
    // call, and we explicitly only want to fire this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.status !== 'results') return;
    setGlowActive(true);
    const t = setTimeout(() => setGlowActive(false), 2500);
    return () => clearTimeout(t);
  }, [state.status, state.response]);

  const ghostChips = useMemo<IntentChip[]>(() => extractChips(state.query), [state.query]);

  const aiHighlights = useMemo(() => {
    const inds = ghostChips
      .filter((c) => c.type === 'industry')
      .map((c) => c.label);
    const country = ghostChips.find((c) => c.type === 'location')?.label;
    return { industries: inds, country };
  }, [ghostChips]);
  // Highlights handed to FilterPanel/ResultsList — only "on" while glow is active.
  const liveHighlights = glowActive ? aiHighlights : { industries: [], country: undefined };

  function run(_explicitQuery?: string, opts?: { resumeId?: string }) {
    cancelRef.current?.();
    if (jobIdRef.current) {
      // unregister the prior job before starting a new one
      session.unregisterJob(jobIdRef.current);
      jobIdRef.current = null;
    }
    const q = state.query.trim();
    if (!q) return;
    const mode = 'auto';
    const filters = filtersToBackend(state.filters);
    const versionAtStart = sessionVersion;

    // For a resume we reuse the server-side session's id; for a fresh search
    // we mint a new one. Either way it goes into the body as `search_id`
    // (the DELETE/cancel correlator and the reattach key).
    const handleId = opts?.resumeId ?? `intelli-${Date.now().toString(36)}`;
    jobIdRef.current = handleId;

    if (opts?.resumeId) {
      dispatch({ type: 'RESUME', searchId: handleId });
    } else {
      dispatch({ type: 'START', searchId: handleId });
    }

    const cancel = streamSearch(
      { query: q, mode, size: 20, page: 1, filters, search_id: handleId },
      {
        sessionVersion: versionAtStart,
        anonymousVisitId,
        onEvent: (event) => {
          // Stale-result guard: drop events from a search the user already
          // cleared/replaced. Tested against the live session version so a
          // CLEAR (which bumps the solution version) silently abandons in-
          // flight progress events.
          if (!session.shouldAccept(versionAtStart)) return;
          dispatch({ type: 'RAW_SSE', event });
          if (event.type !== 'progress') return;
          const phase = (event as { phase?: string }).phase ?? '';
          const message = (event as { message?: string }).message ?? '';
          // Mirror the original Vite App's handler exactly:
          //  - `classification` carries JSON {category, confidence} → sets intent
          //  - `embedding` / `vector_search` → advance the semantic 3-step panel
          //  - `tool_start` / `extracting` → append to agentic activity log
          //  - anything else → just update the subtitle message
          if (phase === 'classification' && message) {
            try {
              const info = JSON.parse(message) as { category?: string };
              dispatch({ type: 'INTENT', intent: info.category ?? 'semantic' });
            } catch {
              dispatch({ type: 'INTENT', intent: 'semantic' });
            }
          } else if (phase === 'embedding' || phase === 'vector_search') {
            dispatch({ type: 'SEMANTIC_PHASE', phase, message });
          } else if (phase === 'tool_start' || phase === 'extracting') {
            if (message) dispatch({ type: 'AGENTIC_LOG', line: message });
          } else if (message) {
            dispatch({ type: 'PROGRESS_MESSAGE', message });
          }
        },
        // The streaming endpoint already emits a fully-formed SearchResponse
        // under the `results` event — no second POST required.
        onResults: (res) => {
          if (!session.shouldAccept(versionAtStart)) return;
          dispatch({ type: 'SUCCESS', response: res });
          if (jobIdRef.current) {
            session.unregisterJob(jobIdRef.current);
            jobIdRef.current = null;
          }
        },
        onError: (e) => {
          handleError(e);
          if (jobIdRef.current) {
            session.unregisterJob(jobIdRef.current);
            jobIdRef.current = null;
          }
        },
      },
    );
    cancelRef.current = cancel;
    session.registerJob({
      id: handleId,
      slug: 'intelli-search',
      workspace: 'search',
      startedAt: Date.now(),
      cancel: () => {
        cancel();
        // Best-effort backend cancel — frees the orchestrator task slot.
        void cancelSearch(handleId).catch(() => {});
      },
    });
  }

  /** "Clear search" — wipes query/results, aborts any in-flight SSE, and
   *  bumps the session version so late events from the previous search are
   *  ignored. Filters are preserved. */
  function clearSearch() {
    cancelRef.current?.();
    cancelRef.current = null;
    if (jobIdRef.current) {
      // Best-effort — free the backend orchestrator slot in real time.
      void cancelSearch(jobIdRef.current).catch(() => {});
      session.unregisterJob(jobIdRef.current);
      jobIdRef.current = null;
    }
    session.resetSolution();
    dispatch({ type: 'CLEAR' });
  }

  function handleError(e: unknown) {
    const msg =
      e instanceof ApiError
        ? `${e.status} — ${e.body || e.message}`
        : (e as Error).message;
    dispatch({ type: 'ERROR', message: msg });
  }

  return (
    <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as typeof innerTab)}>
      {/* Match the parent container-tight (max-w-5xl) so the demo aligns
          with the page header (title, stack chips) and outer Overview/Demo/
          Architecture/API tab strip. No horizontal breakout. */}
      <div>
      <TabsList className="flex-wrap">
        <TabsTrigger value="search">Search</TabsTrigger>
        <TabsTrigger value="raw">API response</TabsTrigger>
        <div className="ml-auto self-center">
          <button
            type="button"
            onClick={clearSearch}
            disabled={
              !state.query &&
              state.status === 'idle' &&
              state.response == null &&
              state.error == null
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground/85 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            title="Cancel any in-flight search and clear the query, results, and API trace. Filters are kept."
          >
            <X className="h-3 w-3" /> Clear search
          </button>
        </div>
      </TabsList>

      {/* ───── Search ───── */}
      <TabsContent value="search">
        <div className="space-y-3">
          <IntelliSearchBar
            query={state.query}
            onQueryChange={(q) => dispatch({ type: 'SET_QUERY', q })}
            onSubmit={() => run()}
            busy={state.status === 'searching'}
          />
          <GhostChips chips={ghostChips} />

          {/* Mobile filters trigger */}
          <div className="md:hidden">
            <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
              <DrawerTrigger asChild>
                <button className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1 text-sm font-medium text-foreground/90">
                  <Filter className="h-3.5 w-3.5" /> Filters
                </button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Filters</DrawerTitle>
                </DrawerHeader>
                <FilterPanel
                  filters={state.filters}
                  onChange={(f) => dispatch({ type: 'SET_FILTERS', filters: f })}
                  aiHighlights={liveHighlights}
                />
              </DrawerContent>
            </Drawer>
          </div>

          <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
            {/* Desktop filters */}
            <FilterPanel
              className="hidden md:block"
              filters={state.filters}
              onChange={(f) => dispatch({ type: 'SET_FILTERS', filters: f })}
              aiHighlights={liveHighlights}
            />

            <div className="min-w-0 space-y-3">
              {state.status === 'searching' && (
                <ThinkingPanel
                  intent={state.lastIntent}
                  semanticPhase={state.semanticPhase}
                  message={state.progressMessage}
                  agenticLogs={state.agenticLogs}
                  startTime={state.startTime}
                />
              )}

              {state.status === 'error' && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                  {state.error}
                </div>
              )}

              {state.status === 'results' && state.response && (
                <ResultsList
                  response={state.response}
                  searchQuery={state.query}
                  aiFiltersActive={
                    (aiHighlights.industries?.filter((i) => state.filters.industries.includes(i)).length ?? 0) +
                    (aiHighlights.country && state.filters.country === aiHighlights.country ? 1 : 0)
                  }
                  onClearAiFilters={() => {
                    const next = { ...state.filters };
                    if (aiHighlights.industries) {
                      next.industries = state.filters.industries.filter(
                        (i) => !aiHighlights.industries!.includes(i),
                      );
                    }
                    if (aiHighlights.country && next.country === aiHighlights.country) {
                      next.country = '';
                    }
                    dispatch({ type: 'SET_FILTERS', filters: next });
                  }}
                />
              )}

              {state.status === 'idle' && (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm">
                  <div className="flex items-center gap-2 text-foreground/85">
                    <Sparkles className="h-4 w-4 text-blue-400" />
                    <span className="font-medium">
                      Search using natural language — try one of these:
                    </span>
                  </div>
                  <div className="mt-4 space-y-2">
                    {CATEGORIZED_QUERIES.map(({ label, queries }) => (
                      <div key={label} className="grid grid-cols-1 items-start gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr]">
                        <span className="pt-1 text-xs font-medium text-foreground/50 sm:text-right">
                          {label}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {queries.map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => {
                                // Populate the search bar only — the user
                                // explicitly clicks Search to fire. This
                                // lets them flip between suggestions
                                // without accidentally launching a search
                                // for the first one they tapped.
                                dispatch({ type: 'SET_QUERY', q });
                              }}
                              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground/85 transition hover:border-foreground/40 hover:bg-muted/60"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </TabsContent>

      {/* ───── API response ───── */}
      <TabsContent value="raw">
        <div className="demo-prose space-y-3">
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div className="text-sm font-semibold text-foreground/95">
              POST /api/search/intelligent/stream
            </div>
            <div className="mt-1 text-sm text-foreground/85">Request body</div>
            <pre className="mt-1 overflow-auto rounded bg-background p-3 text-sm leading-relaxed text-foreground/95">
{JSON.stringify(
  {
    query: state.query,
    mode: 'auto',
    limit: 20,
    page: 1,
    include_reasoning: true,
    filters: filtersToBackend(state.filters),
  },
  null,
  2,
)}
            </pre>
          </div>

          {state.rawSse.length > 0 && (
            <details className="rounded-xl border border-border bg-muted/40 p-3" open>
              <summary className="cursor-pointer text-sm font-semibold text-foreground/95">
                SSE events ({state.rawSse.length})
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-background p-3 text-sm leading-relaxed text-foreground/95">
                {state.rawSse.map((e, i) => `${i}: ${JSON.stringify(e)}\n`).join('')}
              </pre>
            </details>
          )}

          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground/95">
                Response body
              </div>
              {state.response?.duration_ms != null && (
                <span className="rounded-md border border-border px-2 py-0.5 text-sm text-foreground/85">
                  {state.response.duration_ms}ms · {state.response.hits.length} hits
                </span>
              )}
            </div>
            <pre className="mt-2 max-h-[520px] overflow-auto rounded bg-background p-3 text-sm leading-relaxed text-foreground/95">
              {state.response?.raw
                ? JSON.stringify(state.response.raw, null, 2)
                : state.response
                  ? JSON.stringify(state.response, null, 2)
                  : 'Run a search first.'}
            </pre>
          </div>
        </div>
      </TabsContent>
      </div>
    </Tabs>
  );
}
