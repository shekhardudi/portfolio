'use client';

import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Hammer,
  Hourglass,
  MessageCircle,
  Search,
  Telescope,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSolutionSession } from '@/lib/session/SessionProvider';
import type { SolutionSlug, SolutionStatus } from '@/lib/session/types';

interface BadgeMeta {
  label: string;
  tone: string;       // tailwind classes for the chip
  icon: LucideIcon;
  pulse?: boolean;    // animated dot for in-flight states
}

const STATUS_META: Record<SolutionStatus, BadgeMeta> = {
  ready:             { label: 'Ready',            tone: 'border-border bg-background text-foreground/75',                       icon: CheckCircle2 },
  searching:         { label: 'Searching',        tone: 'border-blue-500/40 bg-blue-500/10 text-blue-200',                      icon: Search,        pulse: true },
  thinking:          { label: 'Thinking',         tone: 'border-violet-500/40 bg-violet-500/10 text-violet-200',                icon: MessageCircle, pulse: true },
  approval_pending:  { label: 'Approval pending', tone: 'border-amber-500/40 bg-amber-500/10 text-amber-200',                   icon: Hourglass },
  scout_running:     { label: 'Scout running',    tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',             icon: Telescope,     pulse: true },
  studio_running:    { label: 'Studio running',   tone: 'border-orange-500/40 bg-orange-500/10 text-orange-200',                icon: Hammer,        pulse: true },
  error:             { label: 'Error',            tone: 'border-red-500/40 bg-red-500/10 text-red-200',                         icon: AlertCircle },
};

const KNOWN_SLUGS = new Set<SolutionSlug>([
  'intelli-search',
  'agentic-hr',
  'linkedin-generator',
]);

interface Props {
  /** Accepts any string for ergonomic use from `SolutionMeta.slug`. Renders
   *  nothing for slugs not registered in the session layer. */
  slug: string;
  className?: string;
  /** When true, ready state is hidden (caller can show plain title only). */
  hideWhenReady?: boolean;
}

/**
 * Small chip rendered next to the solution title on the home page. Reads
 * from `useSolutionSession(slug).state.status` — no polling, no fetch; the
 * status is updated by the corresponding Demo as it works.
 */
export function SolutionStatusBadge({ slug, className, hideWhenReady }: Props) {
  if (!KNOWN_SLUGS.has(slug as SolutionSlug)) return null;
  return (
    <KnownBadge
      slug={slug as SolutionSlug}
      className={className}
      hideWhenReady={hideWhenReady}
    />
  );
}

function KnownBadge({
  slug,
  className,
  hideWhenReady,
}: {
  slug: SolutionSlug;
  className?: string;
  hideWhenReady?: boolean;
}) {
  const { state } = useSolutionSession(slug);
  const meta = STATUS_META[state.status];

  if (hideWhenReady && state.status === 'ready') return null;
  // Errors are intentionally hidden on the home cards. The full error
  // surface lives inside the demo itself; the home card should only
  // advertise *active* work, not failures, so a transient backend hiccup
  // doesn't shout at the user from the landing page.
  if (hideWhenReady && state.status === 'error') return null;
  // Source-of-truth guard for "active" statuses. The status field is
  // updated optimistically by each Demo as it runs, but if the Demo
  // unmounts mid-flight (user navigated away) or the run errors after
  // unmount, the field can get stuck on `searching` / `thinking` / etc.
  // The home-card pill only makes sense when there's a real job in flight
  // for this slug — so cross-check against `inflightJobIds` and suppress
  // the badge if the registry says nothing is actually running. This
  // makes the home card pill self-healing across navigation and crashes.
  const ACTIVE_STATUSES: SolutionStatus[] = [
    'searching',
    'thinking',
    'scout_running',
    'studio_running',
  ];
  if (
    hideWhenReady
    && ACTIVE_STATUSES.includes(state.status)
    && state.inflightJobIds.length === 0
  ) {
    return null;
  }

  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        meta.tone,
        className,
      )}
      aria-label={meta.label}
      title={meta.label}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        <span
          className={cn(
            'absolute inset-0 rounded-full',
            meta.pulse ? 'opacity-75 motion-safe:animate-ping' : 'opacity-0',
            meta.tone.includes('text-')
              ? meta.tone.split(' ').find((c) => c.startsWith('bg-'))
              : 'bg-foreground/45',
          )}
          aria-hidden
        />
        <span
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            meta.tone.split(' ').find((c) => c.startsWith('bg-')) ?? 'bg-foreground/45',
          )}
          aria-hidden
        />
      </span>
      <Icon className="h-3 w-3" aria-hidden />
      <span>{meta.label}</span>
    </span>
  );
}
