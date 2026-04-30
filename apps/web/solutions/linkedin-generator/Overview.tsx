'use client';

import { Clock3, PenLine, Search, Sparkles, Users, Workflow } from 'lucide-react';

const FLOW = [
  {
    name: 'Research Agent',
    tag: 'Tavily',
    description:
      'Collects current signals, examples, and supporting context for the topic before drafting begins.',
  },
  {
    name: 'Strategy Agent',
    tag: 'Structure + Angle',
    description:
      'Converts raw research into a clear narrative arc with authority positioning and audience intent.',
  },
  {
    name: 'Writer Agent',
    tag: 'Final Draft',
    description:
      'Produces the final post with voice constraints, cadence rules, and clarity edits tuned for LinkedIn.',
  },
];

const PILLARS = [
  {
    icon: Workflow,
    title: 'True Multi-Agent Pipeline',
    body: 'The system separates research, strategic framing, and writing into distinct roles. This avoids single-pass LLM outputs that sound generic and underdeveloped.',
  },
  {
    icon: Clock3,
    title: 'Async Job Model by Design',
    body: 'Generation takes 60–180 seconds in real conditions. The API returns a job id immediately, then the frontend polls job status. This prevents long-held HTTP connections and timeout failures.',
  },
  {
    icon: Users,
    title: 'Leader-Angle Personalization',
    body: 'Input includes a leadership angle and author context, so each post reflects a specific POV rather than template content.',
  },
  {
    icon: Search,
    title: 'Evidence-Backed Drafting',
    body: 'Research grounding improves specificity and credibility. The model writes with concrete points instead of broad motivational language.',
  },
  {
    icon: PenLine,
    title: 'Production API Surface',
    body: 'The service is exposed as clean async endpoints: submit generation, poll status, inspect jobs, and health-check. UI concerns stay separate from generation orchestration.',
  },
  {
    icon: Sparkles,
    title: 'Consistent Voice, Better Readability',
    body: 'Prompt constraints enforce authority style, post rhythm, and hook quality while keeping outputs concise and readable on mobile feeds.',
  },
];

export default function Overview() {
  return (
    <div className="space-y-12">
      <div className="max-w-5xl space-y-4">
        <p className="text-lg leading-relaxed text-foreground md:text-justify">
          LinkedIn Generator is a multi-agent content engine that produces high-authority LinkedIn
          posts from a topic and leadership angle. It is built for production latency, not toy
          demos: generation runs asynchronously through a job system with clear status tracking.
        </p>
        <p className="text-base leading-relaxed text-foreground/85 md:text-justify">
          The architecture prioritizes quality and reliability together. Specialized agents handle
          research, framing, and writing in sequence, while the API model ensures long-running
          generation does not break UX or infrastructure limits.
        </p>
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Generation pipeline
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {FLOW.map((item) => (
            <div key={item.name} className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">{item.name}</span>
                <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground/80">
                  {item.tag}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-foreground/85">{item.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          What makes it production-ready
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          {PILLARS.map(({ icon: Icon, title, body }) => (
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

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground/75">
          Stack
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            'CrewAI',
            'FastAPI',
            'OpenAI',
            'Anthropic',
            'Tavily',
            'Async Job Orchestration',
            'Polling-based Status API',
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
