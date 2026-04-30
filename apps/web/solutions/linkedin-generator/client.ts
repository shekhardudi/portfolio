import { apiFetch, ApiError } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_LINKEDIN_API ?? '/linkedin-generator';

/** Public for the Demo's "Open live app ↗" fallback links. */
export const LINKEDIN_API_BASE = BASE;

export interface GenerateRequest {
  topic: string;
  leader_angle: string;
  author_name?: string;
  author_title?: string;
  author_location?: string;
  author_vibe?: string;
}

export interface GenerateAck {
  job_id: string;
  status: 'queued';
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  job_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  request: GenerateRequest;
  result?: string;
  error?: string;
}

export function generate(req: GenerateRequest) {
  return apiFetch<GenerateAck>(`${BASE}/generate`, {
    method: 'POST',
    body: JSON.stringify(req),
    timeoutMs: 15_000,
  });
}

export function getJob(id: string) {
  return apiFetch<JobRecord>(`${BASE}/jobs/${id}`);
}

/**
 * Poll a job until it reaches a terminal state. Calls onTick per poll so the
 * UI can show elapsed time / status. Throws on timeout.
 */
export async function pollJob(
  id: string,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (job: JobRecord) => void;
    signal?: AbortSignal;
  } = {},
): Promise<JobRecord> {
  const { intervalMs = 3_000, timeoutMs = 240_000, onTick, signal } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('aborted');
    const job = await getJob(id);
    onTick?.(job);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`polling timed out after ${Math.round(timeoutMs / 1000)}s`);
}

// ---------------------------------------------------------------------------
// Scout & image — endpoints under "backend follow-ups" in the upgrade plan.
// We attempt the call; if the backend doesn't expose it yet (404 / network),
// the Demo surfaces a "Run on live app ↗" fallback link.
// ---------------------------------------------------------------------------

export class EndpointMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndpointMissingError';
  }
}

export interface ScoutRunRequest {
  modules: string[];
  days: number;
}

export interface ScoutAck {
  job_id: string;
  status: 'queued';
}

export interface ScoutJobRecord {
  job_id: string;
  status: JobStatus;
  result_md?: string;
  error?: string;
}

async function tryEndpoint<T>(path: string, init: RequestInit, timeoutMs?: number) {
  try {
    return await apiFetch<T>(`${BASE}${path}`, { ...init, timeoutMs });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
      throw new EndpointMissingError(`backend missing ${path}`);
    }
    throw e;
  }
}

export function scoutRun(req: ScoutRunRequest) {
  return tryEndpoint<ScoutAck>('/scout/run', {
    method: 'POST',
    body: JSON.stringify(req),
  }, 15_000);
}

export function getScoutJob(id: string) {
  return tryEndpoint<ScoutJobRecord>(`/scout/jobs/${id}`, {});
}

export async function pollScoutJob(
  id: string,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (job: ScoutJobRecord) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ScoutJobRecord> {
  const { intervalMs = 3_000, timeoutMs = 300_000, onTick, signal } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('aborted');
    const job = await getScoutJob(id);
    onTick?.(job);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('scout polling timed out');
}

export function generateImage(prompt: string) {
  return tryEndpoint<{ image_url: string }>('/image/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  }, 60_000);
}
