import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SOLUTIONS } from '@/lib/solutions';
import { SolutionCard } from '@/components/solution-card';

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="container-tight py-24 sm:py-32">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
            AI engineering portfolio
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-tight sm:text-6xl">
            Production-grade ML & agentic
            <br />
            systems, end-to-end.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Three live solutions you can poke right now: hybrid search over millions of
            profiles, an HR assistant with human-in-the-loop approvals, and a multi-agent
            content generator. Everything from data pipeline to deploy.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="#solutions"
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:bg-foreground/90"
            >
              See the demos
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              About me
            </Link>
          </div>
        </div>
      </section>

      {/* Solutions grid */}
      <section id="solutions" className="border-t border-border bg-background/50">
        <div className="container-tight py-20">
          <h2 className="text-2xl font-semibold">Solutions</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Each card opens to a working demo backed by a FastAPI service. Architecture,
            API contract, and lessons learned are documented inline.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {SOLUTIONS.map((s) => (
              <SolutionCard key={s.meta.slug} meta={s.meta} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
