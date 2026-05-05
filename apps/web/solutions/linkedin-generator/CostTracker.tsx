'use client';

import { Coins } from 'lucide-react';
import type { CostBreakdown } from './client';

interface Props {
  cost: CostBreakdown | null;
  /** 'studio' (default) shows crew + visual director + image rows.
   *  'scout' shows the single scout row. */
  kind?: 'studio' | 'scout';
}

export default function CostTracker({ cost, kind = 'studio' }: Props) {
  const total = cost?.total_cost_usd ?? 0;
  const heading = kind === 'scout' ? 'Scout run' : 'Crew run';

  const rows: Array<{ label: string; amount: number }> =
    kind === 'scout'
      ? [{ label: 'Scout (LLM)', amount: cost?.scout?.cost_usd ?? 0 }]
      : [
          { label: 'Crew (LLM)', amount: cost?.crew?.cost_usd ?? 0 },
          { label: 'Visual Director', amount: cost?.visual_director?.cost_usd ?? 0 },
          {
            label: `Images${cost?.image?.calls ? ` · ${cost.image.calls}` : ''}`,
            amount: cost?.image?.cost_usd ?? 0,
          },
        ];

  const totalTokens =
    kind === 'scout'
      ? cost?.scout?.total_tokens ?? 0
      : (cost?.crew?.total_tokens ?? 0) + (cost?.visual_director?.total_tokens ?? 0);

  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Coins className="h-3.5 w-3.5" /> {heading}
        </h4>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {fmt(total)}
        </span>
      </div>

      <ul className="space-y-1 text-[11.5px] text-foreground/80">
        {rows.map((r) => (
          <CostRow
            key={r.label}
            label={r.label}
            amount={r.amount}
            share={total ? r.amount / total : 0}
          />
        ))}
      </ul>

      <p className="mt-2 text-[10.5px] text-foreground/55">
        {totalTokens > 0
          ? `${totalTokens.toLocaleString()} tokens billed by provider`
          : 'Awaiting first run.'}
      </p>
    </div>
  );
}

function CostRow({
  label,
  amount,
  share,
}: {
  label: string;
  amount: number;
  share: number;
}) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-32 shrink-0 truncate text-foreground/70">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-400 to-emerald-400 transition-all"
          style={{ width: `${Math.min(share * 100, 100)}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right font-mono tabular-nums">{fmt(amount)}</span>
    </li>
  );
}

function fmt(usd: number): string {
  if (!usd) return '$0.0000';
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}
