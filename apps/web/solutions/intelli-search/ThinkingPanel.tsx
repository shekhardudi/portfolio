'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Backend-classified intent: null = pre-classification, 'agentic', or
   *  anything else (semantic / regular) → semantic panel. */
  intent: string | null;
  semanticPhase: string | null;
  message?: string | null;
  agenticLogs?: string[];
  startTime?: number;
}

/**
 * Mirrors the original Vite App's three thinking-panel states:
 *  1. ClassifyingPanel — intent === null (pre-classification)
 *  2. AgenticThinkingPanel — intent === 'agentic'
 *  3. SemanticThinkingPanel — anything else (semantic / regular / auto)
 */
export default function ThinkingPanel({
  intent,
  semanticPhase,
  message,
  agenticLogs = [],
  startTime,
}: Props) {
  if (intent === null) return <ClassifyingPanel />;
  if (intent === 'agentic') {
    return <AgenticPanel logs={agenticLogs} message={message} startTime={startTime} />;
  }
  return <SemanticPanel phase={semanticPhase} message={message} />;
}

// ── ClassifyingPanel ────────────────────────────────────────────────────────

function ClassifyingPanel() {
  return (
    <div className="rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-950/40 via-indigo-950/30 to-slate-950/40 p-5">
      <div className="flex items-center gap-3">
        <Orbit />
        <div>
          <h4 className="text-sm font-semibold text-foreground/95">🔍 Analyzing your query</h4>
          <p className="text-sm text-foreground/85">Classifying intent with AI…</p>
        </div>
      </div>
    </div>
  );
}

// ── SemanticPanel ───────────────────────────────────────────────────────────

const SEMANTIC_STEPS: { key: string; label: string }[] = [
  { key: 'classification', label: 'Intent classified' },
  { key: 'embedding', label: 'Generating embedding' },
  { key: 'vector_search', label: 'Searching vector index' },
];

function SemanticPanel({
  phase,
  message,
}: {
  phase: string | null;
  message?: string | null;
}) {
  // `phase` is null until the first embedding/vector_search event arrives.
  // Once classification completes, classification step is implicitly done.
  // When phase === 'embedding': step 1 done, step 2 active, step 3 pending.
  // When phase === 'vector_search': step 1+2 done, step 3 active.
  const order = ['classification', 'embedding', 'vector_search'];
  const idx = phase ? order.indexOf(phase) : 0; // 0 means classification just done, embedding next
  // Treat null phase as "classification just finished" — show step 1 as done,
  // step 2 (embedding) as active.
  const activeIdx = phase === null ? 1 : idx;

  return (
    <div className="rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-950/40 via-indigo-950/30 to-slate-950/40 p-5">
      <div className="flex items-center gap-3">
        <Orbit />
        <div>
          <h4 className="text-sm font-semibold text-foreground/95">✨ AI Searching</h4>
          <p className="text-sm text-foreground/85">
            {message || 'Intelligently processing your query…'}
          </p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {SEMANTIC_STEPS.map((s, i) => {
          const state: 'done' | 'active' | 'pending' =
            i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
          return (
            <li key={s.key} className="flex items-center gap-2 text-sm">
              <StepIcon state={state} />
              <span
                className={cn(
                  state === 'pending'
                    ? 'text-foreground/75'
                    : 'text-foreground/95',
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── AgenticPanel ────────────────────────────────────────────────────────────

function AgenticPanel({
  logs,
  message,
  startTime,
}: {
  logs: string[];
  message?: string | null;
  startTime?: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const iv = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => window.clearInterval(iv);
  }, [startTime]);

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
      <div className="flex items-center gap-3">
        <Orbit />
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-foreground/95">🤖 AI Agent Researching</h4>
          <p className="text-sm text-foreground/85">
            {message || 'Querying external data sources…'}
          </p>
        </div>
        {startTime && (
          <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs">
            {elapsed}s
          </span>
        )}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {logs.length === 0 ? (
          <li className="flex items-center gap-2 text-muted-foreground">
            <StepIcon state="active" />
            <span>Spinning up plan…</span>
          </li>
        ) : (
          logs.map((msg, i) => {
            const isDone = i < logs.length - 1;
            return (
              <li key={i} className="flex items-start gap-2">
                <StepIcon state={isDone ? 'done' : 'active'} />
                <span className={cn(isDone ? 'text-foreground/95' : 'text-foreground/80')}>
                  {msg}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

// ── Atoms ───────────────────────────────────────────────────────────────────

function StepIcon({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done')
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        ✓
      </span>
    );
  if (state === 'active')
    return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border text-muted-foreground">
      ○
    </span>
  );
}

function Orbit() {
  return (
    <div className="relative h-9 w-9">
      <span className="absolute inset-0 rounded-full border border-blue-500/30" />
      <span className="absolute inset-0 animate-spin rounded-full border-t-2 border-blue-400/80" />
      <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]" />
      <span
        className="absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.8)] animate-pulse"
        style={{ animationDelay: '0.3s' }}
      />
      <span
        className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(103,232,249,0.8)] animate-pulse"
        style={{ animationDelay: '0.6s' }}
      />
      <span className="absolute inset-[10px] rounded-full bg-blue-500/30" />
    </div>
  );
}
