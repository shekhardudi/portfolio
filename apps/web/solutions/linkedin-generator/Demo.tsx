'use client';

import { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { generate, pollJob, type JobRecord } from './client';
import { ApiError } from '@/lib/api';

export default function Demo() {
  const [topic, setTopic] = useState('Agentic AI workflows');
  const [angle, setAngle] = useState(
    'Why most agentic systems are overengineered for the problems they actually solve',
  );
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function run() {
    setBusy(true);
    setJob(null);
    setError(null);
    const startedAt = Date.now();
    setElapsed(0);
    try {
      const ack = await generate({ topic, leader_angle: angle });
      const final = await pollJob(ack.job_id, {
        intervalMs: 3_000,
        timeoutMs: 240_000,
        onTick: (j) => {
          setJob(j);
          setElapsed(Math.round((Date.now() - startedAt) / 1000));
        },
      });
      setJob(final);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="space-y-4 rounded-xl border border-border bg-muted/20 p-5"
      >
        <Field label="Topic">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          />
        </Field>
        <Field label="Leader angle (the take)">
          <textarea
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          />
        </Field>
        <button
          type="submit"
          disabled={busy || !topic.trim() || !angle.trim()}
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
        {job && (
          <div className="text-xs text-muted-foreground">
            job: <code className="text-foreground">{job.job_id.slice(0, 8)}</code> ·{' '}
            status: <code className="text-foreground">{job.status}</code>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </form>

      <div className="rounded-xl border border-border bg-muted/20 p-5">
        <h4 className="text-sm font-semibold">Output</h4>
        {!job && (
          <p className="mt-2 text-sm text-muted-foreground">
            Submit a topic + angle to draft a post. Runs take 60–180s — the agents do real
            web research.
          </p>
        )}
        {job?.status === 'succeeded' && job.result && (
          <article className="prose prose-invert mt-3 max-w-none whitespace-pre-wrap text-sm">
            {job.result}
          </article>
        )}
        {job?.status === 'failed' && (
          <pre className="mt-3 max-h-80 overflow-auto rounded bg-background p-2 text-xs text-red-300">
            {job.error}
          </pre>
        )}
        {(job?.status === 'queued' || job?.status === 'running') && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {job.status === 'queued'
              ? 'waiting in queue…'
              : 'crew is researching + drafting…'}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}
