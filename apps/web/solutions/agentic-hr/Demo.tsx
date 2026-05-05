'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, Loader2, RefreshCw, Send, Sparkles } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toaster';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
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
import { AssistantAvatar, UserAvatar } from './Avatars';
import { INTEGRATIONS } from './integrations';
import { TIPS } from './guide';

function newSessionId() {
  return `demo-${crypto.randomUUID().slice(0, 8)}`;
}

export default function Demo() {
  const [innerTab, setInnerTab] = useState<'chat' | 'approvals'>('chat');

  // ── Chat state ──
  const [employee, setEmployee] = useState<Persona>(DEFAULT_EMPLOYEE);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => welcomeMessages());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuideDock, setShowGuideDock] = useState(true);
  const [guideTab, setGuideTab] = useState<'examples' | 'tips'>('examples');
  const [guideTabTouched, setGuideTabTouched] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Approvals state ──
  const [manager, setManager] = useState<Persona>(DEFAULT_MANAGER);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const { show: toast } = useToast();
  const pendingApprovalCount = approvals.filter((a) => a.status === 'pending').length;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // Reset chat when persona changes
  function changeEmployee(p: Persona) {
    setEmployee(p);
    setSessionId(newSessionId());
    setMessages(welcomeMessages(p));
    setGuideTab('examples');
    setGuideTabTouched(false);
    setError(null);
  }

  function newConversation() {
    setSessionId(newSessionId());
    setMessages(welcomeMessages(employee));
    setGuideTab('examples');
    setGuideTabTouched(false);
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
    refreshApprovals();
    const intervalMs = innerTab === 'approvals' ? 10_000 : 20_000;
    const iv = window.setInterval(refreshApprovals, intervalMs);
    return () => window.clearInterval(iv);
  }, [innerTab, refreshApprovals]);

  // Context-aware right panel defaults:
  // - Start with quick examples.
  // - After first full assistant response, nudge to tips.
  // - Stop auto-switching once the user manually picks a tab.
  useEffect(() => {
    if (!showGuideDock || guideTabTouched) return;

    const userTurns = messages.filter((m) => m.role === 'user').length;
    if (userTurns === 0) {
      if (guideTab !== 'examples') setGuideTab('examples');
      return;
    }

    const hasAssistantReplyAfterUser = messages.slice(1).some((m) => m.role === 'assistant');
    if (hasAssistantReplyAfterUser && guideTab !== 'tips') {
      setGuideTab('tips');
    }
  }, [guideTab, guideTabTouched, messages, showGuideDock]);

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
    <Tabs
      value={innerTab}
      onValueChange={(v) => setInnerTab(v as typeof innerTab)}
      className="w-full"
    >
      <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
        <TabsList className="mb-0">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="approvals">
            <span className="inline-flex items-center gap-1.5">
              Approvals
              {pendingApprovalCount > 0 && (
                <>
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    {pendingApprovalCount}
                  </span>
                </>
              )}
            </span>
          </TabsTrigger>
        </TabsList>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[10px] italic text-foreground/55">
            click a chip to see live integration
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {INTEGRATIONS.map((tool) => (
              <a
                key={tool.name}
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-xs font-medium text-foreground/85 transition hover:border-foreground/35 hover:bg-muted/60"
                title={tool.description}
              >
                <span className="text-base leading-none" aria-hidden>
                  {tool.icon}
                </span>
                <span className="text-foreground/95">{tool.name}</span>
                <span
                  className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"
                  aria-hidden
                />
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ───── Chat ───── */}
      <TabsContent value="chat">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
            <PersonaSelector
              personas={PERSONAS}
              value={employee.email}
              onChange={changeEmployee}
            />
            <button
              onClick={newConversation}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground/85 hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" /> New conversation
            </button>
            <button
              onClick={() => setShowGuideDock((v) => !v)}
              aria-pressed={showGuideDock}
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition',
                showGuideDock
                  ? 'border-foreground/40 bg-foreground/[0.08] text-foreground'
                  : 'border-border bg-background/60 text-foreground/80 hover:bg-muted',
              )}
            >
              <BookOpen className="h-3.5 w-3.5" />
              {showGuideDock ? 'Hide' : 'Show'}
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  showGuideDock && 'rotate-180',
                )}
              />
            </button>
          </div>

          <div
            className={cn(
              'grid gap-5',
              showGuideDock
                ? 'lg:grid-cols-[minmax(0,1fr)_340px]'
                : 'grid-cols-1',
            )}
          >
            <div className="min-w-0 space-y-4">
              <div className="flex h-[640px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-muted/35 shadow-sm">
                <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
                  {messages.map((m, i) => (
                    <MessageBubble key={i} message={m} userName={employee.full_name} />
                  ))}
                  {busy && (
                    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground/80">
                      <AssistantAvatar size="sm" />
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Thinking through policy and tools…
                    </div>
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                  className="border-t border-border bg-background/60 p-4 backdrop-blur"
                >
                  <div className="flex items-end gap-3">
                    <UserAvatar name={employee.full_name} size="md" />
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={`Ask as ${employee.full_name}…`}
                      className="flex-1 rounded-xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      disabled={busy || !input.trim()}
                      className="inline-flex items-center gap-1 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                  {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
                </form>
              </div>
            </div>

            {showGuideDock && (
              <aside className="order-3 overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm lg:col-span-2 xl:col-span-1 xl:h-[640px] xl:sticky xl:top-20">
                <Tabs
                  value={guideTab}
                  onValueChange={(v) => {
                    setGuideTab(v as 'examples' | 'tips');
                    setGuideTabTouched(true);
                  }}
                  className="flex h-full flex-col"
                >
                  <header className="flex items-center justify-between border-b border-border bg-background/70 px-3 py-2">
                    <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground/90">
                      <BookOpen className="h-4 w-4" />
                      Guide & Tips
                    </div>
                  </header>
                  <div className="p-3 pb-0">
                    <TabsList className="grid h-auto w-full grid-cols-2 bg-background/60">
                      <TabsTrigger value="examples" className="text-xs">
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        Try
                      </TabsTrigger>
                      <TabsTrigger value="tips" className="text-xs">
                        Tips
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3">
                    <TabsContent value="examples" className="m-0 rounded-xl border border-border bg-background/75 p-3.5">
                      <ExampleGallery onPick={(q) => send(q)} />
                    </TabsContent>

                    <TabsContent value="tips" className="m-0 rounded-xl border border-border bg-background/75 p-3.5">
                      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/60">
                        Operator Tips
                      </h4>
                      <ul className="space-y-3">
                        {TIPS.map((t) => (
                          <li
                            key={t.title}
                            className="rounded-lg border border-border bg-muted/30 p-3"
                          >
                            <div className="text-[13px] font-semibold text-foreground/95">
                              {t.title}
                            </div>
                            <p className="mt-1.5 text-[13px] leading-6 text-foreground/80">
                              {t.body}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </TabsContent>
                  </div>
                </Tabs>
              </aside>
            )}
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
    </Tabs>
  );
}

function welcomeMessages(p?: Persona): ChatMessage[] {
  const name = p?.full_name ?? DEFAULT_EMPLOYEE.full_name;
  return [
    {
      role: 'assistant',
      content: `Hi **${name}** — I'm the agentic HR assistant. Try:\n\n- *"How much leaves do I have?"*\n- *"I need access to Gitea"*\n- *"What is the travel reimbursement limit?"*\n\nDestructive actions (provisioning, leave applications) need manager approval — switch to the **Approvals** tab to act on them.`,
    },
  ];
}
