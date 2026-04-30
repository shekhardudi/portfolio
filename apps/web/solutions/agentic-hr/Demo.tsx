'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, RefreshCw, Send } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api';
import {
  chat,
  decideApproval,
  listApprovals,
  type ApprovalItem,
} from './client';
import {
  PERSONAS,
  MANAGERS,
  DEFAULT_EMPLOYEE,
  DEFAULT_MANAGER,
  type Persona,
} from './personas';
import PersonaSelector from './PersonaSelector';
import MessageBubble, { type ChatMessage } from './MessageBubble';
import ExampleGallery from './ExampleGallery';
import ApprovalCard from './ApprovalCard';
import GuidePanel from './GuidePanel';
import Integrations from './IntegrationsPanel';

function newSessionId() {
  return `demo-${crypto.randomUUID().slice(0, 8)}`;
}

export default function Demo() {
  const [innerTab, setInnerTab] = useState<'chat' | 'approvals' | 'integrations'>('chat');

  // ── Chat state ──
  const [employee, setEmployee] = useState<Persona>(DEFAULT_EMPLOYEE);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => welcomeMessages());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Mirrors the original Streamlit `📖 Guide` toggle. Default open. */
  const [showGuide, setShowGuide] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Approvals state ──
  const [manager, setManager] = useState<Persona>(DEFAULT_MANAGER);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const { show: toast } = useToast();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // Reset chat when persona changes
  function changeEmployee(p: Persona) {
    setEmployee(p);
    setSessionId(newSessionId());
    setMessages(welcomeMessages(p));
    setError(null);
  }

  function newConversation() {
    setSessionId(newSessionId());
    setMessages(welcomeMessages(employee));
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    setError(null);
    try {
      const res = await chat({
        session_id: sessionId,
        message: text,
        employee_email: employee.email,
      });
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.reply,
          tool_calls: res.tool_calls,
          citations: res.citations,
          status: res.status,
          request_id: res.request_id,
        },
      ]);
      // Pending approvals may have been created — refresh list quietly.
      refreshApprovals();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ── Approvals: refresh + polling ──
  const refreshApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const list = await listApprovals();
      setApprovals(list);
    } catch {
      /* swallow — backend may be cold */
    } finally {
      setApprovalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (innerTab !== 'approvals') return;
    refreshApprovals();
    const iv = window.setInterval(refreshApprovals, 10_000);
    return () => window.clearInterval(iv);
  }, [innerTab, refreshApprovals]);

  async function decide(item: ApprovalItem, decision: 'approve' | 'reject', reason?: string) {
    // Optimistic remove
    setApprovals((a) => a.filter((x) => x.id !== item.id));
    try {
      await decideApproval({ id: item.id, decision, reason }, manager.email);
      toast({
        variant: 'success',
        title: decision === 'approve' ? 'Approved' : 'Rejected',
        description: `${item.id} · ${manager.full_name}`,
      });
    } catch (e) {
      // Rollback on failure
      setApprovals((a) => [item, ...a]);
      toast({
        variant: 'destructive',
        title: 'Decision failed',
        description: (e as Error).message,
      });
    }
  }

  return (
    <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as typeof innerTab)}>
      <TabsList>
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="approvals">Approvals</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
      </TabsList>

      {/* ───── Chat ───── */}
      <TabsContent value="chat">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-2">
            <PersonaSelector
              personas={PERSONAS}
              value={employee.email}
              onChange={changeEmployee}
            />
            <button
              onClick={newConversation}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" /> New conversation
            </button>
            <button
              onClick={() => setShowGuide((v) => !v)}
              aria-pressed={showGuide}
              className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition ${
                showGuide
                  ? 'border-foreground/40 bg-foreground/10 text-foreground'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              {showGuide ? 'Hide guide' : 'Show guide'}
            </button>
          </div>

          <div
            className={`grid gap-4 ${
              showGuide
                ? 'lg:grid-cols-[1fr_320px_320px]'
                : 'lg:grid-cols-[1fr_320px]'
            }`}
          >
            <div className="flex h-[520px] flex-col rounded-xl border border-border bg-muted/40">
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((m, i) => (
                  <MessageBubble key={i} message={m} />
                ))}
                {busy && (
                  <div className="flex items-center gap-2 text-sm text-foreground/70">
                    <Loader2 className="h-4 w-4 animate-spin" /> thinking…
                  </div>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="border-t border-border p-3"
              >
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={`Ask as ${employee.full_name}…`}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
                {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
              </form>
            </div>

            {/* Examples sidebar */}
            <aside className="rounded-xl border border-border bg-muted/40 p-3">
              <h4 className="mb-2 text-sm font-semibold text-foreground">
                Try one of these
              </h4>
              <ExampleGallery onPick={(q) => send(q)} />
            </aside>

            {/* Inline guide rail — mirrors the original Streamlit toggle */}
            <GuidePanel open={showGuide} onClose={() => setShowGuide(false)} />
          </div>
        </div>
      </TabsContent>

      {/* ───── Approvals ───── */}
      <TabsContent value="approvals">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-2">
            <PersonaSelector
              personas={MANAGERS}
              value={manager.email}
              onChange={setManager}
              label="Acting manager"
            />
            <button
              onClick={refreshApprovals}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              {approvalsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh now
            </button>
            <span className="ml-auto text-xs text-foreground/65">
              auto-refresh every 10s
            </span>
          </div>

          {approvals.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-foreground/75">
              No pending requests. Try asking the assistant for software access in the Chat tab.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {approvals.map((a) => (
                <ApprovalCard
                  key={a.id}
                  item={a}
                  onDecide={(d, reason) => decide(a, d, reason)}
                />
              ))}
            </ul>
          )}
        </div>
      </TabsContent>

      {/* ───── Integrations ───── */}
      <TabsContent value="integrations">
        <Integrations />
      </TabsContent>
    </Tabs>
  );
}

function welcomeMessages(p?: Persona): ChatMessage[] {
  const name = p?.full_name ?? DEFAULT_EMPLOYEE.full_name;
  return [
    {
      role: 'assistant',
      content: `Hi **${name}** — I'm the agentic HR assistant. Try:\n\n- *"How much PTO do I have?"*\n- *"I need access to Gitea"*\n- *"What is the travel reimbursement limit?"*\n\nDestructive actions (provisioning, leave applications) need manager approval — switch to the **Approvals** tab to act on them.`,
    },
  ];
}
