import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { SolutionMeta } from '@/solutions/_types';
import { cn } from '@/lib/utils';
import { SolutionStatusBadge } from './solution-status-badge';

export function SolutionCard({ meta }: { meta: SolutionMeta }) {
  const accent = meta.hero?.accent ?? 'from-slate-500 to-slate-700';
  return (
    <Link
      href={`/solutions/${meta.slug}`}
      className="group relative block overflow-hidden rounded-2xl border border-border bg-muted/30 p-6 transition hover:-translate-y-1 hover:border-foreground/40 hover:bg-muted/50 hover:shadow-lg"
    >
      <div className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', accent)} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold">{meta.title}</h3>
            {/* Hidden until a state other than `ready` lights up — keeps the
                home cards calm by default and only flares when something is
                actually happening across the open tabs. */}
            <SolutionStatusBadge slug={meta.slug} hideWhenReady />
          </div>
          <p className="mt-1 text-sm text-foreground/75">{meta.tagline}</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-foreground/60 transition group-hover:translate-x-1 group-hover:text-foreground" />
      </div>
      <ul className="mt-4 space-y-1 text-sm text-foreground/75">
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
            className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs text-foreground/80"
          >
            {tech}
          </span>
        ))}
      </div>
      {meta.models && meta.models.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {meta.models.map((model) => (
            <span
              key={model}
              className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs text-foreground/80"
            >
              {model}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
