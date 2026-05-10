'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Bookmark,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Play,
  Quote,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Target,
  Telescope,
  X,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MODULE_OPTIONS, MODULE_LOOKUP, TIME_UNITS, type TimeUnit } from './modules';
import { convertToDays } from './helpers';
import {
  EndpointMissingError,
  LINKEDIN_API_BASE,
  cancelScout,
  getScout,
  startScout,
  type ScoutBriefing,
  type ScoutFinding,
  type ScoutSignal,
  type SessionTag,
  type SignalCategory,
} from './client';
import CostTracker from './CostTracker';
import ScoutFeed from './ScoutFeed';
import type { DemoAction, DemoState } from './useDemoState';
import {
  useSiteSession,
  useSolutionSession,
} from '@/lib/session/SessionProvider';

interface Props {
  state: DemoState;
  dispatch: React.Dispatch<DemoAction>;
  /** Send the chosen angle to the Studio along with the author vibe. */
  onImport: (topic: string, take: string, vibe: string) => void;
  /** Reset the entire scout workspace (briefing + cached job). Owned by
   *  Demo.tsx because resetting also bumps the session workspace version. */
  onReset: () => void;
}

const DEFAULT_VIBE = 'calm, direct, and slightly skeptical';

// Long scout runs (5–7 minutes) need patient polling.
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 15 * 60_000;
const POLL_MAX_CONSECUTIVE_ERRORS = 20;

const CATEGORY_META: Record<
  SignalCategory,
  { emoji: string; label: string; tone: string }
> = {
  release:  { emoji: '🚀', label: 'Releases',  tone: 'border-blue-500/30   bg-blue-500/10   text-blue-200' },
  research: { emoji: '🔬', label: 'Research',  tone: 'border-violet-500/30 bg-violet-500/10 text-violet-200' },
  tool:     { emoji: '🛠',  label: 'Tools',     tone: 'border-amber-500/30  bg-amber-500/10  text-amber-200' },
  debate:   { emoji: '⚖️', label: 'Debates',   tone: 'border-rose-500/30   bg-rose-500/10   text-rose-200' },
  lesson:   { emoji: '📒', label: 'Lessons',   tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' },
  strategy: { emoji: '🧭', label: 'Strategy',  tone: 'border-cyan-500/30   bg-cyan-500/10   text-cyan-200' },
};

const NOVELTY_META: Record<string, { label: string; tone: string }> = {
  new:       { label: 'New',       tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' },
  follow_up: { label: 'Follow-up', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-200' },
  stale:     { label: 'Stale',     tone: 'border-border bg-muted text-foreground/70' },
};

type PickKind = 'signal' | 'finding';
type PickedRef = { kind: PickKind; id: string } | null;
type BriefingTab = 'signals' | 'findings' | 'context';

export default function ScoutPanel({ state, dispatch, onImport, onReset }: Props) {
  const [unavailable, setUnavailable] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Local "submitting" state for the click→ack window. `busy` only flips after
  // startScout() returns; without this the button looks unresponsive for the
  // ~1s round-trip and impatient users double-click.
  const [submitting, setSubmitting] = useState(false);

  // Session integration: every API call is tagged with the current scout
  // workspace version. After a "Reset Scout" click, the version bumps and
  // any in-flight poll loops fail `shouldAccept(...)` → results dropped.
  const session = useSolutionSession('linkedin-generator');
  const { anonymousVisitId } = useSiteSession();
  const scoutVersion = session.state.workspaceVersions?.scout ?? 1;
  /** Build a SessionTag for outbound calls; recomputed each render so a
   *  re-rendered closure always reads the latest version. */
  const tag = (): SessionTag => ({
    sessionVersion: scoutVersion,
    anonymousVisitId,
  });

  // Briefing now lives in demo state — persisted across tab switches and
  // hard reloads so the user can come back to their results until reset.
  const briefing = state.scout_briefing;

  const [tab, setTab] = useState<BriefingTab>('signals');
  /** Picked card across tabs — only one at a time. */
  const [picked, setPicked] = useState<PickedRef>(null);
  const [draftTopic, setDraftTopic] = useState('');
  const [draftTake, setDraftTake] = useState('');
  const [draftVibe, setDraftVibe] = useState(DEFAULT_VIBE);

  const cancelledRef = useRef(false);
  const pollingRef = useRef(false);
  const briefingRef = useRef<HTMLDivElement>(null);
  const completionAcknowledged = useRef(false);
  /** True iff we observed a busy phase during this mount — gates auto-scroll
   *  so coming back to the Scout tab (or reloading) doesn't yank the page. */
  const wasBusyDuringMount = useRef(false);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  // Recovery: if the panel mounts while persisted state thinks scout is
  // already running (e.g. the user switched out of and back into the Scout
  // tab while a job was in flight), pick polling back up — otherwise the
  // run looks frozen on "Scouting" forever.
  useEffect(() => {
    const jobId = state.scout_job_id;
    const inFlight =
      !!jobId &&
      (state.scout_status === 'queued' || state.scout_status === 'running');
    if (!inFlight) return;
    cancelledRef.current = false;
    if (!startedAt) setStartedAt(Date.now());
    // Resume polling using the current workspace version. The run has been
    // ongoing across the unmount/remount; if the user bumped the version
    // via "Reset Scout" while we were away, the first poll tick will fail
    // shouldAccept() and abort. That's the correct behaviour.
    void poll(jobId, scoutVersion);
    session.setStatus('scout_running');
    session.registerJob({
      id: jobId,
      slug: 'linkedin-generator',
      workspace: 'scout',
      startedAt: Date.now(),
      cancel: () => {
        void cancelScout(jobId, tag());
      },
    });
    // Mount-only resume: deliberately empty deps; state at mount is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = state.scout_status === 'queued' || state.scout_status === 'running';
  // `done` no longer depends on scout_status because load() resets that to
  // 'idle' on hard reload (the server may not remember the job). Instead we
  // trust the persisted pulse_done flag + the presence of cached data.
  const hasCachedBriefing =
    state.pulse_done && (briefing != null || state.pulse_md.length > 0);
  const done = state.scout_status === 'completed' || hasCachedBriefing;
  const failed = state.scout_status === 'failed';
  /** True only for the run that actually finished in this mount — not for
   *  cached results restored from a previous session. */
  const justCompletedThisSession = state.scout_status === 'completed';

  // Tick the elapsed clock while running.
  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = window.setInterval(
      () => setElapsedSec(Math.round((Date.now() - startedAt) / 1000)),
      500,
    );
    return () => window.clearInterval(id);
  }, [busy, startedAt]);

  // Track busy-during-mount so we can distinguish "scout finished just now"
  // (auto-scroll appropriate) from "user came back to a tab where scout was
  // already done" (auto-scroll would be jarring).
  useEffect(() => {
    if (busy) wasBusyDuringMount.current = true;
  }, [busy]);

  // Auto-scroll to the briefing the first time scout completes in this mount.
  useEffect(() => {
    if (!done) {
      completionAcknowledged.current = false;
      return;
    }
    if (completionAcknowledged.current) return;
    if (!wasBusyDuringMount.current) {
      // Cached result on mount — don't yank the viewport, just remember we've
      // already "seen" this briefing so re-renders don't re-trigger.
      completionAcknowledged.current = true;
      return;
    }
    completionAcknowledged.current = true;
    const t = window.setTimeout(() => {
      briefingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 700);
    return () => window.clearTimeout(t);
  }, [done]);

  function toggleModule(key: string) {
    if (busy) return;
    const next = state.selected_modules.includes(key)
      ? state.selected_modules.filter((m) => m !== key)
      : [...state.selected_modules, key];
    dispatch({ type: 'PATCH', payload: { selected_modules: next } });
  }

  async function run() {
    if (busy || submitting || state.selected_modules.length === 0) return;
    // Flip the local submitting flag synchronously so the button shows the
    // spinner before the network round-trip finishes.
    setSubmitting(true);
    setUnavailable(false);
    setPicked(null);
    setStartedAt(Date.now());
    setElapsedSec(0);
    completionAcknowledged.current = false;
    wasBusyDuringMount.current = false;
    // Reset the cancel flag in case a previous mount of this panel left it set
    // (the unmount cleanup flips it to true; without this reset the polling
    // loop would exit immediately after a Scout-tab switch).
    cancelledRef.current = false;
    // Snapshot the version at request time. Polling closures re-check this
    // against the latest session state so we drop results from a run that
    // was reset while in flight.
    const versionAtStart = scoutVersion;
    try {
      const days = convertToDays(state.pulse_value, state.pulse_unit);
      const ack = await startScout(
        { modules: state.selected_modules, days },
        tag(),
      );
      dispatch({ type: 'SCOUT_START', job_id: ack.job_id });
      session.setStatus('scout_running');
      session.registerJob({
        id: ack.job_id,
        slug: 'linkedin-generator',
        workspace: 'scout',
        startedAt: Date.now(),
        cancel: () => {
          // Best-effort — backend cancel is a Phase 3 no-op today; the
          // version guard in poll() is what actually stops the dispatch.
          void cancelScout(ack.job_id, tag());
        },
      });
      void poll(ack.job_id, versionAtStart);
    } catch (e) {
      if (e instanceof EndpointMissingError) setUnavailable(true);
      else
        dispatch({
          type: 'SCOUT_FAIL',
          error: e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message,
        });
    } finally {
      setSubmitting(false);
    }
  }

  /** User-initiated cancel of an in-flight scout. Stops the local polling
   *  loop, fires a best-effort backend cancel, and flips the panel out of
   *  the busy state. The action button (rendered next to Run Scout) then
   *  re-labels from "Cancel" to "Reset Scout" so the user can clear data
   *  on a second click if they want to. */
  async function cancel() {
    const jobId = state.scout_job_id;
    if (!jobId) return;
    cancelledRef.current = true;
    dispatch({ type: 'SCOUT_CANCEL' });
    session.unregisterJob(jobId);
    session.setStatus('ready');
    try {
      await cancelScout(jobId, tag());
    } catch {
      /* best effort — local state is already cancelled */
    }
  }

  async function poll(jobId: string, versionAtStart: number) {
    // Single in-flight loop only — protects against a remount-resume race.
    if (pollingRef.current) return;
    pollingRef.current = true;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let consecutiveErrors = 0;
    try {
    while (!cancelledRef.current && Date.now() < deadline) {
      try {
        const job = await getScout(jobId, tag());
        consecutiveErrors = 0;
        // Stale-result guard: if the user reset Scout while we were in
        // flight, the workspace version moved on. Drop the tick silently —
        // the registry already cancelled this job at reset time.
        if (!session.shouldAccept(versionAtStart, 'scout')) {
          return;
        }
        const step = Number(job.progress?.step ?? 0);
        const total = Number(job.progress?.total ?? state.selected_modules.length);
        dispatch({
          type: 'SCOUT_TICK',
          status: job.status,
          step,
          total,
          module: job.progress?.module,
          message: job.progress?.message,
          callbacks: job.progress?.callbacks,
        });

        if (job.status === 'completed') {
          dispatch({
            type: 'SCOUT_DONE',
            report_md: job.result?.report_md ?? '',
            cost: job.result?.cost_breakdown ?? null,
            briefing: job.result?.briefing ?? null,
          });
          session.unregisterJob(jobId);
          session.setStatus('ready');
          return;
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          dispatch({ type: 'SCOUT_FAIL', error: job.error ?? 'scout failed' });
          session.unregisterJob(jobId);
          session.setStatus(job.status === 'failed' ? 'error' : 'ready');
          return;
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          dispatch({ type: 'SCOUT_FAIL', error: 'scout job lost server-side' });
          session.unregisterJob(jobId);
          session.setStatus('error');
          return;
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= POLL_MAX_CONSECUTIVE_ERRORS) {
          dispatch({ type: 'SCOUT_FAIL', error: 'Lost connection to backend — please retry.' });
          session.unregisterJob(jobId);
          session.setStatus('error');
          return;
        }
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!cancelledRef.current) {
      dispatch({ type: 'SCOUT_FAIL', error: 'Scout exceeded the 15 minute polling window.' });
      session.unregisterJob(jobId);
      session.setStatus('error');
    }
    } finally {
      pollingRef.current = false;
    }
  }

  // Picking flow
  function pickSignal(s: ScoutSignal) {
    setPicked({ kind: 'signal', id: s.id });
    setDraftTopic(s.headline);
    setDraftTake(s.post_angle || s.summary);
    setDraftVibe(state.author_vibe || DEFAULT_VIBE);
  }
  function pickFinding(f: ScoutFinding) {
    setPicked({ kind: 'finding', id: f.id });
    setDraftTopic(trim(f.claim, 110));
    setDraftTake(f.why_it_matters || f.claim);
    setDraftVibe(state.author_vibe || DEFAULT_VIBE);
  }
  function cancelPick() {
    setPicked(null);
    setDraftTopic('');
    setDraftTake('');
    setDraftVibe(DEFAULT_VIBE);
  }
  function confirmPick() {
    const topic = draftTopic.trim();
    if (!topic) return;
    onImport(topic, draftTake.trim(), draftVibe.trim() || DEFAULT_VIBE);
    setPicked(null);
  }

  // Switching tabs cancels the pick (keeps state simple, avoids confusion).
  function switchTab(next: BriefingTab) {
    if (picked) cancelPick();
    setTab(next);
  }

  function scrollToBriefing() {
    briefingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Briefing data ────────────────────────────────────────────────
  const signals = briefing?.signals ?? [];
  const findings = briefing?.findings ?? [];
  const themes = briefing?.themes ?? [];
  const tensions = briefing?.tensions ?? [];
  const gaps = briefing?.gaps ?? [];
  const actionItems = briefing?.action_items ?? [];
  const lead = briefing?.lead ?? '';

  const findingsById = useMemo(() => {
    const m = new Map<string, ScoutFinding>();
    findings.forEach((f) => m.set(f.id, f));
    return m;
  }, [findings]);

  const signalsByCategory = useMemo(() => {
    const order: SignalCategory[] = ['release', 'research', 'tool', 'debate', 'lesson', 'strategy'];
    const grouped: Array<{ cat: SignalCategory; items: ScoutSignal[] }> = [];
    for (const cat of order) {
      const items = signals.filter((s) => s.category === cat);
      if (items.length) grouped.push({ cat, items });
    }
    // Append any unexpected categories at the end (forward-compat).
    const seen = new Set(order);
    const extras = signals.filter((s) => !seen.has(s.category));
    if (extras.length) {
      // @ts-expect-error — surface unknown categories so they're never lost.
      grouped.push({ cat: 'other', items: extras });
    }
    return grouped;
  }, [signals]);

  const contextCount = themes.length + tensions.length + (gaps.length > 0 ? 1 : 0) + (actionItems.length > 0 ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* ─────────────── TOP ROW: form + live area ─────────────── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(320px,0.85fr)_minmax(420px,1.15fr)]">
        {/* ─── Form column ─────────────────────────── */}
        <div className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
            className="space-y-4 rounded-xl border border-border bg-muted/15 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2">
                  <Telescope className="h-4 w-4 text-foreground" />
                  <h4 className="text-sm font-semibold text-foreground">Pulse Scout</h4>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-foreground/85">
                  Scans the AI sector — community signals, research, tooling, frontier-lab moves —
                  and synthesises a briefing of distinct angles you can write a post about.
                </p>
              </div>
              <StatusPill
                busy={busy}
                done={done}
                failed={failed}
                elapsedSec={elapsedSec}
                showTimer={startedAt != null}
              />
            </div>

            <Field label={`Modules (${state.selected_modules.length} selected)`}>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {MODULE_OPTIONS.map((m) => {
                  const checked = state.selected_modules.includes(m.key);
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => toggleModule(m.key)}
                      disabled={busy}
                      className={cn(
                        'group flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition disabled:opacity-60',
                        checked
                          ? 'border-foreground/45 bg-background shadow-sm'
                          : 'border-border bg-background/60 hover:border-foreground/30',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          checked
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border/70 bg-background',
                        )}
                        aria-hidden
                      >
                        {checked && <CheckCircle2 className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-foreground">
                          {m.label}
                        </span>
                        <span className="block text-[11px] text-foreground/70">{m.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Time window">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={730}
                  value={state.pulse_value}
                  disabled={busy}
                  onChange={(e) =>
                    dispatch({
                      type: 'PATCH',
                      payload: { pulse_value: Number(e.target.value) || 1 },
                    })
                  }
                  className="input w-24"
                />
                <Select
                  value={state.pulse_unit}
                  disabled={busy}
                  onValueChange={(v) =>
                    dispatch({ type: 'PATCH', payload: { pulse_unit: v as TimeUnit } })
                  }
                >
                  <SelectTrigger className="h-9 w-32 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground/80">
                  ≈ {convertToDays(state.pulse_value, state.pulse_unit)} day
                  {convertToDays(state.pulse_value, state.pulse_unit) === 1 ? '' : 's'}
                </span>
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={busy || submitting || state.selected_modules.length === 0}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-50"
              >
                {busy || submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {submitting && !busy ? 'Starting…' : 'Scouting…'}
                  </>
                ) : done ? (
                  <>
                    <RefreshCw className="h-4 w-4" /> Run again
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> Run Scout
                  </>
                )}
              </button>

              {/* Combined cancel/reset action. While a run is in flight this
                  shows "Cancel" (destructive accent) and aborts the job
                  without clearing data. Once stopped (cancelled / failed /
                  completed) it re-labels to "Reset Scout" and clears the
                  workspace on click. The two states are deliberately the
                  same button so the placement next to Run Scout stays
                  stable, but the colors differ so the action is unambiguous. */}
              {busy ? (
                <button
                  type="button"
                  onClick={() => { void cancel(); }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/15"
                  title="Stop the scout run. Partial output is kept; click Reset Scout to clear."
                >
                  <Square className="h-3.5 w-3.5 fill-current" /> Cancel
                </button>
              ) : (
                (state.scout_job_id || done || failed || state.scout_status === 'cancelled') && (
                  <button
                    type="button"
                    onClick={onReset}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground/80 transition hover:bg-muted"
                    title="Clear the briefing and active scout job. Studio drafts are kept."
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reset Scout
                  </button>
                )
              )}

              {state.scout_job_id && (
                <span className="text-xs text-foreground/75">
                  job{' '}
                  <code className="font-mono text-foreground/85">
                    {state.scout_job_id.slice(0, 8)}
                  </code>
                </span>
              )}
            </div>

            {state.scout_error && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{state.scout_error}</span>
              </div>
            )}

            {unavailable && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                Scout endpoint isn&apos;t reachable —{' '}
                <a
                  className="inline-flex items-center gap-1 underline"
                  href={LINKEDIN_API_BASE}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  run on the live app <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            <style jsx>{`
              .input {
                border-radius: 0.375rem;
                border: 1px solid hsl(var(--border));
                background: hsl(var(--background));
                padding: 0.5rem 0.7rem;
                font-size: 0.875rem;
                line-height: 1.4;
                outline: none;
              }
              .input:focus {
                box-shadow: 0 0 0 1px hsl(var(--ring));
              }
              .input:disabled {
                opacity: 0.6;
                cursor: not-allowed;
              }
            `}</style>
          </form>

          <CostTracker cost={state.scout_cost} kind="scout" />
        </div>

        {/* ─── Right column: live activity ─────────── */}
        <div className="min-w-0">
          {(busy || state.scout_callbacks.length > 0) && !done && (
            <ScoutFeed
              callbacks={state.scout_callbacks}
              active={busy}
              module={state.scout_progress_module}
              className="h-[50vh] min-h-[320px] sm:h-[560px]"
            />
          )}

          {!busy && state.scout_callbacks.length === 0 && !done && <IdleHero />}

          {done && (
            <DoneCallout
              elapsedSec={startedAt != null ? elapsedSec : null}
              cached={!justCompletedThisSession}
              modules={state.selected_modules}
              briefing={briefing}
              signalsCount={signals.length}
              findingsCount={findings.length}
              onView={scrollToBriefing}
            />
          )}
        </div>
      </div>

      {/* ─────────────── BRIEFING AREA ─────────────── */}
      {done && (
        <div ref={briefingRef} className="space-y-4 scroll-mt-6">
          <SectionHeader
            title="Your briefing"
            subtitle="A scout-curated set of angles. Pick one — you'll see exactly what gets sent to the Studio before you confirm."
          />

          {lead && <LeadBanner lead={lead} />}

          <TabSwitcher
            value={tab}
            onChange={switchTab}
            tabs={[
              { key: 'signals',  icon: Bookmark,      label: 'Signals',  count: signals.length,  primary: true },
              { key: 'findings', icon: FileText,      label: 'Findings', count: findings.length },
              { key: 'context',  icon: BookOpenCheck, label: 'Context',  count: contextCount, dimmed: true },
            ]}
          />

          {tab === 'signals' && (
            <SignalsView
              groups={signalsByCategory}
              picked={picked}
              draftTopic={draftTopic}
              draftTake={draftTake}
              draftVibe={draftVibe}
              setDraftTopic={setDraftTopic}
              setDraftTake={setDraftTake}
              setDraftVibe={setDraftVibe}
              onPick={pickSignal}
              onCancel={cancelPick}
              onConfirm={confirmPick}
              findingsById={findingsById}
            />
          )}

          {tab === 'findings' && (
            <FindingsView
              findings={findings}
              picked={picked}
              draftTopic={draftTopic}
              draftTake={draftTake}
              draftVibe={draftVibe}
              setDraftTopic={setDraftTopic}
              setDraftTake={setDraftTake}
              setDraftVibe={setDraftVibe}
              onPick={pickFinding}
              onCancel={cancelPick}
              onConfirm={confirmPick}
            />
          )}

          {tab === 'context' && (
            <ContextView
              themes={themes}
              tensions={tensions}
              gaps={gaps}
              actionItems={actionItems}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Right-column states
// ═══════════════════════════════════════════════════════════════════════════

function IdleHero() {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/15 px-6 py-8 text-center sm:min-h-[520px] sm:py-10">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 text-foreground/85">
        <Telescope className="h-5 w-5" />
      </span>
      <div className="max-w-sm space-y-1.5">
        <p className="text-base font-semibold text-foreground">Live scout activity</p>
        <p className="text-sm leading-relaxed text-foreground/80">
          When you run the scout, each module&apos;s progress streams here in real time. Once
          everything finishes, the briefing — pickable signals and findings — appears below.
        </p>
      </div>
    </div>
  );
}

function DoneCallout({
  elapsedSec,
  cached,
  modules,
  briefing,
  signalsCount,
  findingsCount,
  onView,
}: {
  /** Null when there's no live timer for this briefing (e.g. cached from a previous session). */
  elapsedSec: number | null;
  cached: boolean;
  modules: string[];
  briefing: ScoutBriefing | null;
  signalsCount: number;
  findingsCount: number;
  onView: () => void;
}) {
  const elapsedLabel =
    elapsedSec != null
      ? Math.floor(elapsedSec / 60) > 0
        ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
        : `${elapsedSec}s`
      : null;

  return (
    <div className="flex h-full min-h-[320px] flex-col gap-5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5 sm:min-h-[520px] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-emerald-100">
            {cached ? 'Briefing — cached from your last run' : 'Briefing ready'}
          </p>
          <p className="mt-0.5 text-sm text-emerald-100/85">
            {cached
              ? 'Pick any angle below, or run scout again to refresh.'
              : `Finished in ${elapsedLabel}. Scroll down to pick an angle for the Studio.`}
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Stat label="Signals" value={String(signalsCount)} icon={Bookmark} />
        <Stat label="Findings" value={String(findingsCount)} icon={FileText} />
        <Stat label="Modules" value={String(modules.length)} icon={Layers} />
        <Stat
          label={cached ? 'Status' : 'Elapsed'}
          value={cached ? 'Cached' : (elapsedLabel ?? '—')}
          icon={Sparkles}
        />
      </ul>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-200/85">
          Modules used
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {modules.map((id) => {
            const count = briefing?.module_activity?.[id];
            return (
              <li
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-background/40 px-2 py-0.5 text-xs text-foreground/95"
              >
                <span className="font-semibold">{MODULE_LOOKUP[id]?.label ?? id}</span>
                {count != null && (
                  <span className="font-mono text-[10px] text-foreground/70">{count}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto">
        <button
          type="button"
          onClick={onView}
          className="group inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 shadow-sm transition hover:bg-emerald-400"
        >
          View angles
          <ArrowDown className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5 motion-safe:animate-bounce" />
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <li className="rounded-lg border border-emerald-500/20 bg-background/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-emerald-200/85">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </li>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Briefing area: layout primitives
// ═══════════════════════════════════════════════════════════════════════════

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold tracking-tight text-foreground">{title}</h3>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-foreground/80">{subtitle}</p>
    </div>
  );
}

function LeadBanner({ lead }: { lead: string }) {
  return (
    <div className="rounded-xl border-l-4 border-foreground/60 border-y border-r border-border bg-muted/15 p-4">
      <div className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/65">
        <Quote className="h-3.5 w-3.5" /> Lead
      </div>
      <p className="text-[15px] leading-relaxed text-foreground">{lead}</p>
    </div>
  );
}

function TabSwitcher<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (next: T) => void;
  tabs: Array<{
    key: T;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    count: number;
    primary?: boolean;
    dimmed?: boolean;
  }>;
}) {
  return (
    <div role="tablist" className="inline-flex w-full gap-1 rounded-lg border border-border bg-muted/30 p-1">
      {tabs.map((t) => {
        const active = value === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
              active
                ? 'bg-background text-foreground shadow-sm'
                : t.dimmed
                  ? 'text-foreground/55 hover:text-foreground/85'
                  : 'text-foreground/75 hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{t.label}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold',
                active
                  ? t.primary
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-foreground/75'
                  : 'bg-background/70 text-foreground/65',
              )}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Signals tab
// ═══════════════════════════════════════════════════════════════════════════

interface PickHandlerProps<T> {
  picked: PickedRef;
  draftTopic: string;
  draftTake: string;
  draftVibe: string;
  setDraftTopic: (s: string) => void;
  setDraftTake: (s: string) => void;
  setDraftVibe: (s: string) => void;
  onPick: (item: T) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function SignalsView({
  groups,
  picked,
  draftTopic,
  draftTake,
  draftVibe,
  setDraftTopic,
  setDraftTake,
  setDraftVibe,
  onPick,
  onCancel,
  onConfirm,
  findingsById,
}: PickHandlerProps<ScoutSignal> & {
  groups: Array<{ cat: SignalCategory; items: ScoutSignal[] }>;
  findingsById: Map<string, ScoutFinding>;
}) {
  if (groups.length === 0) {
    return <Empty message="No signals were synthesised — try expanding the time window or adding modules." />;
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.cat}>
          <CategoryHeader cat={g.cat} count={g.items.length} />
          <div className="mt-3 space-y-3">
            {g.items.map((s) => {
              const isPicked = picked?.kind === 'signal' && picked.id === s.id;
              return (
                <SignalCard
                  key={s.id}
                  signal={s}
                  picked={isPicked}
                  draftTopic={isPicked ? draftTopic : ''}
                  draftTake={isPicked ? draftTake : ''}
                  draftVibe={isPicked ? draftVibe : ''}
                  setDraftTopic={setDraftTopic}
                  setDraftTake={setDraftTake}
                  setDraftVibe={setDraftVibe}
                  onPick={() => onPick(s)}
                  onCancel={onCancel}
                  onConfirm={onConfirm}
                  cited={s.finding_ids.map((id) => findingsById.get(id)).filter(isFinding)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function CategoryHeader({ cat, count }: { cat: SignalCategory; count: number }) {
  const meta = CATEGORY_META[cat] ?? {
    emoji: '•',
    label: cat,
    tone: 'border-border bg-muted text-foreground/70',
  };
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
          meta.tone,
        )}
      >
        <span aria-hidden>{meta.emoji}</span>
        {meta.label}
      </span>
      <span className="text-xs text-foreground/65">
        {count} signal{count === 1 ? '' : 's'}
      </span>
      <div className="ml-1 h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

function SignalCard({
  signal,
  picked,
  draftTopic,
  draftTake,
  draftVibe,
  setDraftTopic,
  setDraftTake,
  setDraftVibe,
  onPick,
  onCancel,
  onConfirm,
  cited,
}: {
  signal: ScoutSignal;
  picked: boolean;
  draftTopic: string;
  draftTake: string;
  draftVibe: string;
  setDraftTopic: (s: string) => void;
  setDraftTake: (s: string) => void;
  setDraftVibe: (s: string) => void;
  onPick: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  cited: ScoutFinding[];
}) {
  return (
    <article
      className={cn(
        'rounded-xl border bg-background transition-all',
        picked
          ? 'border-foreground/55 shadow-md ring-1 ring-foreground/20'
          : 'border-border hover:border-foreground/30',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold leading-snug text-foreground">
            {signal.headline}
          </h4>
          {signal.summary && (
            <p className="mt-2 text-sm leading-relaxed text-foreground/85">
              {signal.summary}
            </p>
          )}
        </div>
        {!picked && (
          <button
            type="button"
            onClick={onPick}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90"
          >
            Pick <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Post angle hint */}
      {signal.post_angle && !picked && (
        <div className="mx-5 mt-3 rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="mb-0.5 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-foreground/65">
            <Target className="h-3 w-3" /> Suggested take
          </div>
          <p className="text-sm leading-relaxed italic text-foreground/85">
            “{signal.post_angle}”
          </p>
        </div>
      )}

      {/* Sources */}
      {!picked && cited.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4 pt-3 text-xs text-foreground/70">
          <span className="font-semibold text-foreground/60">Sources:</span>
          {cited.slice(0, 4).map((f) => (
            <SourceChip key={f.id} finding={f} />
          ))}
          {cited.length > 4 && (
            <span className="text-foreground/55">+{cited.length - 4}</span>
          )}
        </div>
      )}
      {!picked && cited.length === 0 && <div className="h-4" />}

      {/* Inline composer when picked */}
      {picked && (
        <InlineComposer
          topic={draftTopic}
          take={draftTake}
          vibe={draftVibe}
          setTopic={setDraftTopic}
          setTake={setDraftTake}
          setVibe={setDraftVibe}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </article>
  );
}

function SourceChip({ finding }: { finding: ScoutFinding }) {
  const moduleLabel = finding.module ? MODULE_LOOKUP[finding.module]?.label ?? finding.module : '';
  const label = finding.source_label || moduleLabel || 'source';
  const inner = (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground/85 hover:border-foreground/30">
      {label}
      {finding.source_url && <ExternalLink className="h-2.5 w-2.5 opacity-65" />}
    </span>
  );
  if (finding.source_url) {
    return (
      <a
        href={finding.source_url}
        target="_blank"
        rel="noopener noreferrer"
        title={moduleLabel ? `${label} · ${moduleLabel}` : label}
      >
        {inner}
      </a>
    );
  }
  return inner;
}

// ═══════════════════════════════════════════════════════════════════════════
// Findings tab
// ═══════════════════════════════════════════════════════════════════════════

const FINDINGS_INITIAL_LIMIT = 24;

function FindingsView({
  findings,
  picked,
  draftTopic,
  draftTake,
  draftVibe,
  setDraftTopic,
  setDraftTake,
  setDraftVibe,
  onPick,
  onCancel,
  onConfirm,
}: PickHandlerProps<ScoutFinding> & {
  findings: ScoutFinding[];
}) {
  const [showAll, setShowAll] = useState(false);
  if (findings.length === 0) {
    return <Empty message="No findings were extracted in this run." />;
  }
  const visible = showAll ? findings : findings.slice(0, FINDINGS_INITIAL_LIMIT);
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-foreground/70">
        Atomic facts extracted from sources. Pick any one to write a tight, fact-grounded post about it.
      </p>
      {visible.map((f) => {
        const isPicked = picked?.kind === 'finding' && picked.id === f.id;
        return (
          <FindingCard
            key={f.id}
            finding={f}
            picked={isPicked}
            draftTopic={isPicked ? draftTopic : ''}
            draftTake={isPicked ? draftTake : ''}
            draftVibe={isPicked ? draftVibe : ''}
            setDraftTopic={setDraftTopic}
            setDraftTake={setDraftTake}
            setDraftVibe={setDraftVibe}
            onPick={() => onPick(f)}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        );
      })}
      {findings.length > FINDINGS_INITIAL_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background py-2 text-xs font-medium text-foreground/85 hover:bg-muted"
        >
          {showAll ? (
            <>
              <ChevronUp className="h-3 w-3" /> Hide {findings.length - FINDINGS_INITIAL_LIMIT} more
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Show all {findings.length} findings
            </>
          )}
        </button>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  picked,
  draftTopic,
  draftTake,
  draftVibe,
  setDraftTopic,
  setDraftTake,
  setDraftVibe,
  onPick,
  onCancel,
  onConfirm,
}: {
  finding: ScoutFinding;
  picked: boolean;
  draftTopic: string;
  draftTake: string;
  draftVibe: string;
  setDraftTopic: (s: string) => void;
  setDraftTake: (s: string) => void;
  setDraftVibe: (s: string) => void;
  onPick: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const novelty = finding.novelty ? NOVELTY_META[finding.novelty] : null;
  const moduleLabel = finding.module ? MODULE_LOOKUP[finding.module]?.label ?? finding.module : '';
  const conf = finding.confidence;

  return (
    <article
      className={cn(
        'rounded-xl border bg-background transition-all',
        picked
          ? 'border-foreground/55 shadow-md ring-1 ring-foreground/20'
          : 'border-border hover:border-foreground/30',
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-foreground">
            {finding.claim}
          </p>
          {finding.why_it_matters && (
            <p className="mt-1.5 text-xs italic leading-relaxed text-foreground/75">
              Why it matters: {finding.why_it_matters}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {novelty && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
                  novelty.tone,
                )}
              >
                {novelty.label}
              </span>
            )}
            {moduleLabel && (
              <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-foreground/80">
                {moduleLabel}
              </span>
            )}
            {finding.source_url ? (
              <a
                href={finding.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground/85 hover:border-foreground/30"
              >
                {finding.source_label || 'source'}
                <ExternalLink className="h-2.5 w-2.5 opacity-65" />
              </a>
            ) : (
              finding.source_label && (
                <span className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground/80">
                  {finding.source_label}
                </span>
              )
            )}
            {conf != null && (
              <span
                className={cn(
                  'rounded-full border px-1.5 py-0.5 font-mono text-[10px]',
                  conf >= 0.8
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : conf >= 0.5
                      ? 'border-border bg-muted/30 text-foreground/80'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-200',
                )}
                title="Synthesizer confidence"
              >
                conf {conf.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        {!picked && (
          <button
            type="button"
            onClick={onPick}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-semibold text-background hover:bg-foreground/90"
          >
            Pick <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {picked && (
        <InlineComposer
          topic={draftTopic}
          take={draftTake}
          vibe={draftVibe}
          setTopic={setDraftTopic}
          setTake={setDraftTake}
          setVibe={setDraftVibe}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )}
    </article>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Context tab
// ═══════════════════════════════════════════════════════════════════════════

function ContextView({
  themes,
  tensions,
  gaps,
  actionItems,
}: {
  themes: ScoutBriefing['themes'];
  tensions: ScoutBriefing['tensions'];
  gaps: string[];
  actionItems: string[];
}) {
  if (
    (!themes || themes.length === 0) &&
    (!tensions || tensions.length === 0) &&
    gaps.length === 0 &&
    actionItems.length === 0
  ) {
    return <Empty message="No supporting context was generated for this briefing." />;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground/70">
        Supporting context — themes, tensions, gaps, and action items the synthesiser pulled out of
        the findings. These aren&apos;t directly pickable, but they help you choose which signal or
        finding to write about.
      </p>

      {themes && themes.length > 0 && (
        <ContextSection title="Themes" icon={Compass}>
          {themes.map((t, i) => (
            <ContextItem key={`${t.title}-${i}`} title={t.title} body={t.summary} />
          ))}
        </ContextSection>
      )}

      {tensions && tensions.length > 0 && (
        <ContextSection title="Tensions" icon={AlertTriangle}>
          {tensions.map((t, i) => (
            <ContextItem key={`${t.title}-${i}`} title={t.title} body={t.summary} />
          ))}
        </ContextSection>
      )}

      {gaps.length > 0 && (
        <ContextSection title="Gaps to investigate next" icon={Telescope}>
          <ul className="space-y-1.5">
            {gaps.map((g, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/85">
                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-foreground/45" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </ContextSection>
      )}

      {actionItems.length > 0 && (
        <ContextSection title="Action items this week" icon={Target}>
          <ul className="space-y-1.5">
            {actionItems.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/85">
                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-foreground/45" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </ContextSection>
      )}
    </div>
  );
}

function ContextSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <details
      open
      className="group rounded-xl border border-border bg-background open:bg-muted/10"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-foreground/70" />
        {title}
        <ChevronDown className="ml-auto h-3.5 w-3.5 text-foreground/55 transition group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 border-t border-border px-4 py-3.5">{children}</div>
    </details>
  );
}

function ContextItem({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <p className="mt-0.5 text-sm leading-relaxed text-foreground/85">{body}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Inline composer (rendered inside a picked card)
// ═══════════════════════════════════════════════════════════════════════════

function InlineComposer({
  topic,
  take,
  vibe,
  setTopic,
  setTake,
  setVibe,
  onCancel,
  onConfirm,
}: {
  topic: string;
  take: string;
  vibe: string;
  setTopic: (s: string) => void;
  setTake: (s: string) => void;
  setVibe: (s: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ready = topic.trim().length > 1;
  return (
    <div className="border-t border-border bg-muted/15 px-5 py-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <ArrowRight className="h-4 w-4" /> Send this to the Studio
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">
            All three fields are pre-filled from the signal. Edit if you want — they map into Studio&apos;s
            <span className="mx-1 rounded bg-background px-1 font-mono text-[11px]">Topic</span>,
            <span className="mx-1 rounded bg-background px-1 font-mono text-[11px]">Your take</span>, and
            <span className="mx-1 rounded bg-background px-1 font-mono text-[11px]">Author vibe</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1 text-foreground/65 hover:bg-muted hover:text-foreground"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-foreground/75">
            Topic
            <span className="ml-1.5 font-mono text-[10px] normal-case tracking-normal text-foreground/55">
              → Studio · Topic
            </span>
          </span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Mixture of Experts in production"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-ring"
          />
        </label>

        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-foreground/75">
            <span>
              Your take
              <span className="ml-1.5 font-mono text-[10px] normal-case tracking-normal text-foreground/55">
                → Studio · Your take
              </span>
            </span>
            <span className="font-mono text-[10px] normal-case tracking-normal text-foreground/55">
              {take.length} chars
            </span>
          </span>
          <textarea
            value={take}
            onChange={(e) => setTake(e.target.value)}
            rows={3}
            placeholder="The opinion that becomes the soul of the post."
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-ring"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-foreground/75">
            Author vibe
            <span className="ml-1.5 font-mono text-[10px] normal-case tracking-normal text-foreground/55">
              → Studio · Author vibe
            </span>
          </span>
          <input
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder="e.g. calm, direct, and slightly skeptical"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
        >
          Use in Studio <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Misc bits
// ═══════════════════════════════════════════════════════════════════════════

function StatusPill({
  busy,
  done,
  failed,
  elapsedSec,
  showTimer,
}: {
  busy: boolean;
  done: boolean;
  failed: boolean;
  elapsedSec: number;
  /** Hide the timer for cached results (no live session). */
  showTimer: boolean;
}) {
  const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
  const secs = Math.floor(elapsedSec % 60).toString().padStart(2, '0');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        failed
          ? 'border-red-500/40 bg-red-500/10 text-red-200'
          : busy
            ? 'border-foreground/40 bg-foreground/10 text-foreground'
            : done
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-border bg-background text-foreground/85',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          failed
            ? 'bg-red-400'
            : busy
              ? 'animate-pulse bg-foreground/80'
              : done
                ? 'bg-emerald-400'
                : 'bg-foreground/45',
        )}
      />
      {failed ? 'Failed' : busy ? 'Scouting' : done ? 'Done' : 'Idle'}
      {showTimer && (busy || done || failed) && (
        <span className="font-mono tabular-nums text-foreground/85">
          {mins}:{secs}
        </span>
      )}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-foreground/75">
        {label}
      </span>
      {children}
    </label>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/15 p-6 text-center text-sm text-foreground/75">
      {message}
    </div>
  );
}

function isFinding(x: ScoutFinding | undefined): x is ScoutFinding {
  return Boolean(x);
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  const win = s.slice(0, max);
  const stop = Math.max(win.lastIndexOf('. '), win.lastIndexOf('! '), win.lastIndexOf('? '));
  if (stop >= max * 0.6) return win.slice(0, stop + 1).trim();
  return win.trimEnd() + '…';
}
