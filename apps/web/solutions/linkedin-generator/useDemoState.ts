'use client';

import { useEffect, useReducer } from 'react';
import { MODULE_OPTIONS } from './modules';

const STORAGE_KEY = 'linkedin-demo-v1';

export interface CostUsage {
  input_tokens: number;
  output_tokens: number;
  usd: number;
}

export interface DemoState {
  // Scout
  pulse_md: string;
  pulse_done: boolean;
  selected_modules: string[]; // ScoutModule.key
  pulse_value: number;
  pulse_unit: 'days' | 'weeks' | 'months' | 'years';

  // Studio (Authority Crew)
  imported_topic: string;
  topic: string;
  leader_angle: string;
  author_vibe: string;
  author_name: string;
  author_title: string;
  author_location: string;
  current_job_id: string | null;
  job_status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
  job_error: string | null;

  // Output
  post_draft: string;
  dalle_prompt: string;
  image_url: string;
  crew_done: boolean;

  // Cost tracking (client-side estimate)
  cost: CostUsage;
}

const INITIAL: DemoState = {
  pulse_md: '',
  pulse_done: false,
  selected_modules: MODULE_OPTIONS.map((m) => m.key),
  pulse_value: 7,
  pulse_unit: 'days',

  imported_topic: '',
  topic: 'Agentic AI workflows',
  leader_angle:
    'Why most agentic systems are overengineered for the problems they actually solve',
  author_vibe: 'calm, direct, and slightly skeptical',
  author_name: 'Shekhar Dudi',
  author_title: 'AI Engineer',
  author_location: 'Remote',
  current_job_id: null,
  job_status: 'idle',
  job_error: null,

  post_draft: '',
  dalle_prompt: '',
  image_url: '',
  crew_done: false,

  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

export type DemoAction =
  | { type: 'PATCH'; payload: Partial<DemoState> }
  | { type: 'IMPORT_TOPIC'; topic: string }
  | { type: 'JOB_START'; job_id: string }
  | { type: 'JOB_STATUS'; status: DemoState['job_status']; error?: string }
  | { type: 'JOB_RESULT'; raw: string }
  | { type: 'ADD_COST'; input: number; output: number; usd: number }
  | { type: 'RESET' };

function reducer(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case 'PATCH':
      return { ...s, ...a.payload };
    case 'IMPORT_TOPIC':
      return { ...s, imported_topic: a.topic, topic: a.topic };
    case 'JOB_START':
      return {
        ...s,
        current_job_id: a.job_id,
        job_status: 'queued',
        job_error: null,
        crew_done: false,
      };
    case 'JOB_STATUS':
      return { ...s, job_status: a.status, job_error: a.error ?? null };
    case 'JOB_RESULT':
      // Caller usually follows up with a PATCH to set post_draft etc.
      return { ...s, crew_done: true, job_status: 'succeeded' };
    case 'ADD_COST':
      return {
        ...s,
        cost: {
          input_tokens: s.cost.input_tokens + a.input,
          output_tokens: s.cost.output_tokens + a.output,
          usd: s.cost.usd + a.usd,
        },
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
    return { ...INITIAL, ...parsed };
  } catch {
    return INITIAL;
  }
}

export function useDemoState() {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota or disabled — drop persistence */
    }
  }, [state]);

  return [state, dispatch] as const;
}

export function clearDemoState() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
