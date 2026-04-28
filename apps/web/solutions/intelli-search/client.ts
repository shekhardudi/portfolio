import { apiFetch, streamSSE } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_INTELLI_SEARCH_API ?? '/intelli-search';

export type SearchMode = 'regular' | 'semantic' | 'agentic' | 'auto';

export interface SearchHit {
  id: string;
  score: number;
  title?: string;
  company?: string;
  location?: string;
  summary?: string;
  url?: string;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  hits: SearchHit[];
  duration_ms: number;
  classifier_intent?: string;
}

interface BackendResult {
  id?: string;
  name?: string;
  title?: string;
  company?: string;
  domain?: string;
  country?: string;
  locality?: string;
  location?: string;
  relevance_score?: number;
  score?: number;
  matching_reason?: string;
  summary?: string;
  url?: string;
}

interface BackendSearchResponse {
  query?: string;
  mode?: SearchMode;
  hits?: SearchHit[];
  results?: BackendResult[];
  duration_ms?: number;
  classifier_intent?: string;
  metadata?: {
    response_time_ms?: number;
    query_classification?: {
      category?: string;
    };
  };
}

export interface SearchRequest {
  query: string;
  mode?: SearchMode;
  size?: number;
}

export async function searchIntelligent(req: SearchRequest, signal?: AbortSignal) {
  const raw = await apiFetch<BackendSearchResponse>(`${BASE}/api/search/intelligent`, {
    method: 'POST',
    body: JSON.stringify(req),
    signal,
    timeoutMs: 60_000,
  });

  const hits = Array.isArray(raw.hits)
    ? raw.hits
    : Array.isArray(raw.results)
      ? raw.results.map((r, i) => ({
          id: r.id ?? r.domain ?? `result-${i}`,
          score: r.score ?? r.relevance_score ?? 0,
          title: r.title ?? r.name ?? r.domain,
          company: r.company ?? r.name,
          location:
            r.location ??
            ([r.locality, r.country].filter(Boolean).join(', ') || undefined),
          summary: r.summary ?? r.matching_reason,
          url: r.url ?? (r.domain ? `https://${r.domain}` : undefined),
        }))
      : [];

  return {
    query: raw.query ?? req.query,
    mode: raw.mode ?? req.mode ?? 'auto',
    hits,
    duration_ms: raw.duration_ms ?? raw.metadata?.response_time_ms ?? 0,
    classifier_intent: raw.classifier_intent ?? raw.metadata?.query_classification?.category,
  } satisfies SearchResponse;
}

export function streamSearch(
  req: SearchRequest,
  onEvent: (data: unknown) => void,
  opts: { onError?: (e: Error) => void; signal?: AbortSignal } = {},
) {
  const params = new URLSearchParams({
    query: req.query,
    mode: req.mode ?? 'auto',
    size: String(req.size ?? 10),
  });
  return streamSSE(
    `${BASE}/api/search/intelligent/stream?${params.toString()}`,
    (line) => {
      try {
        onEvent(JSON.parse(line));
      } catch {
        onEvent(line);
      }
    },
    opts,
  );
}
