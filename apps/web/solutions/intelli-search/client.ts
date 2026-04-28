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

export interface SearchRequest {
  query: string;
  mode?: SearchMode;
  size?: number;
}

export function searchIntelligent(req: SearchRequest, signal?: AbortSignal) {
  return apiFetch<SearchResponse>(`${BASE}/search/intelligent`, {
    method: 'POST',
    body: JSON.stringify(req),
    signal,
    timeoutMs: 60_000,
  });
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
    `${BASE}/search/intelligent/stream?${params.toString()}`,
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
