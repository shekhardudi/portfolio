'use client';

import * as React from 'react';
import { Activity, RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useToast } from './ui/toaster';
import {
  useJobRegistry,
  useSiteSession,
} from '@/lib/session/SessionProvider';
import { cn } from '@/lib/utils';

/**
 * Floating session widget pinned to the bottom-right of the viewport.
 *
 * Rendered out of the normal document flow (instead of in the navbar) so
 * it stays visible while you scroll through long demo output, but doesn't
 * compete with the brand / nav for space at the top of every page.
 *
 * The pill is **dimmed and compact when idle** (a single dot — no label,
 * no chrome) and **lights up** when at least one job is in flight, with a
 * count badge. Click anywhere on the pill to open a single destructive
 * action — "Reset all demos" — which cancels in-flight jobs across every
 * solution, resets each demo to its initial state, and clears any saved
 * drafts/briefings/images. One button, no choices to make.
 */
export function SessionPill() {
  const { count } = useJobRegistry();
  const { resetAll, clearAllDrafts } = useSiteSession();
  const { show: toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const active = count > 0;

  function onResetEverything() {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        'Reset all demos?\n\nThis will cancel any running jobs, return every '
          + 'demo to its initial state, and clear all saved drafts, briefings, '
          + 'and generated images.',
      );
      if (!ok) return;
    }
    // Cancel jobs + bump session versions across every solution first so
    // any in-flight poll loops drop their next tick. Then wipe localStorage
    // drafts. clearAllDrafts() reloads the page, which also remounts every
    // demo at its INITIAL state — that's what completes the "reset to
    // initial state" half of the contract.
    resetAll();
    setOpen(false);
    toast({
      title: 'Resetting all demos',
      description: 'Cancelling in-flight jobs and clearing saved data…',
    });
    clearAllDrafts();
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 sm:bottom-6 sm:right-6">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              active
                ? `Session menu — ${count} ${count === 1 ? 'job' : 'jobs'} running`
                : 'Session menu'
            }
            // touch-manipulation removes the 300ms tap delay on iOS so the
            // popover opens crisply on first tap instead of feeling unresponsive.
            // Idle padding bumped to p-3 so the trigger meets the 44pt mobile
            // tap-target minimum even when only the icon is shown.
            style={{ touchAction: 'manipulation' }}
            className={cn(
              'pointer-events-auto inline-flex items-center gap-1.5 rounded-full border shadow-md backdrop-blur transition',
              active
                ? 'border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25'
                : 'border-foreground/25 bg-background/95 p-3 text-foreground/80 ring-1 ring-foreground/10 hover:border-foreground/50 hover:bg-muted hover:text-foreground',
            )}
          >
            {active ? (
              <>
                <span
                  className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
                  aria-hidden
                />
                <span>Session active</span>
                <span
                  className="rounded-full bg-emerald-500/25 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-emerald-100"
                  title={`${count} ${count === 1 ? 'job' : 'jobs'} running`}
                >
                  {count}
                </span>
              </>
            ) : (
              <Activity className="h-4 w-4" aria-hidden />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          // collisionPadding keeps the popover off the viewport edges on
          // narrow phones; sideOffset gives a touch of breathing room above
          // the trigger so it doesn't feel cramped against the thumb.
          collisionPadding={12}
          sideOffset={8}
          className="w-64 max-w-[calc(100vw-1.5rem)] p-2"
        >
          <div className="px-1 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/55">
            Session
          </div>
          <button
            type="button"
            onClick={onResetEverything}
            // Bigger tap target (py-3, h-4 icon) and explicit
            // touch-manipulation so a single tap on iOS opens the confirm
            // immediately instead of being eaten by the synthetic-hover
            // double-tap chain that older mobile Safari applies to
            // hover-styled buttons.
            style={{ touchAction: 'manipulation' }}
            className="flex w-full items-start gap-2.5 rounded-md px-2 py-3 text-left text-sm text-foreground transition active:bg-red-500/15 hover:bg-red-500/10"
          >
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span className="min-w-0">
              <span className="block font-medium">Reset all demos</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-foreground/65">
                Cancels in-flight jobs, returns every demo to its initial
                state, and clears saved drafts, briefings, and images.
              </span>
            </span>
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
