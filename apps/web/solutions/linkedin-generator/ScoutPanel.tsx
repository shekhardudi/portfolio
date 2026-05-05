'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Play, Send, Telescope } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MODULE_OPTIONS, TIME_UNITS, type TimeUnit } from './modules';
import { convertToDays, parseH2Sections } from './helpers';
import {
  EndpointMissingError,
  LINKEDIN_API_BASE,
  getScout,
  startScout,
} from './client';
import CostTracker from './CostTracker';
import type { DemoAction, DemoState } from './useDemoState';

interface Props {
  state: DemoState;
  dispatch: React.Dispatch<DemoAction>;
  onImport: (heading: string, body: string) => void;
}

const STEP_LABELS: Record<string, string> = {
  community_sentiment: 'Scanning community sentiment…',
  technical_deep_dive: 'Reading technical deep dives…',
  tooling_and_tactics: 'Surveying tooling & tactics…',
  long_form_strategy: 'Mining long-form strategy…',
  expert_synthesis: 'Synthesising expert takes…',
};

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 15 * 60_000; // long scout runs (5 modules × deep search) regularly hit ~5–7 min
const POLL_MAX_CONSECUTIVE_ERRORS = 20;

export default function ScoutPanel({ state, dispatch, onImport }: Props) {
  const [unavailable, setUnavailable] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const busy = state.scout_status === 'queued' || state.scout_status === 'running';

  function toggleModule(key: string) {
    if (busy) return;
    const next = state.selected_modules.includes(key)
      ? state.selected_modules.filter((m) => m !== key)
      : [...state.selected_modules, key];
    dispatch({ type: 'PATCH', payload: { selected_modules: next } });
  }

  async function run() {
    if (busy || state.selected_modules.length === 0) return;
    setUnavailable(false);
    try {
      const days = convertToDays(state.pulse_value, state.pulse_unit);
      const ack = await startScout({ modules: state.selected_modules, days });
      dispatch({ type: 'SCOUT_START', job_id: ack.job_id });
      void poll(ack.job_id);
    } catch (e) {
      if (e instanceof EndpointMissingError) setUnavailable(true);
      else
        dispatch({
          type: 'SCOUT_FAIL',
          error: e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message,
        });
    }
  }

  async function poll(jobId: string) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let consecutiveErrors = 0;
    while (!cancelledRef.current && Date.now() < deadline) {
      try {
        const job = await getScout(jobId);
        consecutiveErrors = 0;
        const step = Number(job.progress?.step ?? 0);
        const total = Number(job.progress?.total ?? state.selected_modules.length);
        dispatch({
          type: 'SCOUT_TICK',
          status: job.status,
          step,
          total,
          module: job.progress?.module,
          message: job.progress?.message,
          callbacks: job.progress?.callbacks,
        });

        if (job.status === 'completed') {
          dispatch({
            type: 'SCOUT_DONE',
            report_md: job.result?.report_md ?? '',
            cost: job.result?.cost_breakdown ?? null,
          });
          return;
        }
        if (job.status === 'cancelled') {
          dispatch({ type: 'SCOUT_FAIL', error: job.error ?? 'scout cancelled' });
          return;
        }
        if (job.status === 'failed') {
          dispatch({ type: 'SCOUT_FAIL', error: job.error ?? 'scout failed' });
          return;
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          dispatch({ type: 'SCOUT_FAIL', error: 'scout job lost server-side' });
          return;
        }
        // Treat timeouts / 5xx / aborts as transient.
        consecutiveErrors += 1;
        if (consecutiveErrors >= POLL_MAX_CONSECUTIVE_ERRORS) {
          dispatch({
            type: 'SCOUT_FAIL',
            error: 'Lost connection to backend — please retry.',
          });
          return;
        }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!cancelledRef.current) {
      dispatch({ type: 'SCOUT_FAIL', error: 'Scout exceeded the 15 minute polling window.' });
    }
  }

  const sections = state.pulse_md ? parseH2Sections(state.pulse_md) : {};
  const headings = Object.keys(sections);
  const fraction = state.scout_progress_total
    ? Math.min(1, state.scout_progress_step / state.scout_progress_total)
    : 0;
  const activeModule = state.scout_progress_module || state.selected_modules[Math.min(state.scout_progress_step, state.selected_modules.length - 1)] || '';
  const fallbackLabel = STEP_LABELS[activeModule] ?? 'Synthesising…';
  const liveLabel = state.scout_progress_message || fallbackLabel;
  const sectionEntries = Object.entries(sections);
  const selectedHeading = sectionEntries.some(([h]) => h === activeSection)
    ? activeSection
    : (headings[0] ?? '');
  const selectedBody = selectedHeading ? sections[selectedHeading] ?? '' : '';

  function importSelectedSection() {
    if (!selectedBody) return;
    onImport(selectedHeading || '__intro__', selectedBody);
  }

  useEffect(() => {
    if (headings.length === 0) {
      setActiveSection('');
      return;
    }
    setActiveSection((prev) => (prev && sections[prev] ? prev : headings[0] ?? ''));
  }, [state.pulse_md, headings.length]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/25 p-4">
        <div className="flex items-center gap-2">
          <Telescope className="h-4 w-4 text-foreground" />
          <h4 className="text-sm font-semibold text-foreground">Pulse Scout</h4>
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/80">
            AI Sector Researcher
          </span>
        </div>
        <p className="mt-1 text-sm leading-snug text-foreground/85">
          Think like an AI sector researcher: map market signals, isolate the strongest insight,
          then import that angle into Studio for post generation.
        </p>

        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/75">
              Modules
            </div>
            <div className="flex flex-wrap gap-1.5">
              {MODULE_OPTIONS.map((m) => {
                const active = state.selected_modules.includes(m.key);
                return (
                  <button
                    key={m.key}
                    onClick={() => toggleModule(m.key)}
                    disabled={busy}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[12px] font-medium transition disabled:opacity-60',
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border text-foreground/90 hover:border-foreground/45 hover:text-foreground',
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[12px] font-medium text-foreground/85">Time window</span>
            <input
              type="number"
              min={1}
              max={730}
              value={state.pulse_value}
              disabled={busy}
              onChange={(e) =>
                dispatch({ type: 'PATCH', payload: { pulse_value: Number(e.target.value) || 1 } })
              }
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <Select
              value={state.pulse_unit}
              disabled={busy}
              onValueChange={(v) =>
                dispatch({ type: 'PATCH', payload: { pulse_unit: v as TimeUnit } })
              }
            >
              <SelectTrigger className="h-8 w-28 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-foreground/70">
              ≈ {convertToDays(state.pulse_value, state.pulse_unit)} day{convertToDays(state.pulse_value, state.pulse_unit) === 1 ? '' : 's'}
            </span>
            <button
              onClick={run}
              disabled={busy || state.selected_modules.length === 0}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {busy ? 'Scouting…' : 'Run Scout'}
            </button>
          </div>

          {busy && (
            <div className="space-y-2 rounded-md border border-border bg-background px-3 py-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {liveLabel}
                </span>
                <span className="font-mono text-[11px] text-foreground/75">
                  {state.scout_progress_step}/{state.scout_progress_total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
                  style={{ width: `${fraction * 100}%` }}
                />
              </div>
            </div>
          )}

          {state.scout_error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {state.scout_error}
            </div>
          )}

          {unavailable && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              Scout endpoint isn&apos;t reachable yet —{' '}
              <a
                className="inline-flex items-center gap-1 underline"
                href={LINKEDIN_API_BASE}
                target="_blank"
                rel="noopener noreferrer"
              >
                run on the live app <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </div>

      <CostTracker cost={state.scout_cost} kind="scout" />

      {state.pulse_done && state.pulse_md && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/85">
              <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono">
                {sectionEntries.length} sections
              </span>
              <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono">
                {convertToDays(state.pulse_value, state.pulse_unit)}-day window
              </span>
              <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono">
                {state.selected_modules.length} modules
              </span>
              <span className="ml-auto text-[11px] text-foreground/75">Briefing ready. Choose one section to import.</span>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
            <aside className="rounded-xl border border-border bg-muted/25 p-2.5">
              <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-foreground/75">
                Briefing map
              </div>
              <div className="max-h-[430px] space-y-1 overflow-y-auto pr-0.5">
                {sectionEntries.map(([heading, body], i) => {
                  const active = heading === selectedHeading;
                  const label = heading === '__intro__' ? 'Intro' : heading;
                  const preview = body.replace(/\s+/g, ' ').trim().slice(0, 86);
                  return (
                    <button
                      key={heading}
                      type="button"
                      onClick={() => setActiveSection(heading)}
                      className={cn(
                        'w-full rounded-lg border px-2 py-2 text-left transition',
                        active
                          ? 'border-foreground/45 bg-background text-foreground shadow-sm'
                          : 'border-border/70 bg-background/70 text-foreground/80 hover:border-foreground/35 hover:text-foreground',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/65">
                          {heading === '__intro__' ? 'Intro' : `§${i + 1}`}
                        </span>
                        <span className="truncate text-[12.5px] font-semibold text-foreground">{label}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-foreground/75">
                        {preview || 'No preview available.'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="rounded-xl border border-border bg-muted/20 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h5 className="text-sm font-semibold text-foreground">
                  {selectedHeading === '__intro__' ? 'Intro' : selectedHeading}
                </h5>
                <button
                  type="button"
                  onClick={importSelectedSection}
                  disabled={!selectedBody}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                >
                  <Send className="h-3 w-3" /> Import to Studio
                </button>
              </div>

              <div className="prose prose-invert max-h-[430px] max-w-none overflow-y-auto pr-1 text-[14px] leading-relaxed prose-p:my-1.5 prose-li:my-0 prose-headings:text-foreground prose-p:text-foreground/90 prose-li:text-foreground/90">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedBody}</ReactMarkdown>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
