'use client';

import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import type { ApprovalItem } from './client';

interface Props {
  item: ApprovalItem;
  onDecide: (decision: 'approve' | 'reject', reason?: string) => Promise<void>;
}

/**
 * Mirrors `agentic_hr/ui/components/approval_card.py`:
 *  - Header: requester name + email, status pill on the right (🟡/🟢/🔴).
 *  - Body: 📦 packages as monospace chips.
 *  - Meta: ID + Created caption.
 *  - Actions: ✅ Approve (primary) / ❌ Deny (with optional reason input).
 */
export default function ApprovalCard({ item, onDecide }: Props) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');

  async function decide(d: 'approve' | 'reject') {
    setBusy(d);
    try {
      await onDecide(d, d === 'reject' ? reason : undefined);
    } finally {
      setBusy(null);
    }
  }

  const args = item.arguments as Record<string, unknown>;
  const requesterName = (args.requester_name as string) || '';
  const requesterEmail = (args.requester_email as string) || 'Unknown';
  const packages = (args.packages as string[]) ?? [];

  return (
    <li className="rounded-lg border border-border bg-background p-3 text-sm">
      {/* Header: requester + status pill */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {requesterName ? (
            <>
              <div className="font-semibold leading-tight">{requesterName}</div>
              <div className="text-xs text-foreground/70">{requesterEmail}</div>
            </>
          ) : (
            <div className="font-semibold">{requesterEmail}</div>
          )}
        </div>
        <StatusPill status={item.status} />
      </div>

      {/* Packages */}
      {(packages.length > 0 || item.tool) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-foreground/70">📦 Packages:</span>
          {(packages.length ? packages : [item.tool]).map((p) => (
            <code
              key={p}
              className="rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]"
            >
              {p}
            </code>
          ))}
        </div>
      )}

      {/* Meta */}
      <div className="mt-1.5 text-xs text-foreground/65">
        <span className="font-medium text-foreground/80">ID:</span>{' '}
        <code className="rounded bg-muted/40 px-1 py-0.5 text-[11px]">{item.id}</code>
        {item.created_at && (
          <>
            {' · '}
            <span className="font-medium text-foreground/80">Created:</span> {item.created_at}
          </>
        )}
      </div>

      {showReason && (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional — visible to the requester)"
          rows={2}
          className="mt-2 min-h-[60px] w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      )}

      {/* Actions — only for pending items */}
      {item.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => decide('approve')}
            disabled={!!busy}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy === 'approve' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Approve
          </button>
          <button
            onClick={() => {
              if (!showReason) {
                setShowReason(true);
                return;
              }
              decide('reject');
            }}
            disabled={!!busy}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            {busy === 'reject' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            {showReason ? 'Reject with reason' : 'Deny'}
          </button>
        </div>
      )}
    </li>
  );
}

function StatusPill({ status }: { status: ApprovalItem['status'] }) {
  const map: Record<ApprovalItem['status'], { dot: string; label: string; cls: string }> = {
    pending: {
      dot: '🟡',
      label: 'Pending Approval',
      cls: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
    },
    approved: {
      dot: '🟢',
      label: 'Approved',
      cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
    },
    rejected: {
      dot: '🔴',
      label: 'Denied',
      cls: 'border-red-500/40 bg-red-500/10 text-red-100',
    },
  };
  const { dot, label, cls } = map[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      <span aria-hidden>{dot}</span>
      {label}
    </span>
  );
}
