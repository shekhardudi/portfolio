'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, Check, X } from 'lucide-react';
import {
  chat,
  decideApproval,
  listApprovals,
  type ApprovalItem,
  type ChatResponse,
} from './client';
import { ApiError } from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: ChatResponse['tool_calls'];
}

export default function Demo() {
  const [sessionId] = useState(() => `demo-${crypto.randomUUID().slice(0, 8)}`);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hi — I'm the agentic HR assistant. Try: \"How much PTO do I have?\" or \"Submit a request for 3 days off next week\". Destructive actions need approval (see panel →).",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function refreshApprovals() {
    try {
      setApprovals(await listApprovals(sessionId));
    } catch {
      /* swallow — backend may be cold */
    }
  }

  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    setError(null);
    try {
      const res = await chat({ session_id: sessionId, message: text });
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.reply, tool_calls: res.tool_calls },
      ]);
      if (res.pending_approvals?.length) {
        setApprovals((a) => [...res.pending_approvals!, ...a]);
      } else {
        refreshApprovals();
      }
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(item: ApprovalItem, decision: 'approve' | 'reject') {
    try {
      await decideApproval({ id: item.id, decision });
      setApprovals((a) => a.filter((x) => x.id !== item.id));
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: `(human ${decision}d \`${item.tool}\`)`,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* Chat */}
      <div className="flex h-[520px] flex-col rounded-xl border border-border bg-muted/20">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'ml-auto bg-foreground text-background'
                  : 'bg-background border border-border'
              }`}
            >
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.tool_calls?.length ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  tools: {m.tool_calls.map((t) => t.name).join(', ')}
                </div>
              ) : null}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> thinking…
            </div>
          )}
        </div>
        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the HR assistant…"
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        </form>
      </div>

      {/* Approvals */}
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold">Pending approvals</h4>
          <button
            onClick={refreshApprovals}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            refresh
          </button>
        </div>
        {approvals.length === 0 ? (
          <p className="text-xs text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {approvals.map((a) => (
              <li
                key={a.id}
                className="rounded-md border border-border bg-background p-2 text-xs"
              >
                <div className="font-medium">{a.tool}</div>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
                  {JSON.stringify(a.arguments, null, 2)}
                </pre>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => decide(a, 'approve')}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-white"
                  >
                    <Check className="h-3 w-3" /> approve
                  </button>
                  <button
                    onClick={() => decide(a, 'reject')}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1"
                  >
                    <X className="h-3 w-3" /> reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[10px] text-muted-foreground">session: {sessionId}</p>
      </div>
    </div>
  );
}
