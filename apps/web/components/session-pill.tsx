'use client';

import * as React from 'react';
import { Activity, RotateCcw } from 'lucide-react';
import { useToast } from './ui/toaster';
import {
  useJobRegistry,
  useSiteSession,
} from '@/lib/session/SessionProvider';
import { cn } from '@/lib/utils';

/**
 * Floating session widget pinned to the bottom-right of the viewport.
 *
 * Tap the pill → opens a small menu with one action: "Reset all demos".
 * The menu uses a hand-rolled popover (absolute-positioned panel +
 * full-viewport backdrop) instead of Radix Popover because Radix's
 * portal-based outside-click handling raced the inner button's tap on
 * mobile Safari and dismissed the menu before the click registered.
 * The hand-rolled version uses plain click events on a backdrop sibling
 * to dismiss, which behaves the same on web and mobile.
 *
 * The pill is **dimmed and compact when idle** (just an Activity icon)
 * and **lights up** when at least one job is in flight, with a count
 * badge.
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
      if (!ok) {
        setOpen(false);
        return;
      }
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
    <>
      {/* Backdrop — captures taps anywhere outside the menu and dismisses.
          Sibling of the pill so its z-index sits BETWEEN the page content
          and the menu, letting touch events pass through to nothing else
          while the menu is open. Plain onClick works the same on web and
          mobile, unlike Radix's PointerDown-based outside-click. */}
      {open && (
        <div
          aria-hidden
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
        <div className="relative">
          {/* Menu — anchored to the trigger, opens upward. Visible only
              when `open`. Width caps at the viewport so very narrow phones
              don't see horizontal overflow. */}
          {open && (
            <div
              role="menu"
              aria-label="Session"
              className="pointer-events-auto absolute bottom-full right-0 mb-2 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background p-2 shadow-md"
            >
              <div className="px-1 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/55">
                Session
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={onResetEverything}
                // touch-manipulation removes the 300ms iOS tap delay; py-3
                // keeps the row well above the 44pt mobile tap-target floor.
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
            </div>
          )}

          {/* Trigger — the floating pill. */}
          <button
            type="button"
            aria-label={
              active
                ? `Session menu — ${count} ${count === 1 ? 'job' : 'jobs'} running`
                : 'Session menu'
            }
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((v) => !v)}
            style={{ touchAction: 'manipulation' }}
            className={cn(
              'pointer-events-auto inline-flex items-center gap-1.5 rounded-full border shadow-md backdrop-blur transition active:scale-[0.97]',
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
        </div>
      </div>
    </>
  );
}
