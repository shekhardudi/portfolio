'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  EndpointMissingError,
  getPost,
  startPost,
  type AgentEvent,
  type PostJob,
  type PostStage,
} from './client';
import EventStream from './EventStream';
import CostTracker from './CostTracker';
import type { DemoAction, DemoState } from './useDemoState';

interface Props {
  state: DemoState;
  dispatch: React.Dispatch<DemoAction>;
  onCompleted: () => void;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 20 * 60_000; // 20 minutes — large multi-agent runs can be slow
const POLL_MAX_CONSECUTIVE_ERRORS = 30; // tolerate transient network blips during long runs

export default function ProductionStudio({ state, dispatch, onCompleted }: Props) {
  const busy = state.job_status === 'queued' || state.job_status === 'running';
  const [unavailable, setUnavailable] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const cancelledRef = useRef(false);

  // Tick a clock for the stage timer.
  useEffect(() => {
    if (!busy || !state.started_at_ms) return;
    const id = window.setInterval(() => {
      setElapsedSec(Math.round((Date.now() - state.started_at_ms!) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [busy, state.started_at_ms]);

  function patch(p: Partial<DemoState>) {
    dispatch({ type: 'PATCH', payload: p });
  }

  async function run() {
    if (busy) return;
    setUnavailable(false);
    cancelledRef.current = false;
    try {
      const ack = await startPost({
        topic: state.topic,
        leader_angle: state.leader_angle,
        author_name: state.author_name,
        author_title: state.author_title,
        author_location: state.author_location,
        author_vibe: state.author_vibe,
        audience: state.audience,
      });
      dispatch({ type: 'JOB_START', job_id: ack.job_id });
      void pollUntilDone(ack.job_id);
    } catch (e) {
      if (e instanceof EndpointMissingError) setUnavailable(true);
      else
        dispatch({
          type: 'JOB_FAIL',
          error: e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message,
        });
    }
  }

  async function pollUntilDone(jobId: string) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let consecutiveErrors = 0;
    while (!cancelledRef.current && Date.now() < deadline) {
      try {
        const job = await getPost(jobId);
        consecutiveErrors = 0;
        applyJob(job);
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          if (job.status === 'completed' && job.result) {
            onCompleted();
          }
          return;
        }
      } catch (e) {
        // 404 means the server forgot the job — fatal.
        if (e instanceof ApiError && e.status === 404) {
          dispatch({ type: 'JOB_FAIL', error: 'Job lost server-side' });
          return;
        }
        // Everything else (timeouts, 5xx, AbortError, network) is treated as
        // transient. Long crew runs frequently make a single GET hang past the
        // default 30s timeout — we just retry until the run finishes or the
        // overall deadline fires.
        consecutiveErrors += 1;
        if (consecutiveErrors >= POLL_MAX_CONSECUTIVE_ERRORS) {
          dispatch({
            type: 'JOB_FAIL',
            error: 'Lost connection to backend — please retry.',
          });
          return;
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!cancelledRef.current) {
      dispatch({ type: 'JOB_FAIL', error: 'Run exceeded the 20 minute polling window.' });
    }
  }

  function applyJob(job: PostJob) {
    const stage: PostStage = (job.progress?.stage as PostStage) ?? 'queued';
    const events: AgentEvent[] = job.progress?.events ?? [];
    dispatch({ type: 'JOB_TICK', status: job.status, stage, events });

    if (job.status === 'failed') {
      dispatch({ type: 'JOB_FAIL', error: job.error ?? 'crew failed' });
      return;
    }
    if (job.status === 'completed' && job.result) {
      dispatch({
        type: 'JOB_RESULT',
        run_id: job.result.run_id,
        post_draft: job.result.post_draft ?? '',
        image_prompt: job.result.image_prompt ?? '',
        emotional_beats: job.result.emotional_beats ?? [],
        cost: job.result.cost_breakdown ?? null,
      });
    }
  }

  // Stop polling on unmount.
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const ready = state.topic.trim().length > 1 && state.leader_angle.trim().length > 0;
  const showCompletion = state.crew_done && !busy;
  const liveStage: PostStage = busy ? state.stage : showCompletion ? 'visual_director' : 'queued';
  const failed = state.job_status === 'failed';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <WorkflowRail
          stage={liveStage}
          active={busy}
          complete={showCompletion}
          failed={failed}
          elapsedSec={elapsedSec}
        />
        <CostTracker cost={state.cost} kind="studio" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(340px,0.95fr)_minmax(420px,1.05fr)]">
      {/* ── Left column: form ──────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="space-y-4 rounded-xl border border-border bg-muted/15 p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">LinkedIn Crew</h4>
            <p className="mt-0.5 text-xs leading-snug text-foreground/80">
              Researcher → Writer → Critic → Visual Director
              <span className="block text-foreground/70">~60–180s typical run.</span>
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              busy
                ? 'border-foreground/40 bg-foreground/10 text-foreground'
                : showCompletion
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-border bg-background text-foreground/80',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                busy ? 'animate-pulse bg-foreground/80' : showCompletion ? 'bg-emerald-400' : 'bg-foreground/40',
              )}
            />
            {busy ? 'Running' : showCompletion ? 'Done' : 'Idle'}
          </span>
        </div>

        <Field label="Topic">
          <input
            value={state.topic}
            onChange={(e) => patch({ topic: e.target.value })}
            disabled={busy}
            className="input"
            placeholder="e.g. Mixture of Experts in production LLMs"
          />
        </Field>

        <Field label="Your take (the human bridge)">
          <textarea
            rows={3}
            value={state.leader_angle}
            onChange={(e) => patch({ leader_angle: e.target.value })}
            disabled={busy}
            className="input"
            placeholder="The opinion that becomes the soul of the post."
          />
        </Field>

        <Field label="Author vibe">
          <input
            value={state.author_vibe}
            onChange={(e) => patch({ author_vibe: e.target.value })}
            disabled={busy}
            className="input"
            placeholder="e.g. Skeptical — I think this is overhyped"
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Author name">
            <input
              value={state.author_name}
              onChange={(e) => patch({ author_name: e.target.value })}
              disabled={busy}
              className="input"
            />
          </Field>
          <Field label="Title">
            <input
              value={state.author_title}
              onChange={(e) => patch({ author_title: e.target.value })}
              disabled={busy}
              className="input"
            />
          </Field>
          <Field label="Location" className="sm:col-span-2">
            <input
              value={state.author_location}
              onChange={(e) => patch({ author_location: e.target.value })}
              disabled={busy}
              className="input"
            />
          </Field>
        </div>

        <Field label="Audience">
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
            {(['engineering', 'business'] as const).map((a) => (
              <button
                key={a}
                type="button"
                disabled={busy}
                onClick={() => patch({ audience: a })}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition',
                  state.audience === a
                    ? 'bg-foreground text-background'
                    : 'bg-background text-foreground/90 hover:bg-muted',
                )}
              >
                {a === 'engineering' ? 'Engineering' : 'Business'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-foreground/75">
            Drives the visual style of the generated cover image.
          </p>
        </Field>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={busy || !ready}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Running…
              </>
            ) : showCompletion ? (
              <>
                <Wand2 className="h-4 w-4" /> Run again
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" /> Run Production Crew
              </>
            )}
          </button>
          {state.current_job_id && (
            <span className="text-[11px] text-foreground/75">
              job <code className="font-mono text-foreground/80">{state.current_job_id.slice(0, 8)}</code>
            </span>
          )}
        </div>

        {state.job_error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{state.job_error}</span>
          </div>
        )}

        {unavailable && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200">
            Production endpoint isn&apos;t reachable yet — try again, or run on the live app.
          </div>
        )}

        <style jsx>{`
          .input {
            width: 100%;
            border-radius: 0.375rem;
            border: 1px solid hsl(var(--border));
            background: hsl(var(--background));
            padding: 0.5rem 0.7rem;
            font-size: 0.85rem;
            line-height: 1.35;
            outline: none;
          }
          .input:focus {
            box-shadow: 0 0 0 1px hsl(var(--ring));
          }
          .input:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
        `}</style>
      </form>

      {/* ── Right column: live activity ────────────────────────────── */}
      <div className="space-y-3 lg:min-w-[420px]">
        {(busy || state.events.length > 0) && (
          <EventStream
            events={state.events}
            active={busy}
            stage={state.stage}
            className="h-[560px]"
          />
        )}

        {!busy && state.events.length === 0 && !showCompletion && (
          <IdleHero />
        )}

        {showCompletion && (
          <CompletionPanel
            elapsedSec={elapsedSec}
            beats={state.emotional_beats}
            onSeeOutput={onCompleted}
          />
        )}
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block text-xs', className)}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-foreground/65">
        {label}
      </span>
      {children}
    </label>
  );
}

function WorkflowRail({
  stage,
  active,
  complete,
  failed,
  elapsedSec,
}: {
  stage: PostStage;
  active: boolean;
  complete: boolean;
  failed: boolean;
  elapsedSec: number;
}) {
  const steps: { key: PostStage; label: string; hint: string }[] = [
    { key: 'research', label: 'Researcher', hint: 'facts + context' },
    { key: 'writing', label: 'Writer', hint: 'first draft' },
    { key: 'critique', label: 'Critic', hint: 'tighten voice' },
    { key: 'visual_director', label: 'Visual Director', hint: 'cover direction' },
  ];
  const order: PostStage[] = ['queued', 'research', 'writing', 'critique', 'visual_director'];
  const current = order.indexOf(stage);
  const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
  const secs = Math.floor(elapsedSec % 60).toString().padStart(2, '0');

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Workflow</h4>
        <div
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-medium',
            failed
              ? 'border-red-500/40 bg-red-500/10 text-red-200'
              : 'border-border bg-background text-foreground/85',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              failed
                ? 'bg-red-400'
                : active
                  ? 'animate-pulse bg-foreground/80'
                  : complete
                    ? 'bg-emerald-400'
                    : 'bg-foreground/45',
            )}
          />
          <span>
            {failed
              ? 'Crew failed'
              : active
                ? 'Crew running'
                : complete
                  ? 'Crew complete'
                  : 'Crew idle'}
          </span>
          {(active || complete || failed) && (
            <span className="font-mono tabular-nums text-foreground/70">
              {mins}:{secs}
            </span>
          )}
        </div>
      </div>
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
        {steps.map((s, i) => {
          const idx = order.indexOf(s.key);
          const done = complete || (active && idx < current) || (failed && idx < current);
          const currentStep = (active || failed) && idx === current;
          const isFailedStep = failed && currentStep;
          return (
            <li
              key={s.key}
              className={cn(
                'rounded-lg border px-2.5 py-1.5',
                done && 'border-emerald-500/30 bg-emerald-500/[0.06]',
                currentStep && !isFailedStep && 'border-foreground/40 bg-background shadow-sm',
                isFailedStep && 'border-red-500/40 bg-red-500/[0.08] shadow-sm',
                !done && !currentStep && 'border-border/70 bg-background/60',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                    done && 'bg-emerald-500/20 text-emerald-300',
                    currentStep && !isFailedStep && 'bg-foreground text-background',
                    isFailedStep && 'bg-red-500/30 text-red-200',
                    !done && !currentStep && 'bg-muted text-foreground/60',
                  )}
                >
                  {isFailedStep ? '!' : i + 1}
                </span>
                <span className="truncate text-[12px] font-semibold text-foreground/90">{s.label}</span>
              </div>
              <p
                className={cn(
                  'mt-1 text-[11px]',
                  isFailedStep ? 'text-red-200/80' : 'text-foreground/75',
                )}
              >
                {isFailedStep ? 'failed — see live activity' : s.hint}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}


function IdleHero() {
  return (
    <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/15 p-8 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background">
        <Sparkles className="h-5 w-5 text-foreground/80" />
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">Live activity</p>
        <p className="mt-1 max-w-sm text-xs text-foreground/80">
          When you run the crew, you&apos;ll see each agent think, call tools, and hand off to the next
          one — newest activity at the bottom, like a chat.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] text-foreground/75 sm:grid-cols-4">
        {['Researcher', 'Writer', 'Critic', 'Visual Director'].map((r) => (
          <span key={r} className="rounded-full border border-border bg-background px-2 py-1">
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

function CompletionPanel({
  elapsedSec,
  beats,
  onSeeOutput,
}: {
  elapsedSec: number;
  beats: string[];
  onSeeOutput: () => void;
}) {
  const mins = Math.floor(elapsedSec / 60);
  const elapsedLabel = mins > 0 ? `${mins}m ${elapsedSec % 60}s` : `${elapsedSec}s`;
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-100">Crew complete</p>
          <p className="mt-0.5 text-xs text-emerald-100/80">
            Finished in {elapsedLabel}. Your post + image prompt are ready in the Output tab.
          </p>
          {beats.length > 0 && (
            <div className="mt-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-emerald-200/85">
                Emotional beats
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {beats.slice(0, 6).map((b, i) => (
                  <li
                    key={i}
                    className="rounded-full border border-emerald-500/30 bg-background/40 px-2 py-0.5 text-[11px] text-foreground/85"
                  >
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={onSeeOutput}
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-emerald-950 hover:bg-emerald-400"
          >
            See output <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
