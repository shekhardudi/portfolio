# intelli-search — high-level flow

A search-orchestrator service that classifies the query's intent and routes
to the appropriate strategy: **BM25 lexical**, **vector k-NN with Hybrid
RRF**, or an **agentic tool-calling pipeline**. One endpoint (`/intelligent`),
three execution paths, identical response shape.

## Diagram

```
┌──────────────────────┐         POST /api/search/intelligent
│   Next.js frontend   │  ───────────────────────────────────────►
│  IntelliSearchBar    │
│  ResultsList         │  ◄───────────────────────────────────────
└──────────┬───────────┘         200 + X-Search-Logic header
           │ (SSE variant: /intelligent/stream — replayable on reconnect)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI :8000  (app/api/routes.py)           │
│                                                                 │
│   1. Intent classifier                                          │
│      ┌────────────────────────────────────────────────┐         │
│      │ classify(query) → "regular" | "semantic"       │         │
│      │                  | "agentic" + confidence       │         │
│      └─────────────┬──────────────────────────────────┘         │
│                    │                                            │
│      ┌─────────────┴──────────────┬───────────────┐             │
│      ▼                            ▼               ▼             │
│   ┌─────────┐                ┌──────────┐   ┌────────────┐      │
│   │ regular │                │ semantic │   │  agentic   │      │
│   │  BM25   │                │  k-NN +  │   │ tool calls │      │
│   │ lexical │                │   RRF    │   │  (Tavily)  │      │
│   └────┬────┘                └────┬─────┘   └────┬───────┘      │
│        │                          │              │              │
│        ▼                          ▼              ▼              │
│   ┌─────────────────────────────────────┐   ┌─────────────┐     │
│   │  OpenSearch index (companies)       │   │  External   │     │
│   │  - inverted index (BM25)            │   │  news /     │     │
│   │  - dense vector field (k-NN)        │   │  funding    │     │
│   │  - reciprocal-rank fusion across    │   │  APIs       │     │
│   │    BM25 + vector scores             │   └─────────────┘     │
│   └─────────────────────────────────────┘                       │
│                                                                 │
│   2. Normalise hits → SearchResponse                            │
│      (relevance_score, reasoning, classification metadata)      │
│                                                                 │
│   3. Add observability headers:                                 │
│      X-Trace-ID, X-Search-Logic, X-Confidence,                  │
│      X-Response-Time-MS, X-Total-Results                        │
└─────────────────────────────────────────────────────────────────┘
                    │                          │
                    ▼                          ▼
            ┌──────────────┐           ┌──────────────────┐
            │  Redis (TTL  │           │  In-process      │
            │  top-queries │           │  facet cache     │
            │  + cache)    │           │  (6h TTL)        │
            └──────────────┘           └──────────────────┘
```

## Request lifecycle

1. **Frontend** sends `POST /api/search/intelligent` with `{query, limit,
   filters?, sort?, include_reasoning?}`.
2. **Classifier** decides the strategy:
   * Short specific terms (company names, IDs) → `regular` (BM25)
   * Natural-language / conceptual queries → `semantic` (k-NN + RRF)
   * Time-sensitive or external-data queries ("recently raised Series B")
     → `agentic` (tool-calling pipeline)
3. **Strategy executes** against OpenSearch (regular/semantic) or external
   data sources (agentic). User-supplied filters always override
   classifier-extracted filters.
4. **URLs are normalised** at the edge — `linkedin.com/company/x` is
   promoted to `https://www.linkedin.com/company/x` so the mobile tap
   handoff to the LinkedIn app works reliably
   ([client.ts:118](../../apps/web/solutions/intelli-search/client.ts#L118)).
5. **Response** includes `results[]`, `metadata.query_classification`,
   `metadata.search_execution`, and observability headers for tracing.

## Streaming variant

`POST /api/search/intelligent/stream` is an SSE endpoint that uses the
same orchestrator but emits frame-by-frame progress (`intent_classified`,
`agentic_log`, `results`). The session is keyed by a client-supplied
`search_id`; the orchestrator task survives client disconnect, so a tab
navigation + return triggers reconnection and event replay rather than a
restarted search.

## Key files

| Concern | Path |
|---|---|
| HTTP routes | [services/intelli-search/app/api/routes.py](../../services/intelli-search/app/api/routes.py) |
| Frontend client + URL normalisation | [apps/web/solutions/intelli-search/client.ts](../../apps/web/solutions/intelli-search/client.ts) |
| Demo UI / SSE handling | [apps/web/solutions/intelli-search/Demo.tsx](../../apps/web/solutions/intelli-search/Demo.tsx) |
| Result rendering | [apps/web/solutions/intelli-search/ResultsList.tsx](../../apps/web/solutions/intelli-search/ResultsList.tsx) |
