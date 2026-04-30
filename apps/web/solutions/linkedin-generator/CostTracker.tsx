'use client';

import { Coins } from 'lucide-react';
import type { CostUsage } from './useDemoState';

export default function CostTracker({ cost }: { cost: CostUsage }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Coins className="h-3.5 w-3.5" /> Estimated cost
      </h4>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Input" value={cost.input_tokens.toLocaleString()} suffix="tok" />
        <Metric label="Output" value={cost.output_tokens.toLocaleString()} suffix="tok" />
        <Metric label="USD" value={`$${cost.usd.toFixed(4)}`} />
      </div>
      <p className="mt-2.5 text-xs text-foreground/65">
        Client-side estimate using GPT-4o list pricing. Real billing may differ.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background px-2 py-1.5 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/65">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base font-semibold leading-tight text-foreground">
        {value}
      </div>
      {suffix ? (
        <div className="text-[10px] text-foreground/55">{suffix}</div>
      ) : null}
    </div>
  );
}
