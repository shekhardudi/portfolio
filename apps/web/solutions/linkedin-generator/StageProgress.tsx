'use client';

import { Check, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PostStage } from './client';

interface Props {
  stage: PostStage;
  /** Total elapsed seconds since the run kicked off. */
  elapsedSec: number;
  /** True until the run reaches a terminal state. */
  active: boolean;
}

const PIPELINE: { key: PostStage; label: string; sub: string }[] = [
  { key: 'research',        label: 'Researcher',     sub: 'gather facts + sources' },
  { key: 'writing',         label: 'Writer',         sub: 'draft the post' },
  { key: 'critique',        label: 'Critic',         sub: 'line-edit + score' },
  { key: 'visual_director', label: 'Visual Director',sub: 'plan cover image' },
];

const ORDER: PostStage[] = ['queued', 'research', 'writing', 'critique', 'visual_director'];

export default function StageProgress({ stage, elapsedSec, active }: Props) {
  const currentIdx = ORDER.indexOf(stage);
  const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
  const secs = Math.floor(elapsedSec % 60).toString().padStart(2, '0');

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground/95">
          {active ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/70" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          )}
          {active ? 'Crew running' : 'Crew complete'}
        </div>
        <div className="font-mono text-[12px] tabular-nums text-foreground/70">
          {mins}:{secs}
        </div>
      </div>

      <ol className="grid grid-cols-1 gap-1 sm:grid-cols-4">
        {PIPELINE.map((p, i) => {
          const order = ORDER.indexOf(p.key);
          const status: 'done' | 'active' | 'pending' =
            !active && currentIdx >= 0
              ? 'done'
              : order < currentIdx
                ? 'done'
                : order === currentIdx
                  ? 'active'
                  : 'pending';

          return (
            <li
              key={p.key}
              className={cn(
                'relative flex items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors',
                status === 'done' && 'border-emerald-500/30 bg-emerald-500/[0.06]',
                status === 'active' && 'border-foreground/40 bg-background shadow-sm',
                status === 'pending' && 'border-border/60 bg-background/40 opacity-70',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  status === 'done' && 'bg-emerald-500/20 text-emerald-300',
                  status === 'active' && 'bg-foreground text-background',
                  status === 'pending' && 'bg-muted text-foreground/55',
                )}
                aria-hidden
              >
                {status === 'done' ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    'text-[12.5px] font-semibold leading-tight',
                    status === 'pending' ? 'text-foreground/65' : 'text-foreground',
                  )}
                >
                  {p.label}
                  {status === 'active' && (
                    <span className="ml-1 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/80 align-middle" />
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-foreground/60">{p.sub}</div>
              </div>
              {i < PIPELINE.length - 1 && (
                <ChevronRight
                  className="absolute -right-2 top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 text-foreground/25 sm:block"
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
