'use client';

import { Database, ExternalLink, GitBranch, Lock, MessageSquare } from 'lucide-react';
import { INTEGRATIONS } from './integrations';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  NocoDB: Database,
  Gitea: GitBranch,
  Mattermost: MessageSquare,
};

export default function Integrations() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {INTEGRATIONS.map((t) => {
        const Icon = ICONS[t.name] ?? Database;
        return (
          <a
            key={t.name}
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-border bg-muted/40 p-4 transition hover:border-foreground/40 hover:bg-muted/60"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-background text-foreground/85">
                <Icon className="h-5 w-5" />
              </span>
              <ExternalLink className="h-4 w-4 text-foreground/55 transition group-hover:text-foreground" />
            </div>
            <h4 className="mt-3 text-base font-semibold">{t.name}</h4>
            <span className="mt-1 inline-block rounded-md border border-border bg-background px-1.5 py-0.5 text-xs uppercase tracking-wider text-foreground/70">
              {t.category}
            </span>
            <p className="mt-2 text-sm text-foreground/80">{t.description}</p>
          </a>
        );
      })}
      <p className="col-span-full inline-flex items-center gap-1.5 text-xs text-foreground/65">
        <Lock className="h-3.5 w-3.5" /> Self-signed certs in dev — pages may take a few seconds to load on first visit.
      </p>
    </div>
  );
}
