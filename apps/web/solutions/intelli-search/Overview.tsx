'use client';

import { Brain, Database, GitMerge, Layers, Search, Zap } from 'lucide-react';

const MODES = [
  {
    name: 'Regular',
    tag: 'BM25',
    description:
      'Fast lexical match over indexed fields. Wins on exact terms, names, and domain-specific jargon that embeddings can dilute.',
  },
  {
    name: 'Semantic',
    tag: 'kNN · 384-dim HNSW',
    description:
      'Dense vector search over sentence-transformer embeddings. Catches synonyms, paraphrases, and conceptual intent that keyword search misses.',
  },
  {
    name: 'Agentic',
    tag: 'LangGraph + GPT-4o',
    description:
      'Orchestrated pipeline that issues structured sub-queries, fetches live data via external tools, and re-ranks with an LLM. Used for reasoning-heavy or time-sensitive queries.',
  },
];

const FEATURES = [
  {
    icon: Brain,
    title: 'Intent Classification',
    body: 'Every query passes through GPT-4o-mini before touching the index. The classifier decides which execution mode — regular, semantic, or agentic — fits the query, then routes accordingly. Confident queries go straight to the index; ambiguous ones land in semantic mode by default.',
  },
  {
    icon: GitMerge,
    title: 'Reciprocal Rank Fusion',
    body: "BM25 and kNN return separate ranked lists. RRF merges them by position rather than raw score, which means you don't need to hand-tune weighting constants. Empirically, this outperforms any single-signal ranking on recall-at-10 for mixed query types.",
  },
  {
    icon: Database,
    title: 'Pre-warmed HNSW Index',
    body: '7 million company profiles, each carrying a 384-dimensional embedding, land in an OpenSearch HNSW graph that weighs 5–7 GB. A startup hook calls the OpenSearch warmup API before the first request, so cold-start latency does not surface to users.',
  },
  {
    icon: Zap,
    title: 'Streaming Results via SSE',
    body: 'The agentic mode streams intermediate progress — classification, embedding, vector search, tool calls — as Server-Sent Events. The UI renders a live thinking panel so users see what the system is doing instead of staring at a spinner.',
  },
  {
    icon: Layers,
    title: 'Cascading Filters',
    body: 'Country → state → city facets load progressively from OpenSearch keyword aggregations. Industry, company size, and founded-year ranges layer on top. All filters are hard constraints sent alongside the query; the classifier cannot override them.',
  },
  {
    icon: Search,
    title: 'Data Ingestion Pipeline',
    body: 'A standalone Python pipeline reads raw company data in chunks, cleans and enriches each record, generates dense embeddings in batch, then bulk-indexes into OpenSearch with parallel workers. Fully re-runnable — re-index by re-running the pipeline.',
  },
];

export default function Overview() {
  return (
    <div className="space-y-12">
      {/* Lead */}
      <div className="max-w-5xl space-y-4">
        <p className="text-lg leading-relaxed text-foreground md:text-justify">
          IntelliSearch is a production-grade hybrid search system over a dataset of millions of
          company profiles. It combines classical BM25 keyword retrieval with dense vector search
          and an agentic reasoning layer — all unified behind a single{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">POST /search/intelligent</code>{' '}
          endpoint that auto-selects the right strategy per query.
        </p>
        <p className="text-base leading-relaxed text-foreground/85 md:text-justify">
          The core insight is that no single retrieval method is universally best. Keyword search
          dominates on precise terms; embeddings dominate on meaning. An intent classifier decides
          which to use — or escalates to an LLM-orchestrated agent for queries that need live data
          or multi-step reasoning. Reciprocal Rank Fusion merges the signals without manual weight
          tuning.
        </p>
      </div>

      {/* Execution modes */}
      <div>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Three execution modes, one entry point
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {MODES.map((m) => (
            <div
              key={m.name}
              className="rounded-xl border border-border bg-muted/30 p-4 space-y-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">{m.name}</span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground/80">
                  {m.tag}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-foreground/85">{m.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Feature breakdown */}
      <div>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          How it works
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                <Icon className="h-4 w-4 text-foreground/80" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-foreground/95">{title}</div>
                <p className="text-sm leading-relaxed text-foreground/85">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stack */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Stack
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            'FastAPI',
            'OpenSearch (kNN + BM25)',
            'sentence-transformers (all-MiniLM-L6-v2)',
            'GPT-4o-mini (classifier)',
            'GPT-4o (agentic)',
            'LangGraph',
            'Redis (facet cache)',
            'Tavily (web + LinkedIn tools)',
            'SSE streaming',
          ].map((item) => (
            <span
              key={item}
              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-sm text-foreground/90"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
