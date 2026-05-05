'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clipboard,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { checkReadability } from './helpers';
import { updatePost } from './client';
import type { DemoAction, DemoState } from './useDemoState';

interface Props {
  state: DemoState;
  dispatch: React.Dispatch<DemoAction>;
  onReset: () => void;
}

const CHAR_LIMIT = 1200;

export default function FinalOutput({ state, dispatch, onReset }: Props) {
  const [draft, setDraft] = useState(state.post_draft);
  const [lastSeenServerDraft, setLastSeenServerDraft] = useState(state.post_draft);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dirtyTimer = useRef<number | null>(null);

  // Re-sync local edits whenever the server-side draft changes (e.g. a fresh
  // crew run replaces it). React 19 idiom: do it during render via a state
  // sentinel rather than a useEffect that triggers an extra render.
  if (state.post_draft !== lastSeenServerDraft) {
    setDraft(state.post_draft);
    setLastSeenServerDraft(state.post_draft);
    setSavedAt(null);
    setSaveError(null);
  }

  const charCount = draft.length;
  const overLimit = charCount > CHAR_LIMIT;
  const dense = useMemo(() => checkReadability(draft), [draft]);
  const dirty = draft !== state.post_draft;

  function update(next: string) {
    setDraft(next);
    setSavedAt(null);
    setSaveError(null);
    if (dirtyTimer.current) window.clearTimeout(dirtyTimer.current);
  }

  async function save() {
    if (!state.current_job_id || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updatePost(state.current_job_id, draft);
      dispatch({ type: 'PATCH', payload: { post_draft: draft } });
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function downloadMd() {
    const blob = new Blob([draft], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin-post-${state.run_id || Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  if (!state.crew_done && !state.post_draft) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
        <p className="text-sm font-semibold text-foreground/85">No post yet</p>
        <p className="mt-1 text-xs text-foreground/60">
          Run the LinkedIn Crew in the Studio tab to generate a draft here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">Finalised post</h4>
        {state.run_id && (
          <code className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/65">
            {state.run_id}
          </code>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'rounded-md border px-2 py-0.5 font-mono text-[11px]',
              overLimit
                ? 'border-red-500/50 bg-red-500/10 text-red-300'
                : 'border-border text-foreground/70',
            )}
          >
            {charCount} / {CHAR_LIMIT}
          </span>
          {dirty && !saving && (
            <span className="text-[11px] italic text-foreground/65">unsaved</span>
          )}
          {savedAt && !dirty && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
              <Check className="h-3 w-3" /> saved
            </span>
          )}
        </div>
      </div>

      <textarea
        value={draft}
        onChange={(e) => update(e.target.value)}
        rows={16}
        className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-ring"
        placeholder="Generated post will appear here…"
      />

      {dense.length > 0 && (
        <details className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm">
          <summary className="cursor-pointer font-medium text-amber-200">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
            Readability — {dense.length} dense sentence{dense.length === 1 ? '' : 's'} (&gt; 15 words)
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground/80">
            {dense.map((s, i) => (
              <li key={i} className="text-[12.5px]">{s}</li>
            ))}
          </ul>
        </details>
      )}

      {saveError && (
        <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
          {saveError}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving || !state.current_job_id}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50',
            dirty
              ? 'bg-foreground text-background hover:bg-foreground/90'
              : 'border border-border text-foreground/70',
          )}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save edits
        </button>
        <button
          onClick={copy}
          disabled={!draft}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Clipboard className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={downloadMd}
          disabled={!draft}
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
