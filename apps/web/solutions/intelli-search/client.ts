import { apiFetch, ApiError, streamSSE } from '@/lib/api';
import { suggestFromList } from './data/suggestions';

const BASE = process.env.NEXT_PUBLIC_INTELLI_SEARCH_API ?? '/intelli-search';

export type SearchMode = 'regular' | 'semantic' | 'agentic' | 'auto';

export interface UserFilters {
  country?: string;
  state?: string;
  city?: string;
  industries?: string[];
  size_range?: string;
  year_from?: number;
  year_to?: number;
}

export interface LinkedinProfile {
  description?: string;
  headquarters?: string;
  company_size?: string;
  industry?: string;
  website?: string;
  founded_year?: number;
  specialties?: string[];
  recent_updates?: string;
  linkedin_url?: string;
  [k: string]: unknown;
}

export interface SearchHit {
  id: string;
  score: number;
  title?: string;
  company?: string;
  domain?: string;
  industry?: string;
  country?: string;
  locality?: string;
  location?: string;
  year_founded?: number;
  size_range?: string;
  summary?: string;
  matching_reason?: string;
  url?: string;
  linkedin_url?: string;
  current_employee_estimate?: number;
  search_method?: string;
  ranking_source?: string;
  linkedin_profile?: LinkedinProfile;
  event_data?: Record<string, unknown>;
  // Full backend payload for the "Raw response" tab
  raw?: BackendResult;
}

export interface SearchResponseMetadata {
  response_time_ms?: number;
  total_results?: number;
  query_classification?: {
    category?: string;
    confidence?: number;
    reasoning?: string;
    needs_external_data?: boolean;
    classified_by?: 'regex' | 'llm';
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  hits: SearchHit[];
  duration_ms: number;
  classifier_intent?: string;
  confidence?: number;
  needs_external_data?: boolean;
  metadata?: SearchResponseMetadata;
  raw?: BackendSearchResponse;
}

export interface SearchRequest {
  query: string;
  mode?: SearchMode;
  size?: number;
  page?: number;
  filters?: UserFilters;
}

export interface FacetBucket {
  key?: string;
  doc_count?: number;
  value?: string;
  count?: number;
}

function facetLabel(bucket: FacetBucket): string | undefined {
  // Backend currently emits { value, count }, but keep support for
  // standard OpenSearch-shaped { key, doc_count } as well.
  return bucket.value ?? bucket.key;
}

interface BackendResult {
  id?: string;
  name?: string;
  title?: string;
  company?: string;
  domain?: string;
  industry?: string;
  country?: string;
  locality?: string;
  location?: string;
  relevance_score?: number;
  score?: number;
  year_founded?: number;
  size_range?: number | string;
  matching_reason?: string;
  summary?: string;
  url?: string;
  linkedin_url?: string;
  current_employee_estimate?: number;
  search_method?: string;
  ranking_source?: string;
  linkedin_profile?: LinkedinProfile;
  event_data?: Record<string, unknown>;
}

interface BackendSearchResponse {
  query?: string;
  mode?: SearchMode;
  hits?: BackendResult[];
  results?: BackendResult[];
  duration_ms?: number;
  classifier_intent?: string;
  metadata?: SearchResponseMetadata;
  status?: string;
}

function normalizeHit(r: BackendResult, i: number): SearchHit {
  // Backend may also tuck linkedin_url under linkedin_profile; surface either.
  const linkedinUrl = r.linkedin_url ?? r.linkedin_profile?.linkedin_url;
  return {
    id: r.id ?? r.domain ?? `result-${i}`,
    score: r.score ?? r.relevance_score ?? 0,
    title: r.title ?? r.name ?? r.domain,
    company: r.company ?? r.name,
    domain: r.domain,
    industry: r.industry,
    country: r.country,
    locality: r.locality,
    // Display ONLY locality in result rows — country shown via filter chips.
    location: r.locality ?? r.location,
    year_founded: r.year_founded,
    size_range: r.size_range != null ? String(r.size_range) : undefined,
    summary: r.summary ?? r.matching_reason,
    matching_reason: r.matching_reason,
    url: r.url ?? (r.domain ? `https://${r.domain}` : undefined),
    linkedin_url: linkedinUrl,
    current_employee_estimate: r.current_employee_estimate,
    search_method: r.search_method,
    ranking_source: r.ranking_source,
    linkedin_profile: r.linkedin_profile,
    event_data: r.event_data,
    raw: r,
  };
}

function buildResponse(raw: BackendSearchResponse, req: SearchRequest): SearchResponse {
  const list = (raw.hits ?? raw.results ?? []) as BackendResult[];
  const hits = list.map(normalizeHit);
  const cls = raw.metadata?.query_classification;
  return {
    query: raw.query ?? req.query,
    mode: raw.mode ?? req.mode ?? 'auto',
    hits,
    duration_ms: raw.duration_ms ?? raw.metadata?.response_time_ms ?? 0,
    classifier_intent: raw.classifier_intent ?? cls?.category,
    confidence: cls?.confidence,
    needs_external_data: cls?.needs_external_data,
    metadata: raw.metadata,
    raw,
  };
}

export async function searchIntelligent(
  req: SearchRequest,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const body = {
    query: req.query,
    limit: req.size ?? 20,
    page: req.page ?? 1,
    include_reasoning: true,
    include_trace: false,
    filters: req.filters,
  };
  const raw = await apiFetch<BackendSearchResponse>(`${BASE}/api/search/intelligent`, {
    method: 'POST',
    body: JSON.stringify(body),
    signal,
    timeoutMs: 60_000,
  });
  return buildResponse(raw, req);
}

/**
 * SSE event union — mirrors backend `_event_generator()` shapes.
 * `progress` covers all classification / embedding / vector_search phases.
 */
export type StreamEvent =
  | { type: 'progress'; phase: string; message: string }
  | { type: 'results'; data: BackendSearchResponse }
  | { type: 'error'; detail: string }
  | { type: string; [key: string]: unknown };

export interface StreamHandlers {
  onEvent: (e: StreamEvent) => void;
  onResults: (r: SearchResponse) => void;
  onError?: (e: Error) => void;
  signal?: AbortSignal;
}

/**
 * POST-streaming search — backend `/api/search/intelligent/stream` accepts a
 * JSON body with filters/page/limit. The `results` event carries the full
 * SearchResponse, which we hand back already-normalized so callers don't need
 * a second POST.
 */
export function streamSearch(req: SearchRequest, h: StreamHandlers): () => void {
  const body = JSON.stringify({
    query: req.query,
    limit: req.size ?? 20,
    page: req.page ?? 1,
    include_reasoning: true,
    filters: req.filters,
  });
  return streamSSE(
    `${BASE}/api/search/intelligent/stream`,
    (line) => {
      let evt: StreamEvent;
      try {
        evt = JSON.parse(line) as StreamEvent;
      } catch {
        evt = { type: 'progress', phase: 'unknown', message: line };
      }
      h.onEvent(evt);
      if (evt.type === 'results') {
        const data = (evt as { data?: BackendSearchResponse }).data ?? {};
        h.onResults(buildResponse(data, req));
      } else if (evt.type === 'error') {
        h.onError?.(new Error((evt as { detail?: string }).detail ?? 'stream error'));
      }
    },
    {
      method: 'POST',
      body,
      onError: h.onError,
      signal: h.signal,
    },
  );
}

export async function getIndustryFacets(signal?: AbortSignal): Promise<string[]> {
  const raw = await apiFetch<{ industries?: FacetBucket[] }>(`${BASE}/api/search/facets/industries`, {
    signal,
    timeoutMs: 20_000,
  });
  return (raw.industries ?? [])
    .map((b) => facetLabel(b))
    .filter((v): v is string => Boolean(v));
}

export async function getCountryFacets(signal?: AbortSignal): Promise<string[]> {
  const raw = await apiFetch<{ countries?: FacetBucket[] }>(`${BASE}/api/search/facets/countries`, {
    signal,
    timeoutMs: 20_000,
  });
  return (raw.countries ?? [])
    .map((b) => facetLabel(b))
    .filter((v): v is string => Boolean(v));
}

export async function getStateFacets(country: string, signal?: AbortSignal): Promise<string[]> {
  if (!country.trim()) return [];
  const params = new URLSearchParams({ country });
  const raw = await apiFetch<{ states?: FacetBucket[] }>(
    `${BASE}/api/search/facets/states?${params.toString()}`,
    {
      signal,
      timeoutMs: 20_000,
    },
  );
  return (raw.states ?? [])
    .map((b) => facetLabel(b))
    .filter((v): v is string => Boolean(v));
}

/**
 * Autocomplete — static client-side list (parity with the original Vite UI,
 * which filters a baked-in suggestion array; no backend roundtrip).
 */
export async function getAutocompleteSuggestions(
  q: string,
  _signal?: AbortSignal,
): Promise<string[]> {
  void _signal;
  return suggestFromList(q);
}

// Re-export so callers that imported ApiError keep working.
export { ApiError };
