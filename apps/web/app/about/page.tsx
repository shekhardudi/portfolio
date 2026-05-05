import Link from 'next/link';
import { Github, Linkedin, Mail, MapPin } from 'lucide-react';

const LINKEDIN_URL = 'https://www.linkedin.com/in/shekhar-dudi-17283717/';
const GITHUB_URL = 'https://github.com/shekhardudi';
const EMAIL = 'shekhar.dudi@gmail.com';

const TOOLBOX = [
  {
    title: 'Languages',
    items: ['Python', 'Java', 'TypeScript'],
  },
  {
    title: 'AI & Agents',
    items: ['LLMs (GPT / Claude / Gemini)', 'CrewAI', 'LangChain · LangGraph', 'LlamaIndex', 'RAG', 'PyTorch'],
  },
  {
    title: 'Platform',
    items: ['Azure', 'AWS', 'Kubernetes', 'Docker', 'Terraform', 'OpenSearch · Postgres · Mongo'],
  },
];

export default function AboutPage() {
  return (
    <section className="container-tight py-20">
      {/* Header */}
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
          About
        </p>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">
          Shekhar Dudi
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Lead AI Engineer · building production-grade GenAI since the &ldquo;chat with
          your PDF&rdquo; era.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4" /> Melbourne, Australia
          </span>
          <a
            className="inline-flex items-center gap-1.5 hover:text-foreground"
            href={`mailto:${EMAIL}`}
          >
            <Mail className="h-4 w-4" /> {EMAIL}
          </a>
          <a
            className="inline-flex items-center gap-1.5 hover:text-foreground"
            href={LINKEDIN_URL}
            target="_blank"
            rel="noopener"
          >
            <Linkedin className="h-4 w-4" /> LinkedIn
          </a>
          <a
            className="inline-flex items-center gap-1.5 hover:text-foreground"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener"
          >
            <Github className="h-4 w-4" /> GitHub
          </a>
        </div>
      </div>

      {/* Lead — who I am */}
      <div className="mt-12 max-w-3xl space-y-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
        <p className="text-xl font-medium text-foreground sm:text-2xl">
          I&rsquo;m an AI Engineer who specialises in dragging Generative AI out of the
          notebook and into production &mdash; the kind that quietly works at 3 AM on a
          Tuesday.
        </p>
        <p>
          I help product and platform teams turn LLM ideas into systems people actually
          rely on: agentic workflows that don&rsquo;t hallucinate their way past
          guardrails, retrieval pipelines that surface the right document instead of a
          plausible one, and the LLMOps glue &mdash; evals, traces, cost controls &mdash;
          that lets you ship without holding your breath.
        </p>

        <h2 className="pt-4 text-base font-semibold text-foreground">
          How I think about the work
        </h2>
        <p>
          A demo proves a model can answer; a product proves it can be wrong gracefully.
          I optimise for the second one. That means humans in the loop where stakes are
          high, structured outputs over vibes, and observability before cleverness.
          Engineering rigour isn&rsquo;t the opposite of moving fast &mdash; it&rsquo;s
          what lets you keep moving fast on month six.
        </p>
      </div>

      {/* Toolbox */}
      <h2 className="mt-14 text-xl font-semibold">Toolbox</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        What I&rsquo;m dangerous with day-to-day &mdash; not a list of everything
        I&rsquo;ve ever opened a tab on.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {TOOLBOX.map((group) => (
          <div
            key={group.title}
            className="rounded-xl border border-border bg-background/40 p-4"
          >
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span
                  key={item}
                  className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Off the clock */}
      <div className="mt-14 max-w-3xl">
        <h2 className="text-xl font-semibold">Off the clock</h2>
        <p className="mt-3 text-muted-foreground">
          When I&rsquo;m not in a terminal, I&rsquo;m usually planning the next trip,
          arguing with a video game, or tinkering on a side build that I&rsquo;ll
          definitely finish this time.
        </p>
      </div>

      {/* CTA */}
      <div className="mt-12 flex flex-wrap gap-3">
        <a
          href={LINKEDIN_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-foreground/90"
        >
          <Linkedin className="h-4 w-4" /> Connect on LinkedIn
        </a>
        <a
          href={`mailto:${EMAIL}`}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <Mail className="h-4 w-4" /> Send an email
        </a>
        <Link
          href="/#solutions"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          See the work
        </Link>
      </div>
    </section>
  );
}
