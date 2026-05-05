'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Citation, ChatStatus } from './client';
import { AssistantAvatar, UserAvatar } from './Avatars';

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

export default function MessageBubble({
  message,
  userName,
}: {
  message: ChatMessage;
  userName?: string;
}) {
  const isUser = message.role === 'user';
  return (
    <div
      className={cn(
        'flex w-full items-start gap-3',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {!isUser && <AssistantAvatar size="md" />}
      <div
        className={cn(
          'max-w-[90%] rounded-2xl px-4 py-3 text-[15px] shadow-sm xl:max-w-[84%]',
          isUser
            ? 'rounded-br-md bg-foreground text-background'
            : 'rounded-bl-md border border-border bg-background',
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap leading-7 text-background/95">{message.content}</div>
        ) : (
          <div className="space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
              Agentic HR
            </div>
            <div className="max-w-none text-[15px]">
              <MarkdownBody content={message.content} />
            </div>
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
      {isUser && <UserAvatar name={userName} size="md" />}
    </div>
  );
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="my-2.5 leading-7 text-foreground/90">{children}</p>,
  ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1.5 pl-5 text-foreground/90">{children}</ul>,
  ol: ({ children }) => <ol className="my-2.5 list-decimal space-y-1.5 pl-5 text-foreground/90">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  h1: ({ children }) => <h1 className="mt-3 text-lg font-semibold text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 text-base font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 text-sm font-semibold text-foreground">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 rounded-r-md border-l-2 border-foreground/25 bg-muted/40 px-3 py-2 text-foreground/85">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-muted/50 p-2 text-[12px] leading-relaxed text-foreground/90">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground/95">{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted/40 px-2 py-1 text-left font-semibold text-foreground/90">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 text-foreground/85">{children}</td>
  ),
};

function MarkdownBody({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}

// ── Citations ───────────────────────────────────────────────────────────────

function CitationsExpander({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-xs font-medium text-foreground/85 hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          Policy References ({citations.length})
        </span>
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul className="space-y-2 border-t border-border px-2.5 py-2 text-xs text-foreground/75">
          {citations.map((c, i) => (
            <li key={i} className="rounded-md border border-border bg-background/80 px-2 py-1.5">
              <div className="font-semibold text-foreground/95">{c.document}</div>
              {c.section ? (
                <div className="mt-0.5 text-[11px] text-foreground/70">Section: {c.section}</div>
              ) : null}
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
      <div className="mt-3 flex items-start gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 text-xs text-blue-700 dark:text-blue-200">
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
      <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>Clarification needed</span>
      </div>
    );
  }
  return null;
}
