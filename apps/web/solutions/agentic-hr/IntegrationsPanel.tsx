'use client';

import {
  CheckCircle2,
  Database,
  ExternalLink,
  GitBranch,
  Link2,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { INTEGRATIONS } from './integrations';

const ICONS: Record<string, LucideIcon> = {
  NocoDB: Database,
  Gitea: GitBranch,
  Mattermost: MessageSquare,
};

interface Props {
  className?: string;
}

export default function Integrations({ className }: Props) {
  return (
    <aside className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-muted/40', className)}>
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/85 px-3 py-2 text-sm font-semibold text-foreground/90 backdrop-blur">
        <Link2 className="h-4 w-4" />
        Integrations
      </header>
      <ul className="flex-1 space-y-3 overflow-y-auto p-3.5">
        {INTEGRATIONS.map((t) => {
          const Icon = ICONS[t.name] ?? Database;
          return (
            <li key={t.name}>
              <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block rounded-xl border border-border bg-background/75 p-3 transition hover:border-foreground/35 hover:bg-background"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/50 text-foreground/90">
                    <Icon className="h-4 w-4" />
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-foreground/50 transition group-hover:text-foreground/85" />
                </div>
                <div className="mt-2">
                  <div className="text-sm font-semibold text-foreground/95">{t.name}</div>
                  <div className="text-[11px] text-foreground/65">{t.category}</div>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/80">{t.description}</p>
                </div>
                <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Live
                </div>
              </a>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border px-3 py-2 text-[11px] text-foreground/65">
        These systems back every chat and approval action.
      </p>
    </aside>
  );
}
