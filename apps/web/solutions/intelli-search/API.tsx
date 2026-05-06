'use client';

// ── Request bodies ──────────────────────────────────────────────────────────

const REGULAR_REQUEST = `// Regular — short, specific (routes to BM25 lexical search)
POST /api/search/intelligent
{
  "query": "Apple Inc",
  "limit": 10,
  "page": 1,
  "include_reasoning": true
}`;

const SEMANTIC_REQUEST = `// Semantic — conceptual / natural language (routes to vector k-NN + RRF)
POST /api/search/intelligent
{
  "query": "Tech companies in France building enterprise copilots",
  "limit": 20,
  "page": 1,
  "include_reasoning": true,
  "filters": {
    "country": "France",
    "industries": ["Artificial Intelligence", "Enterprise Software"],
    "year_from": 2015
  }
}`;

const AGENTIC_REQUEST = `// Agentic — time-sensitive / external data (routes to tool-calling agent)
POST /api/search/intelligent
{
  "query": "companies that raised Series B funding recently",
  "limit": 15,
  "page": 1,
  "include_reasoning": true
}`;

const SEARCH_RESPONSE = `// 200 OK
{
  "query": "Tech companies in France",
  "status": "success",
  "results": [
    {
      "id": "c_8f2a1",
      "name": "Mistral AI",
      "domain": "mistral.ai",
      "industry": "Artificial Intelligence",
      "country": "France",
      "locality": "Paris",
      "relevance_score": 0.97,
      "search_method": "semantic",
      "ranking_source": "hybrid-rrf",
      "matching_reason": "French LLM startup; matches conceptual AI query.",
      "year_founded": 2023,
      "size_range": "51-200",
      "current_employee_estimate": 140,
      "linkedin_url": "https://linkedin.com/company/mistral-ai"
    }
  ],
  "metadata": {
    "trace_id": "trc_9a3b…",
    "query_classification": { "category": "semantic", "confidence": 0.93 },
    "search_execution": {
      "strategy": "Semantic-Hybrid-RRF",
      "score_range": { "min": 0.61, "max": 0.97 }
    },
    "total_results": 18,
    "response_time_ms": 142,
    "page": 1,
    "limit": 20
  }
}`;

// ── SSE streaming ───────────────────────────────────────────────────────────

const STREAM_REQUEST = `POST /api/search/intelligent/stream
{
  "query": "companies that raised funding recently",
  "limit": 15,
  "page": 1,
  "include_reasoning": true
}`;

const STREAM_EVENTS = `// Server-Sent Events — connect with EventSource
data: {"type":"progress","phase":"started","message":"Search started…"}
: heartbeat
data: {"type":"progress","phase":"classify","message":"Query classified as agentic"}
data: {"type":"progress","phase":"fetch","message":"Fetching recent funding rounds…"}
data: {"type":"results","data":{ ...SearchResponse... }}

// On failure
data: {"type":"error","detail":"Search failed."}`;

// ── Basic search ────────────────────────────────────────────────────────────

const BASIC_REQUEST = `POST /api/search/basic
{
  "query": "fintech",
  "filters": {
    "industry": "Financial Services",
    "country": "United Kingdom",
    "size_range": "51-200"
  },
  "limit": 20,
  "page": 1
}`;

// ── Diagnostics responses ───────────────────────────────────────────────────

const HEALTH_RESPONSE = `// GET /api/search/health
{ "status": "healthy", "service": "search-orchestrator", "version": "2.0.0" }`;

const FEATURES_RESPONSE = `// GET /api/search/features
{
  "features": {
    "query_classification": true, "semantic_search": true,
    "agentic_search": true, "result_caching": true, "tracing": true
  },
  "models": {
    "classifier": "gpt-4o-mini",
    "embedding": "text-embedding-3-small",
    "embedding_dimension": 768
  },
  "search_strategies": [
    { "name": "Regular",  "type": "regular",  "latency_ms": "10-50"   },
    { "name": "Semantic", "type": "semantic", "latency_ms": "50-200"  },
    { "name": "Agentic",  "type": "agentic",  "latency_ms": "100-500+" }
  ]
}`;

// ── curl quick-tests ────────────────────────────────────────────────────────

const CURL_REGULAR = `# Regular (BM25 lexical)
curl -sX POST "$API/api/search/intelligent" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"Stripe","limit":5}' | jq .metadata`;

const CURL_SEMANTIC = `# Semantic with filters (vector k-NN + RRF)
curl -sX POST "$API/api/search/intelligent" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "AI companies in California building copilots",
    "limit": 20,
    "filters": { "country": "United States", "state": "California",
                 "industries": ["Artificial Intelligence"] }
  }' | jq '{total:.metadata.total_results, strategy:.metadata.query_classification}'`;

const CURL_STREAM = `# Agentic search via SSE (curl -N disables buffering)
curl -N -sX POST "$API/api/search/intelligent/stream" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"companies that raised Series B recently","limit":10}'`;

const CURL_FACETS = `# Populate country dropdown
curl "$API/api/search/facets/countries" | jq .total

# States for a country
curl "$API/api/search/facets/states?country=United%20States" | jq .total

# Cities for a country + state
curl "$API/api/search/facets/cities?country=United%20States&state=California" | jq .total`;

// ── sub-components ──────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:    'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  POST:   'border-blue-500/40   bg-blue-500/10   text-blue-200',
  PATCH:  'border-amber-500/40  bg-amber-500/10  text-amber-200',
  DELETE: 'border-red-500/40    bg-red-500/10    text-red-200',
};

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide ${METHOD_COLORS[method]}`}
    >
      {method}
    </span>
  );
}

function Endpoint({
  method,
  path,
  summary,
  note,
}: {
  method: HttpMethod;
  path: string;
  summary: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <MethodBadge method={method} />
        <span className="font-mono text-sm text-foreground">{path}</span>
      </div>
      <p className="mt-2 text-sm text-foreground/85">{summary}</p>
      {note && <p className="mt-1 text-xs text-foreground/60">{note}</p>}
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground/65">
          {label}
        </p>
      )}
      <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-4 text-[13px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
      {children}
    </h3>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function API() {
  return (
    <div className="space-y-12">

      {/* Intro */}
      <div className="max-w-3xl space-y-3">
        <p className="text-base leading-relaxed text-foreground">
          IntelliSearch exposes a production-oriented search API built with FastAPI and OpenSearch.
          Every query is <strong>classified by intent</strong> and routed to the best strategy:{' '}
          fast BM25 lexical search, vector k-NN with Reciprocal Rank Fusion, or an{' '}
          <strong>agentic tool-calling pipeline</strong> for time-sensitive queries that need
          external data. Results always include confidence scores, reasoning, and full observability
          metadata in response headers.
        </p>
        <p className="text-sm text-foreground/80">
          Base URL:{' '}
          <code className="rounded bg-muted px-1 text-sm">NEXT_PUBLIC_INTELLI_SEARCH_API</code>{' '}
          env var (falls back to{' '}
          <code className="rounded bg-muted px-1 text-sm">/intelli-search</code> inside the web
          app). All search routes live under{' '}
          <code className="rounded bg-muted px-1 text-sm">/api/search/</code>. Version:{' '}
          <code className="rounded bg-muted px-1 text-sm">2.0.0</code>.
        </p>
      </div>

      {/* Intelligent search */}
      <section className="space-y-4">
        <SectionTitle>Intelligent search</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          The primary endpoint. Accepts a natural-language query plus optional user-selected
          filters, classifies intent, selects a strategy, and returns ranked results with metadata.
          User-supplied filters always take precedence over classifier-extracted ones.
        </p>
        <div className="grid gap-3">
          <Endpoint
            method="POST"
            path="/api/search/intelligent"
            summary="Classify intent → route to BM25, Hybrid-RRF, or Agentic strategy → return ranked results with confidence and reasoning."
            note="Timeout configurable via SEARCH_TIMEOUT setting. Returns 504 on timeout, 500 on internal error."
          />
          <Endpoint
            method="POST"
            path="/api/search/intelligent/stream"
            summary="Same search with live progress via Server-Sent Events. For non-agentic queries, emits one results event immediately."
            note="Connect with EventSource. Heartbeats keep long-lived connections alive during agent runs."
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <CodeBlock label="Regular query (BM25)" code={REGULAR_REQUEST} />
          <CodeBlock label="Semantic query (vector + RRF)" code={SEMANTIC_REQUEST} />
          <CodeBlock label="Agentic query (external tools)" code={AGENTIC_REQUEST} />
        </div>
        <CodeBlock label="Response shape" code={SEARCH_RESPONSE} />
      </section>

      {/* Strategy routing */}
      <section className="space-y-4">
        <SectionTitle>Strategy routing</SectionTitle>
        <ul className="space-y-2">
          {[
            ['Regular — BM25',        '10–50 ms',    'Short, specific names, acronyms, IDs. Fast lexical match.'],
            ['Semantic — Hybrid RRF', '50–200 ms',   'Conceptual / natural language. Vector k-NN fused with BM25 via RRF.'],
            ['Agentic — Tool call',   '100–500+ ms', 'Time-sensitive queries needing external data (news, funding events).'],
          ].map(([name, latency, desc]) => (
            <li
              key={name}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2"
            >
              <span className="font-mono text-[13px] text-foreground">{name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/70">{latency}</span>
              <span className="text-sm text-foreground/70">{desc}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Response headers */}
      <section className="space-y-4">
        <SectionTitle>Response headers</SectionTitle>
        <ul className="space-y-2">
          {[
            ['X-Trace-ID',         'Correlation id for distributed tracing'],
            ['X-Search-Logic',     'Strategy used (Regular-BM25, Semantic-Hybrid-RRF, Agentic-External-Tool)'],
            ['X-Confidence',       'Intent classification confidence (0.0–1.0)'],
            ['X-Response-Time-MS', 'End-to-end latency in milliseconds'],
            ['X-Total-Results',    'Number of results returned'],
          ].map(([header, desc]) => (
            <li
              key={header}
              className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2"
            >
              <span className="font-mono text-[13px] text-foreground">{header}</span>
              <span className="text-sm text-foreground/70">— {desc}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* SSE streaming */}
      <section className="space-y-4">
        <SectionTitle>Streaming contract (SSE)</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          Each <code className="rounded bg-muted px-1 text-sm">data:</code> frame is a JSON
          object. The stream always ends with either a{' '}
          <code className="rounded bg-muted px-1 text-sm">results</code> event (full{' '}
          <code className="rounded bg-muted px-1 text-sm">SearchResponse</code>) or an{' '}
          <code className="rounded bg-muted px-1 text-sm">error</code> event. SSE headers include{' '}
          <code className="rounded bg-muted px-1 text-sm">Cache-Control: no-cache</code> and{' '}
          <code className="rounded bg-muted px-1 text-sm">X-Accel-Buffering: no</code>.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeBlock label="Request" code={STREAM_REQUEST} />
          <CodeBlock label="Event stream" code={STREAM_EVENTS} />
        </div>
      </section>

      {/* Basic search */}
      <section className="space-y-4">
        <SectionTitle>Basic search</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          Deterministic BM25 search with explicit filters and faceted aggregations. Useful for
          filter-heavy workflows where classification overhead is not needed.
        </p>
        <div className="grid gap-3">
          <Endpoint
            method="POST"
            path="/api/search/basic"
            summary="Structured BM25 search with hard filters (industry, country, locality, year range, size). Returns results + aggregated facets."
          />
        </div>
        <CodeBlock label="Request" code={BASIC_REQUEST} />
      </section>

      {/* Facets */}
      <section className="space-y-4">
        <SectionTitle>Facet lookups</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          Cascade-aware facet endpoints for populating UI filter dropdowns. All results are
          aggregated directly from the OpenSearch index and cached in-process for 6 hours.
        </p>
        <div className="grid gap-3">
          <Endpoint method="GET" path="/api/search/facets/industries"
            summary="All distinct industry values in the index, sorted alphabetically." />
          <Endpoint method="GET" path="/api/search/facets/countries"
            summary="All distinct country values in the index." />
          <Endpoint method="GET" path="/api/search/facets/states?country={country}"
            summary="States/provinces for a given country. Required query param: country." />
          <Endpoint method="GET" path="/api/search/facets/cities?country={country}&state={state}"
            summary="Cities for a given country + state. Required query params: country, state." />
        </div>
      </section>

      {/* Diagnostics */}
      <section className="space-y-4">
        <SectionTitle>Diagnostics</SectionTitle>
        <div className="grid gap-3">
          <Endpoint method="GET" path="/api/search/health"
            summary='Returns {"status":"healthy","service":"search-orchestrator","version":"2.0.0"}.' />
          <Endpoint method="GET" path="/api/search/features"
            summary="Active feature flags, enabled strategies, and model names (classifier + embedding)." />
          <Endpoint method="GET" path="/api/search/index-stats"
            summary="OpenSearch index document count and size for the configured index." />
          <Endpoint method="GET" path="/api/search/top-queries?limit=10"
            summary="Most frequently searched queries with hit counts. Backed by Redis or in-memory fallback." />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeBlock label="Health response" code={HEALTH_RESPONSE} />
          <CodeBlock label="Features response" code={FEATURES_RESPONSE} />
        </div>
      </section>

      {/* Quick test */}
      <section className="space-y-4">
        <SectionTitle>Quick test (curl)</SectionTitle>
        <CodeBlock label="Regular — lexical" code={CURL_REGULAR} />
        <CodeBlock label="Semantic — with filters" code={CURL_SEMANTIC} />
        <CodeBlock label="Agentic — SSE stream" code={CURL_STREAM} />
        <CodeBlock label="Facets — cascade drill-down" code={CURL_FACETS} />
      </section>

    </div>
  );
}
