'use client';

import { useEffect, useState } from 'react';
import { History as HistoryIcon, Loader2, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { listHistory, type HistoryRow } from './client';

export default function HistoryPanel() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchRows() {
    setLoading(true);
    setError(null);
    try {
      const list = await listHistory(50);
      setRows(list);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRows();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="inline-flex items-center gap-2 text-sm font-semibold">
          <HistoryIcon className="h-4 w-4" /> Run history
        </h4>
        <button
          onClick={fetchRows}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {!error && rows.length === 0 && !loading && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-foreground/65">
          No runs recorded yet — generate a post to populate history.
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.run_id}
            className="rounded-xl border border-border bg-muted/20 p-3 text-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-foreground/95">
                  {r.topic || 'untitled'}
                </div>
                <div className="text-[11px] text-foreground/55">
                  <code className="font-mono text-foreground/65">{r.run_id}</code>
                  {' · '}
                  {fmtDate(r.created_at)}
                  {' · '}
                  <span>{r.audience}</span>
                </div>
              </div>
              {r.cost_breakdown?.total_cost_usd !== undefined && (
                <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px]">
                  ${r.cost_breakdown.total_cost_usd.toFixed(4)}
                </span>
              )}
            </div>

            {r.leader_angle && (
              <p className="mt-1 text-[12.5px] italic text-foreground/70">
                &ldquo;{r.leader_angle}&rdquo;
              </p>
            )}

            {r.image_paths.length > 0 && (
              <div className="mt-2 flex gap-1.5">
                {r.image_paths.slice(0, 4).map((p) => (
                  <span
                    key={p}
                    className="rounded-full border border-border bg-background px-2 py-0.5 text-[10.5px] font-mono text-foreground/65"
                  >
                    {p.split('/').pop()}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso.slice(0, 19).replace('T', ' ');
  }
}
