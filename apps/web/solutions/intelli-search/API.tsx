'use client';

const SAMPLE_QUERY = `{
  "query": "AI companies in California building copilots",
  "limit": 20,
  "page": 1,
  "include_reasoning": true,
  "filters": {
    "country": "United States",
    "state": "California",
    "industries": ["Artificial Intelligence"],
    "year_from": 2018
  }
}`;

const STREAM_REQUEST = `{
  "query": "companies that raised funding recently",
  "limit": 15,
  "page": 1,
  "include_reasoning": true,
  "filters": {
    "country": "United States"
  }
}`;

const RESULT_EVENT = `data: {"type":"results","data":{"query":"...","results":[...],"metadata":{...},"status":"success"}}`;

const CURL_SEARCH = `curl -X POST "$NEXT_PUBLIC_INTELLI_SEARCH_API/api/search/intelligent" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "Tech companies in France",
    "limit": 10,
    "page": 1,
    "include_reasoning": true
  }'`;

const CURL_STREAM = `curl -N -X POST "$NEXT_PUBLIC_INTELLI_SEARCH_API/api/search/intelligent/stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "companies that raised funding recently",
    "limit": 10,
    "include_reasoning": true
  }'`;

const RESPONSE_HEADERS = [
  'X-Trace-ID: Correlation id for tracing request lifecycle',
  'X-Search-Logic: Strategy used (Regular-BM25, Semantic-Hybrid-RRF, Agentic-External-Tool)',
  'X-Confidence: Intent classification confidence (0-1)',
  'X-Response-Time-MS: End-to-end latency in milliseconds',
  'X-Total-Results: Number of returned hits',
];

const FACET_ENDPOINTS = [
  'GET /api/search/facets/industries',
  'GET /api/search/facets/countries',
  'GET /api/search/facets/states?country=United%20States',
  'GET /api/search/facets/cities?country=United%20States&state=California',
];

const DIAGNOSTICS = [
  'GET /api/search/health',
  'GET /api/search/features',
  'GET /api/search/index-stats',
  'GET /api/search/top-queries?limit=10',
];

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground">
      <code>{code}</code>
    </pre>
  );
}

function Endpoint({ method, path, summary }: { method: string; path: string; summary: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide">
          {method}
        </span>
        <span className="font-mono text-sm text-foreground">{path}</span>
      </div>
      <p className="mt-2 text-sm text-foreground/85">{summary}</p>
    </div>
  );
}

export default function API() {
  return (
    <div className="space-y-10">
      <div className="max-w-3xl space-y-3">
        <p className="text-base leading-relaxed text-foreground">
          IntelliSearch exposes a production-oriented API for hybrid retrieval over large company
          datasets. The API supports synchronous search, streaming progress events, strict user
          filters, and facet lookups for cascading UI controls.
        </p>
        <p className="text-sm text-foreground/85">
          Base URL is read from <span className="font-mono">NEXT_PUBLIC_INTELLI_SEARCH_API</span>{' '}
          (falls back to <span className="font-mono">/intelli-search</span> in the web app).
        </p>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Core endpoints
        </h3>
        <div className="grid gap-3">
          <Endpoint
            method="POST"
            path="/api/search/intelligent"
            summary="Runs intent classification + strategy routing, then returns ranked results with metadata."
          />
          <Endpoint
            method="POST"
            path="/api/search/intelligent/stream"
            summary="Streams progress and final results as Server-Sent Events for long-running agentic searches."
          />
          <Endpoint
            method="POST"
            path="/api/search/basic"
            summary="Structured BM25 search path with facets for deterministic filter-heavy workflows."
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Request shape
        </h3>
        <CodeBlock code={SAMPLE_QUERY} />
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Streaming contract (SSE)
        </h3>
        <p className="text-sm text-foreground/85">
          Stream emits <span className="font-mono">progress</span>, then a final{' '}
          <span className="font-mono">results</span> event (or <span className="font-mono">error</span>
          ). Heartbeats are sent to keep long-lived connections alive.
        </p>
        <CodeBlock code={STREAM_REQUEST} />
        <CodeBlock code={RESULT_EVENT} />
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Response headers
        </h3>
        <ul className="space-y-2 text-sm text-foreground/85">
          {RESPONSE_HEADERS.map((line) => (
            <li key={line} className="rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm">
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Facets and diagnostics
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground/95">Facet lookups</p>
            <ul className="space-y-2 text-sm text-foreground/85">
              {FACET_ENDPOINTS.map((endpoint) => (
                <li key={endpoint} className="rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm">
                  {endpoint}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-foreground/95">Operational endpoints</p>
            <ul className="space-y-2 text-sm text-foreground/85">
              {DIAGNOSTICS.map((endpoint) => (
                <li key={endpoint} className="rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm">
                  {endpoint}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Quick test commands
        </h3>
        <CodeBlock code={CURL_SEARCH} />
        <CodeBlock code={CURL_STREAM} />
      </section>
    </div>
  );
}
