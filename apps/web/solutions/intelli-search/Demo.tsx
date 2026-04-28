'use client';

import { useState, useTransition } from 'react';
import { Loader2, Search } from 'lucide-react';
import { searchIntelligent, type SearchHit, type SearchMode } from './client';
import { ApiError } from '@/lib/api';

const MODES: SearchMode[] = ['auto', 'regular', 'semantic', 'agentic'];

export default function Demo() {
  const [query, setQuery] = useState('senior ML engineers in Bangalore with vector-search experience');
  const [mode, setMode] = useState<SearchMode>('auto');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [meta, setMeta] = useState<{ duration_ms?: number; intent?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await searchIntelligent({ query, mode, size: 10 });
        setHits(res.hits);
        setMeta({ duration_ms: res.duration_ms, intent: res.classifier_intent });
      } catch (e) {
        setHits([]);
        setError(
          e instanceof ApiError
            ? `${e.status} — ${e.body || e.message}`
            : (e as Error).message,
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try a natural-language query…"
            className="h-11 w-full bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as SearchMode)}
          className="rounded-lg border border-border bg-muted/40 px-3 text-sm"
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
        </button>
      </form>

      {meta.duration_ms !== undefined && (
        <div className="text-xs text-muted-foreground">
          {hits.length} results · {meta.duration_ms}ms
          {meta.intent ? ` · intent=${meta.intent}` : ''}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {hits.length === 0 && !pending && !error && (
          <li className="p-6 text-center text-sm text-muted-foreground">
            Run a query to see results.
          </li>
        )}
        {hits.map((h) => (
          <li key={h.id} className="space-y-1 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="font-medium">{h.title ?? h.id}</h4>
              <span className="text-xs text-muted-foreground">{h.score.toFixed(3)}</span>
            </div>
            {(h.company || h.location) && (
              <div className="text-xs text-muted-foreground">
                {[h.company, h.location].filter(Boolean).join(' · ')}
              </div>
            )}
            {h.summary && <p className="text-sm text-muted-foreground">{h.summary}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
