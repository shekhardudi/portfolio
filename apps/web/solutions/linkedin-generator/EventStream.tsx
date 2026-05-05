'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Brain,
  ChevronDown,
  CircleDot,
  Hammer,
  Inbox,
  MessageCircle,
  Puzzle,
  Sparkles,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentEvent, PostStage } from './client';

interface Props {
  events: AgentEvent[];
  /** Whether the run is still in flight — drives the typing indicator. */
  active: boolean;
  /** Current backend stage. Used for the idle "thinking" copy. */
  stage: PostStage;
  /** Optional: collapse the box height if you embed it elsewhere. */
  height?: number;
  className?: string;
}

const KIND: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  reasoning:      { icon: Brain,        tone: 'text-violet-400',   label: 'reasoning' },
  thought:        { icon: Brain,        tone: 'text-violet-400',   label: 'thought' },
  tool:           { icon: Wrench,       tone: 'text-sky-400',      label: 'tool' },
  tool_started:   { icon: Wrench,       tone: 'text-sky-400',      label: 'tool · start' },
  tool_result:    { icon: Inbox,        tone: 'text-emerald-400',  label: 'tool · result' },
  answer:         { icon: MessageCircle,tone: 'text-foreground',   label: 'answer' },
  task_done:      { icon: Sparkles,     tone: 'text-emerald-300',  label: 'task complete' },
  stage:          { icon: Hammer,       tone: 'text-amber-300',    label: 'stage' },
  agent_started:  { icon: UserRound,    tone: 'text-blue-300',     label: 'agent start' },
  step:           { icon: CircleDot,    tone: 'text-foreground/55',label: 'step' },
  default:        { icon: Puzzle,       tone: 'text-foreground/55',label: 'event' },
};

const STAGE_PHRASE: Record<PostStage, string> = {
  queued: 'queueing the run…',
  research: 'researcher is gathering facts and citations…',
  writing: 'writer is drafting the post…',
  critique: 'critic is line-editing the draft…',
  visual_director: 'visual director is planning the cover image…',
};

/**
 * Live activity feed for an Authority Crew run.
 *
 * UX choices:
 * - Newest event at the BOTTOM (chat style).
 * - Auto-scrolls to bottom on every update — but only when the user is
 *   already at/near the bottom. If they scroll up to read, we show a
 *   "Jump to latest" pill instead of yanking the viewport.
 * - When a tick arrives but no new events for ~1.2s, we render a soft
 *   "thinking" indicator beneath the last bubble so the room never feels
 *   dead during long tool calls.
 * - Empty state shows a stage-aware shimmer so the first second of a run
 *   isn't a blank box.
 */
export default function EventStream({
  events,
  active,
  stage,
  height,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recentTickAt = useRef<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  // Track timestamp of the most recent event in an effect (not during render)
  // so we avoid the anti-pattern of mutating a ref in the render body.
  useEffect(() => {
    recentTickAt.current = events.length ? Date.now() : null;
  }, [events.length]);

  // Track whether the user is near the bottom (within 80px). Once they
  // scroll up beyond that, autoFollow disables until they catch up again.
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoFollow(distanceFromBottom < 80);
  }

  const showThinking =
    active &&
    (events.length === 0 ||
      (recentTickAt.current !== null && now - recentTickAt.current > 1200));

  // Scroll to latest content when the feed grows or the thinking bubble
  // appears. showThinking is safe here because with the self-arming timeout
  // it only flips true once per idle period (not every 700 ms), so this
  // effect won't thrash. stage is intentionally omitted — it doesn't add
  // new DOM nodes.
  useLayoutEffect(() => {
    if (!autoFollow) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
  }, [events.length, showThinking, autoFollow]);

  // Arm a single 1.3 s shot after each new event so `showThinking` can
  // flip on. Re-arming on events.length restarts the shot whenever fresh
  // events arrive, which also cancels any in-flight timeout — so we never
  // spin perpetually during a long idle stretch.
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setNow(Date.now()), 1_300);
    return () => window.clearTimeout(id);
  }, [active, events.length]);

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-muted/20',
        className,
      )}
      style={height ? { height } : undefined}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
      >
        {events.length === 0 && !active && (
          <EmptyState />
        )}

        {events.length === 0 && active && (
          <ShimmerCard label={STAGE_PHRASE[stage]} />
        )}

        {events.map((evt, i) => (
          <EventCard key={`${evt.ts}-${i}`} evt={evt} fresh={i === events.length - 1 && active} />
        ))}

        {showThinking && events.length > 0 && (
          <ThinkingBubble stage={stage} />
        )}

        <div ref={bottomRef} className="h-1" />
      </div>

      {/* "Jump to latest" pill — only shown when the user has scrolled up */}
      {!autoFollow && (events.length > 0 || showThinking) && (
        <button
          type="button"
          onClick={() => {
            setAutoFollow(true);
            const scroller = scrollRef.current;
            if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' });
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold text-foreground/90 shadow-md hover:bg-muted"
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

function EventCard({ evt, fresh }: { evt: AgentEvent; fresh: boolean }) {
  const k = KIND[evt.kind] ?? KIND.default;
  const Icon = k.icon;
  const time = evt.ts ? evt.ts.slice(11, 19) : '';
  return (
    <div
      className={cn(
        'group flex gap-2.5 rounded-lg border border-border/80 bg-background px-3 py-2.5 text-[13px]',
        'animate-in fade-in slide-in-from-bottom-1 duration-200',
        fresh && 'border-foreground/30 shadow-sm shadow-foreground/[0.04]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60',
          k.tone,
        )}
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[12px] font-semibold text-foreground/95">
            {evt.agent && evt.agent !== '—' ? evt.agent : k.label}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-foreground/55">
            {k.label}
          </span>
          {time && (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-foreground/65">
              {time}
            </span>
          )}
        </div>
        {evt.text && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground/95">
            {evt.text}
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
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted/70" />
        <div className="h-2.5 w-full animate-pulse rounded bg-muted/50" />
        <div className="h-2.5 w-5/6 animate-pulse rounded bg-muted/40" />
        <p className="pt-0.5 text-[11px] italic text-foreground/55">{label}</p>
      </div>
    </div>
  );
}

function ThinkingBubble({ stage }: { stage: PostStage }) {
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
        <p className="mt-0.5 text-[11.5px] italic text-foreground/80">
          {STAGE_PHRASE[stage]}
        </p>
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
      <p className="text-sm font-semibold text-foreground/90">Live activity will appear here</p>
      <p className="max-w-xs text-xs text-foreground/75">
        Submit a topic and watch the multi-agent crew think, call tools, and hand off in real time.
      </p>
    </div>
  );
}
