import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getAllSlugs, getSolution } from '@/lib/solutions';
import { SolutionTabs } from '@/components/solution-tabs';
import { cn } from '@/lib/utils';

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const sol = getSolution(params.slug);
  if (!sol) return {};
  return {
    title: sol.meta.title,
    description: sol.meta.tagline,
  };
}

export default function SolutionPage({ params }: { params: { slug: string } }) {
  const sol = getSolution(params.slug);
  if (!sol) notFound();

  const accent = sol.meta.hero?.accent ?? 'from-slate-500 to-slate-700';

  return (
    <article>
      {/* Hero */}
      <section className="border-b border-border">
        <div className={cn('h-1 bg-gradient-to-r', accent)} />
        <div className="container-tight py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
            {sol.meta.category}
          </p>
          <h1 className="mt-2 text-4xl font-bold">{sol.meta.title}</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{sol.meta.tagline}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {sol.meta.stack.map((t) => (
              <span
                key={t}
                className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Tabs (overview, demo, architecture, …) */}
      <section className="container-tight py-12">
        <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
          <SolutionTabs solution={sol} />
        </Suspense>
      </section>
    </article>
  );
}
