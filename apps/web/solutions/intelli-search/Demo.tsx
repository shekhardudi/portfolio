'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Filter, Sparkles } from 'lucide-react';
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
  streamSearch,
  type SearchResponse,
  type StreamEvent,
} from './client';

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
}

type Action =
  | { type: 'SET_QUERY'; q: string }
  | { type: 'SET_FILTERS'; filters: FiltersState }
  | { type: 'START' }
  | { type: 'INTENT'; intent: string; message?: string }
  | { type: 'SEMANTIC_PHASE'; phase: string; message: string }
  | { type: 'PROGRESS_MESSAGE'; message: string }
  | { type: 'AGENTIC_LOG'; line: string }
  | { type: 'SUCCESS'; response: SearchResponse }
  | { type: 'ERROR'; message: string }
  | { type: 'RAW_SSE'; event: StreamEvent };

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
};

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
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------
export default function Demo() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [innerTab, setInnerTab] = useState<'search' | 'raw'>('search');
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile drawer
  // Glow on AI-extracted filters auto-decays 2.5s after a successful search,
  // matching the original Vite App's UX.
  const [glowActive, setGlowActive] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

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

  function run(explicitQuery?: string) {
    cancelRef.current?.();
    const q = state.query.trim();
    if (!q) return;
    const mode = 'auto';
    dispatch({ type: 'START' });
    const filters = filtersToBackend(state.filters);

    const cancel = streamSearch(
      { query: q, mode, size: 20, page: 1, filters },
      {
        onEvent: (event) => {
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
        onResults: (res) => dispatch({ type: 'SUCCESS', response: res }),
        onError: (e) => handleError(e),
      },
    );
    cancelRef.current = cancel;
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
      <TabsList>
        <TabsTrigger value="search">Search</TabsTrigger>
        <TabsTrigger value="raw">API response</TabsTrigger>
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
                      <div key={label} className="grid grid-cols-[10rem_1fr] items-start gap-x-3 gap-y-1">
                        <span className="pt-1 text-xs font-medium text-foreground/50 text-right">
                          {label}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {queries.map((q) => (
                            <button
                              key={q}
                              type="button"
                              onClick={() => {
                                dispatch({ type: 'SET_QUERY', q });
                                requestAnimationFrame(() => run());
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
