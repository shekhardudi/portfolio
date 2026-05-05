'use client';

const SCOUT_REQUEST = `{
  "modules": [
    "community_sentiment",
    "technical_deep_dive",
    "tooling_and_tactics"
  ],
  "days": 14
}`;

const POSTS_REQUEST = `{
  "topic": "Agentic AI workflows in production",
  "leader_angle": "Most agentic systems are overengineered for the problems they solve.",
  "author_name": "Shekhar Dudi",
  "author_title": "AI Engineer",
  "author_location": "Melbourne, Australia",
  "author_vibe": "calm, direct, and slightly skeptical",
  "audience": "engineering"
}`;

const IMAGE_REQUEST = `{
  "job_id": "<completed-post-job-id>",
  "prompt": "Documentary-style still of an engineering team reviewing a deployment rollback",
  "quality": "high"
}`;

const POLL_RESPONSE = `{
  "job_id": "c53e...",
  "status": "running",
  "progress": {
    "stage": "writing",
    "run_id": "20260505_182500",
    "events": [ ... ]
  },
  "result": null,
  "error": null
}`;

const CURL_SCOUT = `curl -X POST "$NEXT_PUBLIC_LINKEDIN_API/api/v1/scout" \\
  -H "Content-Type: application/json" \\
  -d '{
    "modules": ["community_sentiment","technical_deep_dive"],
    "days": 7
  }'`;

const CURL_POSTS = `curl -X POST "$NEXT_PUBLIC_LINKEDIN_API/api/v1/posts" \\
  -H "Content-Type: application/json" \\
  -d '{
    "topic": "AI copilots in enterprise support",
    "leader_angle": "Most copilots fail because retrieval quality is ignored.",
    "author_name": "Shekhar Dudi",
    "author_title": "AI Engineer",
    "author_location": "Melbourne, Australia",
    "author_vibe": "direct and practical",
    "audience": "engineering"
  }'`;

const CURL_IMAGES = `curl -X POST "$NEXT_PUBLIC_LINKEDIN_API/api/v1/images" \\
  -H "Content-Type: application/json" \\
  -d '{
    "job_id": "<completed-post-job-id>",
    "prompt": "Minimalist editorial cover visual for a contrarian AI ops post",
    "quality": "high"
  }'`;

const RESPONSE_HEADERS = [
  'x-request-id: Correlation id added to every response for tracing',
  'x-ratelimit-limit: Limit for the matched rate-limit bucket',
  'x-ratelimit-remaining: Remaining requests in the current window',
  'x-ratelimit-reset: Seconds until reset for the current window',
];

const JOB_ENDPOINTS = [
  'POST /api/v1/scout',
  'GET /api/v1/scout/{job_id}',
  'POST /api/v1/posts',
  'GET /api/v1/posts/{job_id}',
  'PATCH /api/v1/posts/{job_id}',
  'POST /api/v1/images',
];

const OBSERVABILITY = [
  'GET /api/v1/health',
  'GET /api/v1/history?limit=50',
  'GET /api/v1/history/{run_id}',
  'GET /api/v1/images/{image_id}',
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
          LinkedIn Generator exposes an async job API for two workflows: Pulse Scout
          (market intelligence briefing) and Authority Crew (multi-agent post generation
          followed by optional image rendering). Long-running work returns immediately
          with a job id, then clients poll status.
        </p>
        <p className="text-sm text-foreground/85">
          Base URL is read from <span className="font-mono">NEXT_PUBLIC_LINKEDIN_API</span>{' '}
          (falls back to <span className="font-mono">/linkedin-generator</span> in the web app).
        </p>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Core endpoints
        </h3>
        <div className="grid gap-3">
          <Endpoint
            method="POST"
            path="/api/v1/scout"
            summary="Starts a Pulse Scout run across selected modules and days window."
          />
          <Endpoint
            method="POST"
            path="/api/v1/posts"
            summary="Starts the Authority Crew pipeline (Researcher → Writer → Critic → Visual Director)."
          />
          <Endpoint
            method="POST"
            path="/api/v1/images"
            summary="Generates a cover image from the finalized post/image plan for a completed post job."
          />
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Request shapes
        </h3>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground/95">Scout request</p>
            <CodeBlock code={SCOUT_REQUEST} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground/95">Posts request</p>
            <CodeBlock code={POSTS_REQUEST} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground/95">Image request</p>
            <CodeBlock code={IMAGE_REQUEST} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Async job contract
        </h3>
        <p className="text-sm text-foreground/85">
          Job endpoints return <span className="font-mono">queued</span>,{' '}
          <span className="font-mono">running</span>,{' '}
          <span className="font-mono">completed</span>,{' '}
          <span className="font-mono">failed</span>, or{' '}
          <span className="font-mono">cancelled</span>. While running,{' '}
          <span className="font-mono">progress</span> includes stage/step metadata so the UI can show
          real-time progression without long-held HTTP connections.
        </p>
        <CodeBlock code={POLL_RESPONSE} />
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
          Polling and history endpoints
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground/95">Job lifecycle</p>
            <ul className="space-y-2 text-sm text-foreground/85">
              {JOB_ENDPOINTS.map((endpoint) => (
                <li key={endpoint} className="rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-sm">
                  {endpoint}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-foreground/95">Health and artifacts</p>
            <ul className="space-y-2 text-sm text-foreground/85">
              {OBSERVABILITY.map((endpoint) => (
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
        <CodeBlock code={CURL_SCOUT} />
        <CodeBlock code={CURL_POSTS} />
        <CodeBlock code={CURL_IMAGES} />
      </section>
    </div>
  );
}
