'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Layers,
  Sparkles,
  Telescope,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULE_LOOKUP } from './modules';

export interface ScoutCallback {
  ts: string;
  module: string;
  phase: string;
  message: string;
}

interface Props {
  callbacks: ScoutCallback[];
  /** Whether the scout run is still in flight — drives the typing indicator. */
  active: boolean;
  /** Currently-active module id (used by the idle/thinking copy). */
  module?: string;
  /** Optional: explicit height. Otherwise the container's height is used. */
  height?: number;
  className?: string;
}

const PHASE: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  start:    { icon: CircleDot,    tone: 'text-blue-300',     label: 'start' },
  progress: { icon: Layers,       tone: 'text-sky-300',      label: 'progress' },
  done:     { icon: CheckCircle2, tone: 'text-emerald-300',  label: 'done' },
  error:    { icon: AlertTriangle,tone: 'text-red-300',      label: 'error' },
  default:  { icon: CircleDot,    tone: 'text-foreground/55',label: 'event' },
};

function moduleLabel(id: string): string {
  if (!id) return 'Pulse Scout';
  if (id === 'memory')    return 'Snapshot';
  if (id === 'extractor') return 'Findings extractor';
  if (id === 'synthesis') return 'Briefing synthesis';
  return MODULE_LOOKUP[id]?.label ?? id;
}

/**
 * Live activity feed for a Pulse Scout run.
 *
 * Mirrors the Studio's EventStream UX:
 * - Newest event at the BOTTOM (chat style).
 * - Auto-scrolls when the user is already near the bottom; if they've scrolled
 *   up to read, we surface a "Jump to latest" pill instead of yanking them.
 * - When no new event arrives for ~1.3s, a soft "thinking" indicator appears
 *   so a long scan doesn't feel frozen.
 */
export default function ScoutFeed({
  callbacks,
  active,
  module,
  height,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const recentTickAt = useRef<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    recentTickAt.current = callbacks.length ? Date.now() : null;
  }, [callbacks.length]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoFollow(distanceFromBottom < 80);
  }

  // Trigger the "thinking" indicator after a short idle stretch so the feed
  // never looks frozen while we wait for the next backend tick. 700ms is
  // short enough to feel responsive but long enough that it doesn't flicker
  // against rapid event bursts.
  const showThinking =
    active &&
    (callbacks.length === 0 ||
      (recentTickAt.current !== null && now - recentTickAt.current > 700));

  useLayoutEffect(() => {
    if (!autoFollow) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
  }, [callbacks.length, showThinking, autoFollow]);

  // Single-shot timer that arms after each new event so the thinking
  // indicator can flip on once per idle stretch. Matches showThinking's
  // 700ms threshold above.
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setNow(Date.now()), 700);
    return () => window.clearTimeout(id);
  }, [active, callbacks.length]);

  const idlePhrase = module
    ? `${moduleLabel(module)} is collecting sources…`
    : 'Pulse Scout is warming up — first sources land in a few seconds.';

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-muted/20',
        className,
      )}
      style={height ? { height } : undefined}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border bg-background/70 px-3 py-2">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <Telescope className="h-3.5 w-3.5" />
          Live activity
        </div>
        {callbacks.length > 0 && (
          <span className="font-mono text-[10.5px] text-foreground/65">
            {callbacks.length} event{callbacks.length === 1 ? '' : 's'}
          </span>
        )}
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
      >
        {callbacks.length === 0 && !active && <EmptyState />}

        {callbacks.length === 0 && active && <ShimmerCard label={idlePhrase} />}

        {callbacks.map((cb, i) => (
          <CallbackCard
            key={`${cb.ts}-${i}`}
            cb={cb}
            fresh={i === callbacks.length - 1 && active}
          />
        ))}

        {showThinking && callbacks.length > 0 && <ThinkingBubble label={idlePhrase} />}
      </div>

      {!autoFollow && (callbacks.length > 0 || showThinking) && (
        <button
          type="button"
          onClick={() => {
            setAutoFollow(true);
            const scroller = scrollRef.current;
            if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold text-foreground/95 shadow-md hover:bg-muted"
        >
          <ChevronDown className="h-3 w-3" />
          Jump to latest
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function CallbackCard({ cb, fresh }: { cb: ScoutCallback; fresh: boolean }) {
  const phase = PHASE[cb.phase] ?? PHASE.default;
  const Icon = phase.icon;
  const time = cb.ts ? cb.ts.slice(11, 19) : '';
  const isError = cb.phase === 'error';

  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-[13px]',
        'animate-in fade-in slide-in-from-bottom-1 duration-200',
        isError ? 'border-red-500/40 bg-red-500/5' : 'border-border/80',
        fresh && !isError && 'border-foreground/30 shadow-sm shadow-foreground/[0.04]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border bg-muted/60',
          isError ? 'border-red-500/40' : 'border-border',
          phase.tone,
        )}
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[12px] font-semibold text-foreground">
            {moduleLabel(cb.module)}
          </span>
          <span
            className={cn(
              'text-[10px] uppercase tracking-wide',
              isError ? 'text-red-300' : 'text-foreground/65',
            )}
          >
            {phase.label}
          </span>
          {time && (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-foreground/65">
              {time}
            </span>
          )}
        </div>
        {cb.message && (
          <p
            className={cn(
              'mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed',
              isError ? 'text-red-200/90' : 'text-foreground/95',
            )}
          >
            {cb.message}
          </p>
        )}
      </div>
    </div>
  );
}

function ShimmerCard({ label }: { label: string }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-3">
      <div className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-muted/60">
        <Brain className="h-3.5 w-3.5 animate-pulse text-foreground/55" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-foreground">thinking</span>
          <span className="inline-flex gap-0.5">
            <Dot delay="0ms" />
            <Dot delay="160ms" />
            <Dot delay="320ms" />
          </span>
        </div>
        <div className="mt-2 space-y-2">
          <div className="h-2.5 w-full animate-pulse rounded bg-muted/50" />
          <div className="h-2.5 w-5/6 animate-pulse rounded bg-muted/40" />
        </div>
        <p className="mt-1.5 text-[11px] italic text-foreground/70">{label}</p>
      </div>
    </div>
  );
}

function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-dashed border-foreground/30 bg-background/70 px-3 py-2 text-[12px] text-foreground/85">
      <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md text-foreground/55">
        <Brain className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">thinking</span>
          <span className="inline-flex gap-0.5">
            <Dot delay="0ms" />
            <Dot delay="160ms" />
            <Dot delay="320ms" />
          </span>
        </div>
        <p className="mt-0.5 text-[11.5px] italic text-foreground/80">{label}</p>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/60"
      style={{ animationDelay: delay, animationDuration: '900ms' }}
    />
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Sparkles className="h-5 w-5 text-foreground/70" />
      <p className="text-sm font-semibold text-foreground/95">Live scout activity</p>
      <p className="max-w-xs text-xs text-foreground/75">
        Each module&apos;s start, progress, and result will stream here in real time — newest at the
        bottom, just like the Studio crew feed.
      </p>
    </div>
  );
}
