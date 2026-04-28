import { apiFetch } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_LINKEDIN_API ?? '/linkedin-generator';

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
