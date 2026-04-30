'use client';

import { useState } from 'react';
import { ExternalLink, Loader2, Play, Send } from 'lucide-react';
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
  pollScoutJob,
  scoutRun,
} from './client';
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

export default function ScoutPanel({ state, dispatch, onImport }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [progressIndex, setProgressIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  function toggleModule(key: string) {
    const next = state.selected_modules.includes(key)
      ? state.selected_modules.filter((m) => m !== key)
      : [...state.selected_modules, key];
    dispatch({ type: 'PATCH', payload: { selected_modules: next } });
  }

  async function run() {
    setBusy(true);
    setError(null);
    setProgress('');
    setProgressIndex(-1);
    setUnavailable(false);
    try {
      const days = convertToDays(state.pulse_value, state.pulse_unit);
      const ack = await scoutRun({ modules: state.selected_modules, days });
      const startedAt = Date.now();
      // Estimate ~6 s per module + 4 s for final synthesis. Used as a fallback
      // when the backend doesn't report `current_module` per tick.
      const estimatedPerModule = 6_000;
      const final = await pollScoutJob(ack.job_id, {
        onTick: (job) => {
          if (job.status !== 'running') return;
          const reported = (job as { current_module?: string }).current_module;
          let label: string | null = null;
          if (reported && STEP_LABELS[reported]) {
            label = STEP_LABELS[reported];
            setProgressIndex(state.selected_modules.indexOf(reported));
          } else {
            const elapsed = Date.now() - startedAt;
            const idx = Math.min(
              Math.floor(elapsed / estimatedPerModule),
              state.selected_modules.length, // last index = synthesis
            );
            setProgressIndex(idx);
            const k = state.selected_modules[idx];
            label = k ? (STEP_LABELS[k] ?? `Working on ${k}…`) : 'Synthesising briefing…';
          }
          if (label) setProgress(label);
        },
      });
      if (final.status === 'failed') throw new Error(final.error ?? 'scout failed');
      const md = final.result_md ?? '';
      dispatch({ type: 'PATCH', payload: { pulse_md: md, pulse_done: true } });
    } catch (e) {
      if (e instanceof EndpointMissingError) {
        setUnavailable(true);
      } else {
        setError(e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message);
      }
    } finally {
      setBusy(false);
      setProgress('');
      setProgressIndex(-1);
    }
  }

  const sections = state.pulse_md ? parseH2Sections(state.pulse_md) : {};

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <h4 className="text-base font-semibold">Pulse Scout</h4>
        <p className="mt-1 text-sm text-foreground/75">
          Surveys community sentiment, deep-dives, tooling chatter and expert takes for the
          given window — produces a markdown briefing you can import into the Studio.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/80">
              Modules
            </div>
            <div className="flex flex-wrap gap-1.5">
              {MODULE_OPTIONS.map((m) => {
                const active = state.selected_modules.includes(m.key);
                return (
                  <button
                    key={m.key}
                    onClick={() => toggleModule(m.key)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition',
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border text-foreground/75 hover:text-foreground',
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-foreground/75">Time window</span>
            <input
              type="number"
              min={1}
              value={state.pulse_value}
              onChange={(e) =>
                dispatch({ type: 'PATCH', payload: { pulse_value: Number(e.target.value) || 1 } })
              }
              className="w-20 rounded-md border border-border bg-background px-2 py-1"
            />
            <Select
              value={state.pulse_unit}
              onValueChange={(v) =>
                dispatch({ type: 'PATCH', payload: { pulse_unit: v as TimeUnit } })
              }
            >
              <SelectTrigger className="h-8 w-28 bg-muted/40">
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

            <button
              onClick={run}
              disabled={busy || state.selected_modules.length === 0}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1 text-background disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run
            </button>
          </div>

          {busy && (
            <div className="space-y-2 rounded-md border border-border bg-background px-3 py-2.5">
              <div className="text-sm text-foreground/85">{progress || 'Starting…'}</div>
              <div className="flex items-center gap-1">
                {state.selected_modules.map((k, i) => {
                  const state_: 'done' | 'active' | 'pending' =
                    i < progressIndex ? 'done' : i === progressIndex ? 'active' : 'pending';
                  return (
                    <div
                      key={k}
                      title={STEP_LABELS[k] ?? k}
                      className={cn(
                        'h-1.5 flex-1 rounded-full transition-colors',
                        state_ === 'done' && 'bg-emerald-500/70',
                        state_ === 'active' && 'animate-pulse bg-blue-500',
                        state_ === 'pending' && 'bg-muted',
                      )}
                    />
                  );
                })}
                <div
                  title="Synthesise briefing"
                  className={cn(
                    'h-1.5 w-6 rounded-full transition-colors',
                    progressIndex >= state.selected_modules.length
                      ? 'animate-pulse bg-blue-500'
                      : 'bg-muted',
                  )}
                />
              </div>
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">
              {error}
            </div>
          )}
          {unavailable && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              Scout endpoints aren&apos;t deployed on this backend yet. The Streamlit app has the
              full version —{' '}
              <a
                className="inline-flex items-center gap-1 underline"
                href={`${LINKEDIN_API_BASE}/`}
                target="_blank"
                rel="noopener noreferrer"
              >
                run on live app <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </div>

      {state.pulse_done && state.pulse_md && (
        <div className="space-y-2">
          <h5 className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            Briefing
          </h5>
          {Object.entries(sections).map(([heading, body]) => (
            <details
              key={heading}
              className="rounded-xl border border-border bg-muted/40 p-3"
              open={heading === Object.keys(sections)[0]}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-medium">
                <span>{heading === '__intro__' ? 'Intro' : heading}</span>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    onImport(heading, body);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                >
                  <Send className="h-3 w-3" /> Import → Studio
                </button>
              </summary>
              <div className="prose prose-invert mt-2 max-w-none text-sm prose-p:my-1.5 prose-li:my-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
