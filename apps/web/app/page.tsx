import Link from 'next/link';
import { ArrowRight, Github, Linkedin, ShieldCheck, Workflow, Boxes, Activity, Scale } from 'lucide-react';
import { SOLUTIONS } from '@/lib/solutions';
import { SolutionCard } from '@/components/solution-card';

const PRINCIPLES = [
  {
    icon: Workflow,
    title: 'Demos are real services',
    body: 'Every card opens a live FastAPI backend — same code, same shape as production. Open the network tab; nothing is mocked.',
  },
  {
    icon: ShieldCheck,
    title: 'Human-in-the-loop where it matters',
    body: 'Agents act, humans approve. Guardrails, structured outputs, and audit trails are first-class — not afterthoughts.',
  },
  {
    icon: Scale,
    title: 'Scalability without complexity',
    body: 'Three products, highly scalable backends. Extremely fault-tolerant reusable architecture patterns, not bespoke spaghetti.',
  },
  {
    icon: Workflow,
    title: 'Engineered Intelligence',
    body: 'Agentic where it needs to be, engineered everywhere else. No black boxes, no magic prompts — just solid systems.',
  },
];

const STACK = [
  'Python · FastAPI',
  'LangGraph · CrewAI · LlamaIndex',
  'OpenSearch · pgvector/postgres',
  'Next.js · Tailwind',
  'Docker · Terraform · AWS',
  'OpenTelemetry',
  'Redis',
  'OpenSource Integrations (Hugging Face, SerpAPI, etc.)',
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(96,165,250,0.12),transparent_70%)]"
        />
        <div className="container-tight relative py-16 sm:py-24 lg:py-32">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
            AI engineering portfolio · Shekhar Dudi
          </p>
          <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl lg:text-6xl">
            Production-grade AI,
            <br className="hidden sm:block" /> not another demo reel.
          </h1>
          <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Three live systems you can poke right now &mdash; hybrid search over millions
            of profiles, an HR copilot with human-in-the-loop approvals, and a multi-agent
            content generator. Real backends, real data, real failure modes. The same
            shape of work I&rsquo;ve been shipping for 13+ years, made public.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="#solutions"
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:bg-foreground/90"
            >
              See the demos <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              About me
            </Link>
            <a
              href="https://www.linkedin.com/in/shekhar-dudi-17283717/"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              <Linkedin className="h-4 w-4" /> LinkedIn
            </a>
            <a
              href="https://github.com/shekhardudi"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              <Github className="h-4 w-4" /> GitHub
            </a>
          </div>

          {/* Stat strip */}
          <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Live solutions</dt>
              <dd className="mt-1 text-2xl font-semibold">{SOLUTIONS.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Open source</dt>
              <dd className="mt-1 text-2xl font-semibold">100%</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Solutions grid */}
      <section id="solutions" className="bg-background/50">
        <div className="container-tight py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Solutions</h2>
              <p className="mt-2 max-w-2xl text-muted-foreground">
                Each card opens a working demo backed by a FastAPI service. Architecture
                diagrams and API contracts are documented inline &mdash;
                so you can read the code, hit the endpoint, or just play with the UI.
              </p>
            </div>
            <Link
              href="/about"
              className="text-sm text-blue-400 hover:underline"
            >
              How I built them &rarr;
            </Link>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {SOLUTIONS.map((s) => (
              <SolutionCard key={s.meta.slug} meta={s.meta} />
            ))}
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="border-t border-border">
        <div className="container-tight py-20">
          <h2 className="text-2xl font-semibold">How these are different</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            A &ldquo;portfolio&rdquo; of LLM demos is easy. A portfolio that survives
            contact with users is the actual job. Four things I optimise for &mdash; in
            this site and in production.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {PRINCIPLES.map((p) => (
              <div
                key={p.title}
                className="rounded-xl border border-border bg-background/40 p-5"
              >
                <p.icon className="h-5 w-5 text-blue-400" />
                <h3 className="mt-3 text-base font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stack */}
      <section className="border-t border-border bg-muted/20">
        <div className="container-tight py-16">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">Built with</h2>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Same stack, scaled down
            </span>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {STACK.map((item) => (
              <span
                key={item}
                className="rounded-md border border-border bg-background/50 px-3 py-1 text-sm text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border">
        <div className="container-tight py-16 text-center sm:py-20">
          <h2 className="text-3xl font-semibold sm:text-4xl">
            Working on something agentic?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            I help teams move ai and agentic systems from clever demos to billable systems.
            Always happy to compare notes, sanity-check architecture, or talk roles.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="https://www.linkedin.com/in/shekhar-dudi-17283717/"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:bg-foreground/90"
            >
              <Linkedin className="h-4 w-4" /> Connect on LinkedIn
            </a>
            <a
              href="mailto:shekhar.dudi@gmail.com"
              className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              shekhar.dudi@gmail.com
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
