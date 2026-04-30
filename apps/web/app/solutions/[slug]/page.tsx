import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getAllSlugs, getSolution } from '@/lib/solutions';
import { SolutionTabs } from '@/components/solution-tabs';
import { cn } from '@/lib/utils';

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sol = getSolution(slug);
  if (!sol) return {};
  return {
    title: sol.meta.title,
    description: sol.meta.tagline,
  };
}

export default async function SolutionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sol = getSolution(slug);
  if (!sol) notFound();

  const accent = sol.meta.hero?.accent ?? 'from-slate-500 to-slate-700';

  return (
    <article>
      {/* Compact header — category + title only; full description lives in the Overview tab */}
      <section>
        <div className={cn('h-0.5 bg-gradient-to-r', accent)} />
        <div className="container-tight pt-6 pb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
            {sol.meta.category}
          </p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight">{sol.meta.title}</h1>
        </div>
      </section>

      {/* Tabs (overview, demo, architecture, …) */}
      <section className="container-tight pt-2 pb-12">
        <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
          <SolutionTabs solution={sol} />
        </Suspense>
      </section>
    </article>
  );
}
