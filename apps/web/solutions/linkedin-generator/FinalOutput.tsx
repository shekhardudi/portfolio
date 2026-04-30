'use client';

import { useMemo } from 'react';
import { Download, FileDown, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { checkReadability } from './helpers';
import type { DemoAction, DemoState } from './useDemoState';

interface Props {
  state: DemoState;
  dispatch: React.Dispatch<DemoAction>;
  onReset: () => void;
}

const CHAR_LIMIT = 1000;

export default function FinalOutput({ state, dispatch, onReset }: Props) {
  const charCount = state.post_draft.length;
  const dense = useMemo(() => checkReadability(state.post_draft), [state.post_draft]);

  function downloadMd() {
    const blob = new Blob([state.post_draft], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin-post-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(state.post_draft).catch(() => undefined);
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Finalised post</h4>
        <span
          className={cn(
            'rounded-md border px-2 py-0.5 font-mono text-[11px]',
            charCount > CHAR_LIMIT
              ? 'border-red-500/50 bg-red-500/10 text-red-300'
              : 'border-border text-muted-foreground',
          )}
        >
          {charCount} / {CHAR_LIMIT} chars
        </span>
      </div>

      <textarea
        value={state.post_draft}
        onChange={(e) => dispatch({ type: 'PATCH', payload: { post_draft: e.target.value } })}
        rows={14}
        className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        placeholder="Generated post will appear here…"
      />

      {dense.length > 0 && (
        <details className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm">
          <summary className="cursor-pointer font-medium text-amber-200">
            Readability — {dense.length} dense sentence{dense.length === 1 ? '' : 's'} (&gt; 15 words)
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground/80">
            {dense.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={copyToClipboard}
          disabled={!state.post_draft}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          <FileDown className="h-3.5 w-3.5" /> Copy
        </button>
        <button
          onClick={downloadMd}
          disabled={!state.post_draft}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Download .md
        </button>
        <button
          onClick={onReset}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" /> New post
        </button>
      </div>
    </div>
  );
}
