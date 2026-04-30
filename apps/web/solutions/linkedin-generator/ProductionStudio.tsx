'use client';

import { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { generate, pollJob } from './client';
import { extractFinalizedPost, estimateCostUSD, estimateTokens } from './helpers';
import type { DemoAction, DemoState } from './useDemoState';

interface Props {
  state: DemoState;
  dispatch: React.Dispatch<DemoAction>;
  onCompleted: () => void;
}

export default function ProductionStudio({ state, dispatch, onCompleted }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const busy = state.job_status === 'queued' || state.job_status === 'running';

  function patch(p: Partial<DemoState>) {
    dispatch({ type: 'PATCH', payload: p });
  }

  async function run() {
    const startedAt = Date.now();
    setElapsed(0);
    try {
      const ack = await generate({
        topic: state.topic,
        leader_angle: state.leader_angle,
        author_name: state.author_name,
        author_title: state.author_title,
        author_location: state.author_location,
        author_vibe: state.author_vibe,
      });
      dispatch({ type: 'JOB_START', job_id: ack.job_id });

      const final = await pollJob(ack.job_id, {
        intervalMs: 3_000,
        timeoutMs: 240_000,
        onTick: (j) => {
          dispatch({ type: 'JOB_STATUS', status: j.status });
          setElapsed(Math.round((Date.now() - startedAt) / 1000));
        },
      });

      if (final.status === 'failed') {
        dispatch({ type: 'JOB_STATUS', status: 'failed', error: final.error });
        return;
      }
      const raw = final.result ?? '';
      const [post, dalle] = extractFinalizedPost(raw);
      patch({ post_draft: post, dalle_prompt: dalle });

      // Cost estimate from request + response token sizes.
      const inputTokens = estimateTokens(
        `${state.topic}\n${state.leader_angle}\n${state.author_vibe}`,
      );
      const outputTokens = estimateTokens(raw);
      dispatch({
        type: 'ADD_COST',
        input: inputTokens,
        output: outputTokens,
        usd: estimateCostUSD(inputTokens, outputTokens),
      });

      dispatch({ type: 'JOB_RESULT', raw });
      onCompleted();
    } catch (e) {
      dispatch({
        type: 'JOB_STATUS',
        status: 'failed',
        error: e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message,
      });
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run();
      }}
      className="grid gap-4 rounded-xl border border-border bg-muted/20 p-5 lg:grid-cols-2"
    >
      <div className="space-y-3">
        <Field label="Topic">
          <input
            value={state.topic}
            onChange={(e) => patch({ topic: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Leader angle (the take)">
          <textarea
            rows={4}
            value={state.leader_angle}
            onChange={(e) => patch({ leader_angle: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Author vibe">
          <input
            value={state.author_vibe}
            onChange={(e) => patch({ author_vibe: e.target.value })}
            className="input"
          />
        </Field>
      </div>
      <div className="space-y-3">
        <Field label="Author name">
          <input
            value={state.author_name}
            onChange={(e) => patch({ author_name: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Author title">
          <input
            value={state.author_title}
            onChange={(e) => patch({ author_title: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Author location">
          <input
            value={state.author_location}
            onChange={(e) => patch({ author_location: e.target.value })}
            className="input"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <button
          type="submit"
          disabled={busy || !state.topic.trim() || !state.leader_angle.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> generating ({elapsed}s)
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4" /> generate post
            </>
          )}
        </button>
        {state.current_job_id && (
          <span className="text-[11px] text-muted-foreground">
            job <code className="font-mono text-foreground">{state.current_job_id.slice(0, 8)}</code>{' '}
            · status{' '}
            <code className="font-mono text-foreground">{state.job_status}</code>
          </span>
        )}
        {state.job_error && (
          <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300">
            {state.job_error}
          </span>
        )}
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--background));
          padding: 0.4rem 0.6rem;
          font-size: 0.85rem;
          outline: none;
        }
        .input:focus {
          box-shadow: 0 0 0 1px hsl(var(--ring));
        }
      `}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
