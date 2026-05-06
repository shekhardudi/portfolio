/**
 * Typed client for the upgraded LinkedIn Post Generator backend.
 *
 * Backend mounts everything under /api/v1. Set `NEXT_PUBLIC_LINKEDIN_API` to
 * the host (e.g. `http://localhost:8000`); we append the version prefix here.
 */

import { apiFetch, ApiError } from '@/lib/api';

const HOST = process.env.NEXT_PUBLIC_LINKEDIN_API ?? '';
const BASE = `${HOST}/api/v1`;

/** Public for the Demo's "Open live app ↗" fallback links. */
export const LINKEDIN_API_BASE = HOST || '/';

export class EndpointMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndpointMissingError';
  }
}

/** Optional session metadata threaded through every call. */
export interface SessionTag {
  sessionVersion?: number;
  anonymousVisitId?: string;
}

async function tryEndpoint<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
  tag: SessionTag = {},
) {
  try {
    return await apiFetch<T>(`${BASE}${path}`, {
      ...init,
      timeoutMs,
      sessionVersion: tag.sessionVersion,
      anonymousVisitId: tag.anonymousVisitId,
    });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
      throw new EndpointMissingError(`backend missing ${path}`);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: string;
  version: string;
  scout_backend: string;
  keys_present: Record<string, boolean>;
  ollama_reachable?: boolean | null;
}

export function health() {
  return tryEndpoint<HealthResponse>('/health', {}, 5_000);
}

// ---------------------------------------------------------------------------
// Scout
// ---------------------------------------------------------------------------

export interface ScoutRequest {
  modules: string[];
  days: number;
}

export interface ScoutAck {
  job_id: string;
  status: string;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScoutJob {
  job_id: string;
  kind: 'scout';
  status: JobStatus;
  created_at: string;
  updated_at: string;
  progress: {
    step?: number;
    total?: number;
    module?: string;
    phase?: string;
    message?: string;
    callbacks?: Array<{
      ts: string;
      module: string;
      phase: string;
      message: string;
    }>;
  };
  result?: {
    report_md: string;
    modules: string[];
    days: number;
    cost_breakdown?: CostBreakdown;
    briefing?: ScoutBriefing;
  };
  error?: string;
}

/**
 * Pickable post-topic categories — drives renderer grouping + UI affordances.
 * Mirrors `SignalCategory` in services/linkedin-generator/backend/scout/types.py.
 */
export type SignalCategory =
  | 'release'
  | 'research'
  | 'tool'
  | 'debate'
  | 'lesson'
  | 'strategy';

export type FindingNovelty = 'new' | 'follow_up' | 'stale';

/** Atomic structured fact extracted from raw scanner items. */
export interface ScoutFinding {
  id: string;
  claim: string;
  source_url?: string;
  source_label?: string;
  module?: string;
  novelty?: FindingNovelty;
  confidence?: number;
  why_it_matters?: string;
}

/** A pickable, post-ready story — one click → LinkedIn post. */
export interface ScoutSignal {
  id: string;
  category: SignalCategory;
  headline: string;
  summary: string;
  /** Ready-to-paste LinkedIn hook (1–2 sentences). Maps to "Your take". */
  post_angle: string;
  finding_ids: string[];
  primary_module?: string;
}

export interface ScoutTheme {
  title: string;
  summary: string;
  finding_ids: string[];
}

export interface ScoutTension {
  title: string;
  summary: string;
  finding_ids: string[];
}

/**
 * Structured briefing returned alongside the markdown report. Mirrors the
 * `Briefing` Pydantic model in the backend. Driving the UI from this object
 * (instead of re-parsing the markdown) is what makes per-signal / per-finding
 * picking possible.
 */
export interface ScoutBriefing {
  schema_version?: number;
  /** One-paragraph executive summary at the top of the briefing. */
  lead?: string;
  signals?: ScoutSignal[];
  themes?: ScoutTheme[];
  tensions?: ScoutTension[];
  gaps?: string[];
  action_items?: string[];
  findings?: ScoutFinding[];
  modules_used?: string[];
  /** module_id → count of items contributed to the synthesis */
  module_activity?: Record<string, number>;
  memory_signals?: Record<string, unknown>;
  /** Allow forward-compat additions without forcing a client release. */
  [key: string]: unknown;
}

export function startScout(body: ScoutRequest, tag: SessionTag = {}) {
  return tryEndpoint<ScoutAck>(
    '/scout',
    { method: 'POST', body: JSON.stringify(body) },
    15_000,
    tag,
  );
}

export function getScout(id: string, tag: SessionTag = {}) {
  return tryEndpoint<ScoutJob>(
    `/scout/${encodeURIComponent(id)}`,
    {},
    60_000,
    tag,
  );
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export interface PostRequest {
  topic: string;
  leader_angle: string;
  author_name: string;
  author_title: string;
  author_location: string;
  author_vibe: string;
  audience: 'engineering' | 'business';
}

export interface PostAck {
  job_id: string;
  status: string;
}

/** Single agent-stream event emitted by the backend during a post run. */
export interface AgentEvent {
  ts: string;
  /** thought | tool | tool_started | tool_result | answer | task_done | stage | step | agent_started | reasoning */
  kind: string;
  /** Agent role/name. May be "—" when unknown. */
  agent: string;
  text: string;
  cls?: string;
}

export type PostStage = 'queued' | 'research' | 'writing' | 'critique' | 'visual_director';

export interface PostProgress {
  stage?: PostStage;
  run_id?: string;
  events?: AgentEvent[];
}

export interface CostBreakdown {
  scout?: { model?: string; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number };
  crew?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number };
  visual_director?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number };
  image?: { calls: number; cost_usd: number };
  total_cost_usd: number;
}

export interface PostResult {
  run_id: string;
  post_draft: string;
  image_prompt: string;
  image_plan?: Record<string, unknown>;
  emotional_beats?: string[];
  raw_crew_output?: string;
  cost_breakdown?: CostBreakdown;
  /** Some result snapshots (after image gen) carry image paths. */
  image_paths?: string[];
}

export interface PostJob {
  job_id: string;
  kind: 'posts';
  status: JobStatus;
  created_at: string;
  updated_at: string;
  progress: PostProgress;
  result?: PostResult;
  error?: string;
}

export function startPost(body: PostRequest, tag: SessionTag = {}) {
  return tryEndpoint<PostAck>(
    '/posts',
    { method: 'POST', body: JSON.stringify(body) },
    15_000,
    tag,
  );
}

export function getPost(id: string, tag: SessionTag = {}) {
  return tryEndpoint<PostJob>(
    `/posts/${encodeURIComponent(id)}`,
    {},
    60_000,
    tag,
  );
}

export function updatePost(
  id: string,
  post_draft: string,
  tag: SessionTag = {},
) {
  return tryEndpoint<PostJob>(
    `/posts/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ post_draft }) },
    undefined,
    tag,
  );
}

/**
 * Best-effort backend cancel. Frees the worker slot in real time. Errors are
 * swallowed by the caller \u2014 the version guard already protects against any
 * stale results that slip through.
 */
export async function cancelScout(id: string, tag: SessionTag = {}): Promise<void> {
  try {
    await tryEndpoint<unknown>(
      `/scout/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      10_000,
      tag,
    );
  } catch {
    /* best-effort */
  }
}

export async function cancelPost(id: string, tag: SessionTag = {}): Promise<void> {
  try {
    await tryEndpoint<unknown>(
      `/posts/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      10_000,
      tag,
    );
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface ImageRequest {
  job_id: string;
  prompt: string;
  /** "low" | "medium" | "high" — blank uses backend default. */
  quality?: '' | 'low' | 'medium' | 'high';
}

export interface ImageResponse {
  image_id: string;
  image_url: string;
  run_id: string;
}

export function generateImage(body: ImageRequest, tag: SessionTag = {}) {
  return tryEndpoint<ImageResponse>(
    '/images',
    { method: 'POST', body: JSON.stringify(body) },
    120_000,
    tag,
  );
}

export function imageHref(image_id_or_url: string): string {
  if (image_id_or_url.startsWith('http') || image_id_or_url.startsWith('/api/')) {
    return image_id_or_url.startsWith('http')
      ? image_id_or_url
      : `${HOST}${image_id_or_url}`;
  }
  return `${BASE}/images/${encodeURIComponent(image_id_or_url)}`;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryRow {
  run_id: string;
  created_at: string;
  topic: string;
  leader_angle: string;
  audience: string;
  post_path?: string | null;
  image_paths: string[];
  cost_breakdown?: CostBreakdown | null;
  models?: Record<string, string> | null;
}

export function listHistory(limit = 50, tag: SessionTag = {}) {
  return tryEndpoint<HistoryRow[]>(
    `/history?limit=${limit}`,
    {},
    10_000,
    tag,
  );
}
