'use client';

import { useEffect, useReducer } from 'react';
import { MODULE_OPTIONS } from './modules';
import type { AgentEvent, CostBreakdown, JobStatus, PostStage } from './client';

const STORAGE_KEY = 'linkedin-demo-v2';

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
  | { type: 'IMPORT_TOPIC'; topic: string }
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
  | { type: 'SCOUT_DONE'; report_md: string; cost?: CostBreakdown | null }
  | { type: 'SCOUT_FAIL'; error: string }
  // Posts
  | { type: 'JOB_START'; job_id: string }
  | {
      type: 'JOB_TICK';
      status: JobStatus;
      stage?: PostStage;
      events?: AgentEvent[];
    }
  | { type: 'JOB_FAIL'; error: string }
  | {
      type: 'JOB_RESULT';
      run_id: string;
      post_draft: string;
      image_prompt: string;
      emotional_beats?: string[];
      cost?: CostBreakdown | null;
    }
  | { type: 'IMAGE_ADDED'; image: GeneratedImage; cost?: CostBreakdown | null }
  | { type: 'RESET' };

function reducer(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case 'PATCH':
      return { ...s, ...a.payload };
    case 'IMPORT_TOPIC':
      return {
        ...s,
        imported_topic: a.topic,
        topic: a.topic,
        leader_angle: '',
        author_vibe: '',
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
      };
    case 'SCOUT_FAIL':
      return {
        ...s,
        scout_status: 'failed',
        scout_error: a.error,
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
    default:
      return s;
  }
}

function load(): DemoState {
  if (typeof window === 'undefined') return INITIAL;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL;
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    const safeScoutCallbacks = Array.isArray(parsed.scout_callbacks) ? parsed.scout_callbacks : [];
    const safeScoutProgressMessage = typeof parsed.scout_progress_message === 'string'
      ? parsed.scout_progress_message
      : '';
    const safeScoutProgressModule = typeof parsed.scout_progress_module === 'string'
      ? parsed.scout_progress_module
      : '';
    // Don't restore in-flight job state — those job IDs may be gone server-side.
    return {
      ...INITIAL,
      ...parsed,
      scout_callbacks: safeScoutCallbacks,
      scout_progress_message: safeScoutProgressMessage,
      scout_progress_module: safeScoutProgressModule,
      current_job_id: null,
      job_status: 'idle',
      job_error: null,
      events: [],
      started_at_ms: null,
      scout_job_id: null,
      scout_status: 'idle',
      scout_error: null,
    };
  } catch {
    return INITIAL;
  }
}

export function useDemoState() {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      // Persist user-authored fields + completed outputs only.
      const persistable: Partial<DemoState> = {
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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch {
      /* quota / disabled — drop persistence */
    }
  }, [state]);

  return [state, dispatch] as const;
}

export function clearDemoState() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
