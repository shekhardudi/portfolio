'use client';

// ── Request bodies ──────────────────────────────────────────────────────────

const SCOUT_REQUEST = `POST /api/v1/scout
{
  "modules": ["community_sentiment", "technical_deep_dive",
              "tooling_and_tactics", "frontier_lab_watch"],
  "days": 14          // 0–730; 7 is default
}`;

const POSTS_REQUEST = `POST /api/v1/posts
{
  "topic": "Agentic AI workflows in production",
  "leader_angle": "Most agentic systems are overengineered for the problems they solve.",
  "author_name": "Shekhar Dudi",
  "author_title": "AI Engineer",
  "author_location": "Melbourne, Australia",
  "author_vibe": "calm, direct, and slightly skeptical",
  "audience": "engineering"   // "engineering" | "business"
}`;

const IMAGE_REQUEST = `POST /api/v1/images
{
  "job_id": "<completed-post-job-id>",
  "prompt": "Documentary-style still: engineering team reviewing a deployment rollback",
  "quality": "high"    // "low" | "medium" | "high"
}`;

const PATCH_POST_REQUEST = `PATCH /api/v1/posts/{job_id}
{
  "post_draft": "Updated post content after human editing…"
}`;

// ── Response shapes ─────────────────────────────────────────────────────────

const JOB_ACK = `// 202 Accepted — both /scout and /posts return this immediately
{
  "job_id": "c53e4f1a-…",
  "status": "queued"
}`;

const SCOUT_POLL = `// GET /api/v1/scout/{job_id}  — poll every 2 s
{
  "job_id": "c53e…",
  "status": "running",          // queued | running | completed | failed
  "progress": {
    "step": 2,
    "total": 4,
    "module": "technical_deep_dive",
    "phase": "fetch",
    "message": "Crawling arxiv papers…",
    "callbacks": [              // rolling last-60 live activity entries
      { "ts": "…", "module": "community_sentiment",
        "phase": "done", "message": "12 signals extracted" }
    ]
  },
  "result": null,
  "error": null
}`;

const SCOUT_DONE = `// status === "completed"
"result": {
  "report_md": "# Pulse Briefing\\n…",
  "modules": ["community_sentiment", "technical_deep_dive"],
  "days": 14,
  "briefing": {
    "lead": "One-sentence synthesis of the week's most important signal.",
    "signals": [
      {
        "id": "sig_01", "category": "release",
        "headline": "OpenAI ships structured outputs for Realtime API",
        "summary": "…", "post_angle": "…",
        "finding_ids": ["fnd_03"], "primary_module": "frontier_lab_watch"
      }
    ],
    "findings": [
      {
        "id": "fnd_03", "claim": "Structured outputs cut parsing errors by 40 %",
        "source_url": "https://…", "source_label": "OpenAI blog",
        "module": "frontier_lab_watch", "novelty": "new",
        "why_it_matters": "…", "confidence": 0.91
      }
    ],
    "themes": [ { "title": "…", "summary": "…" } ],
    "tensions": [ { "title": "…", "summary": "…" } ],
    "gaps": ["…"],
    "action_items": ["…"]
  },
  "cost_breakdown": { "scout": { "calls": 18, "cost_usd": 0.043 } }
}`;

const POST_DONE = `// GET /api/v1/posts/{job_id} — status === "completed"
"progress": {
  "stage": "visual_director",   // queued|researching|writing|critique|visual_director
  "events": [
    { "agent": "Researcher", "event": "tool_start",
      "tool": "TavilySearch", "input": "…", "output": null, "ts": "…" },
    { "agent": "Writer",     "event": "reasoning",
      "thought": "The angle needs to open with the cost failure case…", "ts": "…" }
  ]
},
"result": {
  "run_id": "20260506_153012",
  "post_draft": "# The hidden cost of agentic systems\\n…",
  "image_prompt": "Editorial photograph: lone server rack in an empty data centre…",
  "emotional_beats": ["curiosity", "tension", "resolve"],
  "cost_breakdown": {
    "crew":           { "calls": 6,  "cost_usd": 0.081 },
    "visual_director":{ "calls": 1,  "cost_usd": 0.009 },
    "total_cost_usd": 0.090
  }
}`;

const IMAGE_RESPONSE = `// 201 Created
{
  "image_id": "20260506_153012_01",
  "image_url": "/api/v1/images/20260506_153012_01",
  "run_id": "20260506_153012"
}`;

const HEALTH_RESPONSE = `// GET /api/v1/health
{
  "status": "ok",
  "version": "0.2.0",
  "keys_present": { "openai": true, "anthropic": true, "tavily": true },
  "scout_backend": "openai/gpt-4o-mini",
  "ollama_reachable": null
}`;

// ── curl quick-tests ────────────────────────────────────────────────────────

const CURL_SCOUT = `# 1. Start scout
JOB=$(curl -sX POST "$API/api/v1/scout" \\
  -H "Content-Type: application/json" \\
  -d '{"modules":["community_sentiment","frontier_lab_watch"],"days":7}' \\
  | jq -r .job_id)

# 2. Poll until done (briefing.signals available on completion)
curl "$API/api/v1/scout/$JOB"`;

const CURL_POSTS = `# 1. Start post crew
JOB=$(curl -sX POST "$API/api/v1/posts" \\
  -H "Content-Type: application/json" \\
  -d '{
    "topic": "AI copilots in enterprise support",
    "leader_angle": "Retrieval quality is ignored — that is why most copilots fail.",
    "author_name": "Shekhar Dudi",
    "author_title": "AI Engineer",
    "author_location": "Melbourne, Australia",
    "author_vibe": "direct and practical",
    "audience": "engineering"
  }' | jq -r .job_id)

# 2. Poll for progress + result
curl "$API/api/v1/posts/$JOB"

# 3. Edit the draft after completion
curl -X PATCH "$API/api/v1/posts/$JOB" \\
  -H "Content-Type: application/json" \\
  -d '{"post_draft":"…edited copy…"}'`;

const CURL_IMAGES = `# Requires a completed post job_id
curl -X POST "$API/api/v1/images" \\
  -H "Content-Type: application/json" \\
  -d '{
    "job_id": "'$JOB'",
    "prompt": "Minimalist editorial cover: contrarian AI ops post",
    "quality": "high"
  }'

# Serve the file
curl "$API/api/v1/images/20260506_153012_01" --output cover.png`;

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
          LinkedIn Generator exposes an async job API built with FastAPI. Two main workflows —{' '}
          <strong>Pulse Scout</strong> (market intelligence briefing) and{' '}
          <strong>Authority Crew</strong> (multi-agent post generation + image rendering) — return
          immediately with a <code className="rounded bg-muted px-1 text-sm">job_id</code> and
          then clients poll for progress and results.
        </p>
        <p className="text-sm text-foreground/80">
          Base URL:{' '}
          <code className="rounded bg-muted px-1 text-sm">NEXT_PUBLIC_LINKEDIN_API</code>{' '}
          env var (falls back to{' '}
          <code className="rounded bg-muted px-1 text-sm">/linkedin-generator</code> inside the
          web app). All routes live under{' '}
          <code className="rounded bg-muted px-1 text-sm">/api/v1/</code>.
        </p>
      </div>

      {/* Scout endpoints */}
      <section className="space-y-4">
        <SectionTitle>Pulse Scout</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          Scans community signals, research, tooling, and frontier-lab moves across configurable
          modules and a rolling time window. Returns a structured{' '}
          <code className="rounded bg-muted px-1 text-sm">briefing</code> (signals, findings,
          themes, tensions) plus a Markdown report.
        </p>
        <div className="grid gap-3">
          <Endpoint method="POST" path="/api/v1/scout"
            summary="Start a Scout run. Accepts modules list + days window. Returns job_id immediately (202)." />
          <Endpoint method="GET"  path="/api/v1/scout/{job_id}"
            summary="Poll job status. Progress includes step/total, active module, phase, and a rolling callbacks stream." />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeBlock label="Request" code={SCOUT_REQUEST} />
          <CodeBlock label="202 Ack (both workflows)" code={JOB_ACK} />
        </div>
        <CodeBlock label="Polling response (running)" code={SCOUT_POLL} />
        <CodeBlock label="Result on completion" code={SCOUT_DONE} />
      </section>

      {/* Posts endpoints */}
      <section className="space-y-4">
        <SectionTitle>Authority Crew — posts</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          Runs a four-agent CrewAI pipeline: Researcher → Writer → Critic → Visual Director.
          Progress streams agent reasoning events in real time. Rate-limited per IP.
        </p>
        <div className="grid gap-3">
          <Endpoint method="POST"  path="/api/v1/posts"
            summary="Start a post-generation run. Returns job_id (202). Rate-limited."
            note="author_name / author_title / author_location are passed straight into the crew context." />
          <Endpoint method="GET"   path="/api/v1/posts/{job_id}"
            summary="Poll status. Progress.events is an append-only list of agent reasoning + tool calls." />
          <Endpoint method="PATCH" path="/api/v1/posts/{job_id}"
            summary="Save an edited post draft back to the run directory (must be completed)." />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeBlock label="POST request" code={POSTS_REQUEST} />
          <CodeBlock label="PATCH request" code={PATCH_POST_REQUEST} />
        </div>
        <CodeBlock label="Result on completion" code={POST_DONE} />
      </section>

      {/* Images endpoints */}
      <section className="space-y-4">
        <SectionTitle>Images</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          Generates a cover image with <code className="rounded bg-muted px-1 text-sm">gpt-image-1</code> and
          writes it to the run directory. Cost is tracked and merged back into the post job result.
          Rate-limited per IP.
        </p>
        <div className="grid gap-3">
          <Endpoint method="POST" path="/api/v1/images"
            summary="Generate a cover image for a completed post job. Returns image_id + serving URL (201). Rate-limited." />
          <Endpoint method="GET"  path="/api/v1/images/{image_id}"
            summary="Serve the generated PNG file directly. image_id format: {run_id}_{seq}." />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <CodeBlock label="POST request" code={IMAGE_REQUEST} />
          <CodeBlock label="201 response" code={IMAGE_RESPONSE} />
        </div>
      </section>

      {/* History + health */}
      <section className="space-y-4">
        <SectionTitle>History &amp; health</SectionTitle>
        <div className="grid gap-3">
          <Endpoint method="GET" path="/api/v1/health"
            summary="Confirms API keys are present, reports scout backend (OpenAI or Ollama), and pings Ollama if configured." />
          <Endpoint method="GET" path="/api/v1/history"
            summary="Returns the last N completed runs (default 50). Each row includes topic, costs, and file paths." />
          <Endpoint method="GET" path="/api/v1/history/{run_id}"
            summary="Returns a single run record by run_id." />
        </div>
        <CodeBlock label="Health response" code={HEALTH_RESPONSE} />
      </section>

      {/* Quick test commands */}
      <section className="space-y-4">
        <SectionTitle>Quick test (curl)</SectionTitle>
        <CodeBlock label="Scout — start → poll" code={CURL_SCOUT} />
        <CodeBlock label="Posts — start → poll → edit draft" code={CURL_POSTS} />
        <CodeBlock label="Images — generate → serve" code={CURL_IMAGES} />
      </section>

      {/* Rate limit + headers */}
      <section className="space-y-4">
        <SectionTitle>Rate limits &amp; response headers</SectionTitle>
        <p className="max-w-2xl text-sm text-foreground/80">
          <code className="rounded bg-muted px-1 text-sm">POST /posts</code> and{' '}
          <code className="rounded bg-muted px-1 text-sm">POST /images</code> are rate-limited
          per IP via{' '}
          <code className="rounded bg-muted px-1 text-sm">slowapi</code>. Limits are configured
          in settings (<code className="rounded bg-muted px-1 text-sm">rate_limit_posts</code> /{' '}
          <code className="rounded bg-muted px-1 text-sm">rate_limit_images</code>). Every response
          includes tracing and bucket headers:
        </p>
        <ul className="space-y-2">
          {[
            'x-request-id        — correlation id for distributed tracing',
            'x-ratelimit-limit   — request cap for the matched bucket',
            'x-ratelimit-remaining — requests left in the current window',
            'x-ratelimit-reset   — seconds until the window resets',
          ].map((line) => (
            <li
              key={line}
              className="rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-[13px] text-foreground/85"
            >
              {line}
            </li>
          ))}
        </ul>
      </section>

    </div>
  );
}
