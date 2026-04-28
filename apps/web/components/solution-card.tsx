import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { SolutionMeta } from '@/solutions/_types';
import { cn } from '@/lib/utils';

export function SolutionCard({ meta }: { meta: SolutionMeta }) {
  const accent = meta.hero?.accent ?? 'from-slate-500 to-slate-700';
  return (
    <Link
      href={`/solutions/${meta.slug}`}
      className="group relative block overflow-hidden rounded-2xl border border-border bg-background/40 p-6 transition hover:-translate-y-1 hover:border-foreground/40 hover:shadow-lg"
    >
      <div className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', accent)} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold">{meta.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{meta.tagline}</p>
        </div>
        <ArrowRight className="h-5 w-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground" />
      </div>
      <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
        {meta.highlights.map((h) => (
          <li key={h} className="before:mr-2 before:content-['→']">
            {h}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2">
        {meta.stack.map((tech) => (
          <span
            key={tech}
            className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
          >
            {tech}
          </span>
        ))}
      </div>
    </Link>
  );
}
