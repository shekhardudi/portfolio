'use client';

import { Clock3, PenLine, Search, Sparkles, Users, Workflow } from 'lucide-react';

const FLOW = [
  {
    name: 'Pulse Scout',
    tag: 'ArXiv · HN · Tavily',
    description:
      'A true intelligence engine. Scans real-time signals across research papers, tech forums, and news to synthesize a factual Market Intelligence Briefing.',
  },
  {
    name: 'Agents',
    tag: 'Researcher · Writer · Critic',
    description:
      'A strict 3-agent writing room. Anchors on emotional beats, enforces a 5-part anatomical cadence, and actively scrubs out "LLM-smell" vocabulary.',
  },
  {
    name: 'Visual Director',
    tag: 'gpt-image-1',
    description:
      'A post-writing step that determines optimal image style (e.g., documentary still, witty gag) and builds a structured JSON plan for the final render.',
  },
];

const PILLARS = [
  {
    icon: Workflow,
    title: 'Dual-Engine Architecture',
    body: 'Separates intelligence gathering (Pulse Scout) from content generation (Authority Crew), grounding output in real events instead of generic facts.',
  },
  {
    icon: Sparkles,
    title: 'Hard Constraints & Anti-Tropes',
    body: 'Opinionated rules reject typical LLM patterns like em-dash pileups and abstract lists. A Critic agent cross-checks against "AI smells" before final output.',
  },
  {
    icon: Users,
    title: 'True Practitioner Voice',
    body: 'The pipeline relies on a hard 5-part anatomical structure and specific emotional beats, forcing concrete points over broad motivational language.',
  },
  {
    icon: PenLine,
    title: 'Opinionated Visuals',
    body: 'The Visual Director chooses between documentary, object portrait, or witty gags based on audience mapping, explicitly avoiding "stock-AI" aesthetics.',
  },
  {
    icon: Clock3,
    title: 'Async Job Model by Design',
    body: 'Generation takes 60–180 seconds. A FastAPI backend spins up async workers while the React UI polls statelessly. Zero timeout failures, zero long-held HTTP connections.',
  },
  {
    icon: Search,
    title: 'Transparent Orchestration',
    body: 'Maintains a stateless, robust job queue. Clean async endpoints guarantee UI concerns stay strictly isolated from the intensive multi-agent logic.',
  },
];

export default function Overview() {
  return (
    <div className="space-y-12">
      <div className="max-w-5xl space-y-4">
        <p className="text-lg leading-relaxed text-foreground md:text-justify">
          LinkedIn Auth is a dual-engine system that turns <span className="text-foreground italic">what is actually happening in AI this week</span> into high-authority LinkedIn content that reads like a real practitioner wrote it—paired with a scroll-stopping image that matches the emotion, not generic stock-AI art.
        </p>
        <p className="text-base leading-relaxed text-foreground/85 md:text-justify">
          It avoids the trap of single-prompt AI slop by combining a specialized research pipeline (Pulse Scout) with a highly constrained writing pipeline (Authority Crew) and structural art direction (Visual Director). Built on a robust FastAPI async polling infrastructure, it guarantees quality and reliability in real-world workflows.
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
            'Next.js',
            'crewAI',
            'FastAPI',
            'GPT-5',
            'Claude Opus & Sonnet',
            'Tavily',
            'Async Queues',
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