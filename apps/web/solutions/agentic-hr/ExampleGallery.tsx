'use client';

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
          open
        >
          <summary className="cursor-pointer list-none px-1 py-0.5 text-xs font-semibold text-muted-foreground">
            <span className="mr-1">{cat.icon}</span>
            {cat.category}
          </summary>
          <ul className="mt-1.5 space-y-1">
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
