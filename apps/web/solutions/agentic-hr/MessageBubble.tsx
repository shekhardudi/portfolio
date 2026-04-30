'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Citation, ChatStatus } from './client';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: { name: string; arguments: unknown }[];
  /** Policy citations returned by the backend for this turn. */
  citations?: Citation[];
  /** `pending_approval` | `needs_clarification` | `complete`. */
  status?: ChatStatus;
  /** AR-* identifier when the turn produced a provisioning request. */
  request_id?: string | null;
}

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-foreground text-background'
            : 'border border-border bg-background',
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="prose prose-invert max-w-none text-sm prose-p:my-1 prose-li:my-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}

        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationsExpander citations={message.citations} />
        )}

        {!isUser && message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.tool_calls.map((t, i) => (
              <span
                key={i}
                className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-xs font-medium text-foreground/80"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}

        {!isUser && message.status && (
          <StatusBadge status={message.status} requestId={message.request_id ?? undefined} />
        )}
      </div>
    </div>
  );
}

// ── Citations ───────────────────────────────────────────────────────────────

function CitationsExpander({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-xs font-medium text-foreground/85 hover:text-foreground"
      >
        <span>Sources ({citations.length})</span>
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul className="space-y-1 border-t border-border px-2 py-1.5 text-xs text-foreground/75">
          {citations.map((c, i) => (
            <li key={i}>
              <span className="font-semibold text-foreground/90">{c.document}</span>
              {c.section ? <span> — {c.section}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status, requestId }: { status: ChatStatus; requestId?: string }) {
  if (status === 'complete') return null;
  if (status === 'pending_approval') {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 text-xs text-blue-100">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Awaiting manager approval
          {requestId && (
            <>
              {' '}(Request{' '}
              <code className="rounded bg-background/60 px-1 py-0.5 text-[11px]">
                {requestId}
              </code>
              )
            </>
          )}
        </span>
      </div>
    );
  }
  if (status === 'needs_clarification') {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>Clarification needed</span>
      </div>
    );
  }
  return null;
}
