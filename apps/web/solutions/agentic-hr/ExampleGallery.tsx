'use client';

import { ChevronRight } from 'lucide-react';
import { EXAMPLE_QUERIES } from './examples';

interface Props {
  onPick: (q: string) => void;
}

export default function ExampleGallery({ onPick }: Props) {
  return (
    <div className="space-y-3">
      {EXAMPLE_QUERIES.map((cat) => (
        <details
          key={cat.category}
          className="group rounded-lg border border-border bg-muted/20 p-2 open:bg-muted/30"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-1 py-1 text-xs font-semibold text-foreground/85">
            <span className="inline-flex items-center gap-1.5">
              <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" />
              <span>{cat.icon}</span>
              <span>{cat.category}</span>
            </span>
            <span className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground/70">
              {cat.queries.length}
            </span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {cat.queries.map((q) => (
              <li key={q}>
                <button
                  onClick={() => onPick(q)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs hover:border-foreground/40 hover:bg-muted"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
