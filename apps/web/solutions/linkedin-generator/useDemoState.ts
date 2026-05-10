'use client';

import { useEffect, useReducer } from 'react';
import { MODULE_OPTIONS } from './modules';
import type {
  AgentEvent,
  CostBreakdown,
  JobStatus,
  PostStage,
  ScoutBriefing,
} from './client';

const STORAGE_KEY = 'linkedin-demo-v2';
// Runtime / in-flight fields live in sessionStorage so they're per-tab
// instead of shared across every browser tab on the origin. Without this
// split, opening a second tab while a scout/studio job is running causes
// both tabs to poll the same job_id and race on writes — leading to
// "completed with no results" snapshots overwriting good ones.
const RUNTIME_STORAGE_KEY = 'linkedin-runtime-v1';

// Fields that describe an in-flight job. These persist across in-tab
// navigation (sessionStorage survives route changes) but never leak to
// other tabs. Keep this list and the persistence effect in sync.
const RUNTIME_FIELDS = [
  'scout_job_id',
  'scout_status',
  'scout_progress_step',
  'scout_progress_total',
  'scout_progress_message',
  'scout_progress_module',
  'scout_callbacks',
  'scout_error',
  'current_job_id',
  'job_status',
  'job_error',
  'stage',
  'events',
  'started_at_ms',
] as const satisfies ReadonlyArray<keyof DemoState>;

export interface GeneratedImage {
  /** Returned by /images. */
  image_id: string;
  /** Path served by the backend (relative). */
  image_url: string;
  /** Prompt the image was generated from — for the gallery hover. */
  prompt: string;
  quality: 'low' | 'medium' | 'high';
  ts: string;
}

export interface DemoState {
  // ── Scout ────────────────────────────────────────────────────────────
  pulse_md: string;
  pulse_done: boolean;
  scout_job_id: string | null;
  scout_status: JobStatus | 'idle';
  scout_progress_step: number;
  scout_progress_total: number;
  scout_progress_message: string;
  scout_progress_module: string;
  scout_callbacks: Array<{ ts: string; module: string; phase: string; message: string }>;
  scout_error: string | null;
  /**
   * Structured briefing from the most recent completed scout run. Persisted so
   * the Scout tab still shows signals/findings after the user navigates away
   * and back, or reloads the page — until the session is reset.
   */
  scout_briefing: ScoutBriefing | null;
  selected_modules: string[];
  pulse_value: number;
  pulse_unit: 'days' | 'weeks' | 'months' | 'years';

  // ── Studio (Authority Crew) ──────────────────────────────────────────
  imported_topic: string;
  topic: string;
  leader_angle: string;
  author_vibe: string;
  author_name: string;
  author_title: string;
  author_location: string;
  audience: 'engineering' | 'business';

  // ── Live run state ───────────────────────────────────────────────────
  current_job_id: string | null;
  job_status: JobStatus | 'idle';
  job_error: string | null;
  stage: PostStage;
  events: AgentEvent[];
  started_at_ms: number | null;

  // ── Output ───────────────────────────────────────────────────────────
  run_id: string;
  post_draft: string;
  image_prompt: string;
  emotional_beats: string[];
  images: GeneratedImage[];
  image_quality: 'low' | 'medium' | 'high';
  crew_done: boolean;

  // ── Cost ─────────────────────────────────────────────────────────────
  cost: CostBreakdown | null;
  scout_cost: CostBreakdown | null;
}

const INITIAL: DemoState = {
  pulse_md: '',
  pulse_done: false,
  scout_job_id: null,
  scout_status: 'idle',
  scout_progress_step: 0,
  scout_progress_total: 1,
  scout_progress_message: '',
  scout_progress_module: '',
  scout_callbacks: [],
  scout_error: null,
  scout_briefing: null,
  selected_modules: MODULE_OPTIONS.map((m) => m.key),
  pulse_value: 7,
  pulse_unit: 'days',

  imported_topic: '',
  topic: 'Agentic AI workflows in production',
  leader_angle:
    'Most agentic systems are overengineered for the problems they actually solve.',
  author_vibe: 'calm, direct, and slightly skeptical',
  author_name: 'Shekhar Dudi',
  author_title: 'AI Engineer',
  author_location: 'Melbourne, Australia',
  audience: 'engineering',

  current_job_id: null,
  job_status: 'idle',
  job_error: null,
  stage: 'queued',
  events: [],
  started_at_ms: null,

  run_id: '',
  post_draft: '',
  image_prompt: '',
  emotional_beats: [],
  images: [],
  image_quality: 'medium',
  crew_done: false,

  cost: null,
  scout_cost: null,
};

export type DemoAction =
  | { type: 'PATCH'; payload: Partial<DemoState> }
  | {
      type: 'IMPORT_TOPIC';
      topic: string;
      leader_angle?: string;
      author_vibe?: string;
    }
  // Scout
  | { type: 'SCOUT_START'; job_id: string }
  | {
      type: 'SCOUT_TICK';
      status: JobStatus;
      step?: number;
      total?: number;
      module?: string;
      message?: string;
      callbacks?: Array<{ ts: string; module: string; phase: string; message: string }>;
    }
  | {
      type: 'SCOUT_DONE';
      report_md: string;
      cost?: CostBreakdown | null;
      briefing?: ScoutBriefing | null;
    }
  | { type: 'SCOUT_FAIL'; error: string }
  | { type: 'SCOUT_CANCEL' }
  // Posts
  | { type: 'JOB_START'; job_id: string }
  | {
      type: 'JOB_TICK';
      status: JobStatus;
      stage?: PostStage;
      events?: AgentEvent[];
    }
  | { type: 'JOB_FAIL'; error: string }
  | { type: 'JOB_CANCEL' }
  | {
      type: 'JOB_RESULT';
      run_id: string;
      post_draft: string;
      image_prompt: string;
      emotional_beats?: string[];
      cost?: CostBreakdown | null;
    }
  | { type: 'IMAGE_ADDED'; image: GeneratedImage; cost?: CostBreakdown | null }
  | { type: 'RESET' }
  | { type: 'RESET_SCOUT' }
  | { type: 'RESET_STUDIO' };

function reducer(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case 'PATCH':
      return { ...s, ...a.payload };
    case 'IMPORT_TOPIC':
      return {
        ...s,
        imported_topic: a.topic,
        topic: a.topic,
        // Caller supplies the take when importing from a structured signal/finding;
        // fall back to wiping the field so an old take from a previous import
        // doesn't leak into the new run.
        leader_angle: a.leader_angle ?? '',
        // Scout's composer now ships a vibe alongside the take. Preserve the
        // existing vibe if the caller didn't pass one (e.g. legacy callers).
        author_vibe: a.author_vibe !== undefined ? a.author_vibe : s.author_vibe,
      };

    case 'SCOUT_START':
      return {
        ...s,
        scout_job_id: a.job_id,
        scout_status: 'queued',
        scout_progress_step: 0,
        scout_progress_total: Math.max(s.selected_modules.length, 1),
        scout_progress_message: '',
        scout_progress_module: '',
        scout_callbacks: [],
        pulse_md: '',
        pulse_done: false,
        scout_error: null,
        scout_cost: null,
        // Wipe the previous briefing so the UI doesn't mix old signals with a
        // new in-flight run.
        scout_briefing: null,
      };
    case 'SCOUT_TICK':
      return {
        ...s,
        scout_status: a.status,
        scout_progress_step: a.step ?? s.scout_progress_step,
        scout_progress_total: a.total ?? s.scout_progress_total,
        scout_progress_module: a.module ?? s.scout_progress_module,
        scout_progress_message: a.message ?? s.scout_progress_message,
        scout_callbacks: a.callbacks ?? s.scout_callbacks,
      };
    case 'SCOUT_DONE':
      return {
        ...s,
        scout_status: 'completed',
        pulse_md: a.report_md,
        pulse_done: true,
        scout_cost: a.cost ?? s.scout_cost,
        scout_briefing: a.briefing ?? s.scout_briefing,
      };
    case 'SCOUT_FAIL':
      return {
        ...s,
        scout_status: 'failed',
        scout_error: a.error,
      };
    case 'SCOUT_CANCEL':
      // User-initiated cancel — distinct from a failure. Briefing (if any
      // partial) and configured inputs are kept; only the in-flight markers
      // flip so `busy` becomes false and the action button moves from
      // "Cancel" to "Reset Scout".
      return {
        ...s,
        scout_status: 'cancelled',
        scout_error: null,
        scout_progress_message: '',
      };

    case 'JOB_START':
      return {
        ...s,
        current_job_id: a.job_id,
        job_status: 'queued',
        job_error: null,
        stage: 'queued',
        events: [],
        started_at_ms: Date.now(),
        crew_done: false,
        run_id: '',
        post_draft: '',
        image_prompt: '',
        emotional_beats: [],
        images: [],
        cost: null,
      };
    case 'JOB_TICK':
      return {
        ...s,
        job_status: a.status,
        stage: a.stage ?? s.stage,
        events: a.events && a.events !== s.events ? a.events : s.events,
      };
    case 'JOB_FAIL':
      return { ...s, job_status: 'failed', job_error: a.error };
    case 'JOB_CANCEL':
      // User-initiated cancel — keep the partial draft / events for
      // inspection but flip out of the busy state so the action button
      // moves from "Cancel" to "Reset Studio".
      return { ...s, job_status: 'cancelled', job_error: null };
    case 'JOB_RESULT':
      return {
        ...s,
        crew_done: true,
        job_status: 'completed',
        run_id: a.run_id,
        post_draft: a.post_draft,
        image_prompt: a.image_prompt,
        emotional_beats: a.emotional_beats ?? [],
        cost: a.cost ?? s.cost,
      };
    case 'IMAGE_ADDED':
      return {
        ...s,
        images: [...s.images, a.image],
        cost: a.cost ?? s.cost,
      };

    case 'RESET':
      return { ...INITIAL };

    case 'RESET_SCOUT':
      // Scout-only reset: drop scout outputs + active job. Inputs the user
      // configured (selected modules, time window) are preserved so the
      // next run reuses them. Studio slice is untouched.
      return {
        ...s,
        pulse_md: '',
        pulse_done: false,
        scout_job_id: null,
        scout_status: 'idle',
        scout_progress_step: 0,
        scout_progress_total: 1,
        scout_progress_message: '',
        scout_progress_module: '',
        scout_callbacks: [],
        scout_error: null,
        scout_briefing: null,
        scout_cost: null,
        // Drop the "Imported from Scout" provenance — there's no scout
        // output backing it any more.
        imported_topic: '',
      };

    case 'RESET_STUDIO':
      // Studio-only reset: drop draft form + generated post + images + active
      // job + cost. Scout slice is untouched. Inputs go back to INITIAL
      // defaults so the form reads as a fresh draft, not stale text.
      return {
        ...s,
        topic: INITIAL.topic,
        leader_angle: INITIAL.leader_angle,
        author_vibe: INITIAL.author_vibe,
        audience: INITIAL.audience,
        imported_topic: '',
        current_job_id: null,
        job_status: 'idle',
        job_error: null,
        stage: 'queued',
        events: [],
        started_at_ms: null,
        run_id: '',
        post_draft: '',
        image_prompt: '',
        emotional_beats: [],
        images: [],
        image_quality: INITIAL.image_quality,
        crew_done: false,
        cost: null,
      };

    default:
      return s;
  }
}

function load(): DemoState {
  if (typeof window === 'undefined') return INITIAL;
  try {
    const rawAuthored = window.localStorage.getItem(STORAGE_KEY);
    const authored = rawAuthored
      ? (JSON.parse(rawAuthored) as Partial<DemoState>)
      : {};

    // Drop any runtime fields a legacy localStorage blob may still carry.
    // Runtime now lives in sessionStorage; we *do not* migrate the values
    // because resuming another tab's job on first mount of a fresh tab is
    // exactly the bug this split fixes.
    for (const f of RUNTIME_FIELDS) {
      delete (authored as Record<string, unknown>)[f];
    }

    let runtime: Partial<DemoState> = {};
    try {
      const rawRuntime = window.sessionStorage.getItem(RUNTIME_STORAGE_KEY);
      if (rawRuntime) runtime = JSON.parse(rawRuntime) as Partial<DemoState>;
    } catch {
      /* ignore */
    }

    const safeScoutCallbacks = Array.isArray(runtime.scout_callbacks)
      ? runtime.scout_callbacks
      : [];
    const safeScoutProgressMessage =
      typeof runtime.scout_progress_message === 'string'
        ? runtime.scout_progress_message
        : '';
    const safeScoutProgressModule =
      typeof runtime.scout_progress_module === 'string'
        ? runtime.scout_progress_module
        : '';

    // Sanity-clamp the time-window inputs. A previous build let invalid
    // values land in localStorage (e.g. an out-of-range number from a
    // mid-typing keystroke), which then re-hydrated on every page load
    // and made the default look like 729+ days instead of the intended
    // 7. Drop anything outside the schema's allowed range and fall back
    // to INITIAL.
    const VALID_UNITS = ['days', 'weeks', 'months', 'years'] as const;
    const rawPulseValue = (authored as Partial<DemoState>).pulse_value;
    const pulseValueOk =
      typeof rawPulseValue === 'number' &&
      Number.isFinite(rawPulseValue) &&
      rawPulseValue >= 1 &&
      rawPulseValue <= 730;
    if (!pulseValueOk) {
      delete (authored as Record<string, unknown>).pulse_value;
    }
    const rawPulseUnit = (authored as Partial<DemoState>).pulse_unit;
    if (!rawPulseUnit || !VALID_UNITS.includes(rawPulseUnit as typeof VALID_UNITS[number])) {
      delete (authored as Record<string, unknown>).pulse_unit;
    }

    // Authored fields override INITIAL; runtime overrides last so an
    // in-tab navigation picks the polling loop back up via the mount-resume
    // effects in ScoutPanel / ProductionStudio. A fresh tab finds
    // sessionStorage empty and starts idle.
    return {
      ...INITIAL,
      ...authored,
      ...runtime,
      scout_callbacks: safeScoutCallbacks,
      scout_progress_message: safeScoutProgressMessage,
      scout_progress_module: safeScoutProgressModule,
      events: Array.isArray(runtime.events) ? runtime.events : [],
    };
  } catch {
    return INITIAL;
  }
}

export function useDemoState() {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // Authored fields + completed outputs live in localStorage so drafts
      // survive tab close. New tabs are welcome to read this.
      const authored: Partial<DemoState> = {
        topic: state.topic,
        leader_angle: state.leader_angle,
        author_vibe: state.author_vibe,
        author_name: state.author_name,
        author_title: state.author_title,
        author_location: state.author_location,
        audience: state.audience,
        selected_modules: state.selected_modules,
        pulse_value: state.pulse_value,
        pulse_unit: state.pulse_unit,
        pulse_md: state.pulse_md,
        pulse_done: state.pulse_done,
        scout_briefing: state.scout_briefing,
        run_id: state.run_id,
        post_draft: state.post_draft,
        image_prompt: state.image_prompt,
        emotional_beats: state.emotional_beats,
        images: state.images,
        image_quality: state.image_quality,
        crew_done: state.crew_done,
        cost: state.cost,
        scout_cost: state.scout_cost,
        imported_topic: state.imported_topic,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(authored));

      // Runtime / in-flight fields live in sessionStorage — per-tab.
      const runtime: Partial<DemoState> = {
        scout_job_id: state.scout_job_id,
        scout_status: state.scout_status,
        scout_progress_step: state.scout_progress_step,
        scout_progress_total: state.scout_progress_total,
        scout_progress_message: state.scout_progress_message,
        scout_progress_module: state.scout_progress_module,
        scout_callbacks: state.scout_callbacks,
        scout_error: state.scout_error,
        current_job_id: state.current_job_id,
        job_status: state.job_status,
        job_error: state.job_error,
        stage: state.stage,
        events: state.events,
        started_at_ms: state.started_at_ms,
      };
      window.sessionStorage.setItem(
        RUNTIME_STORAGE_KEY,
        JSON.stringify(runtime),
      );
    } catch {
      /* quota / disabled — drop persistence */
    }
  }, [state]);

  return [state, dispatch] as const;
}

export function clearDemoState() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.sessionStorage.removeItem(RUNTIME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
