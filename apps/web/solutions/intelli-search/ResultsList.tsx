'use client';

import { useMemo, useState } from 'react';
import {
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Linkedin,
  MapPin,
  Newspaper,
  Tag,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { intentConfig } from './intent';
import type { LinkedinProfile, SearchHit, SearchResponse } from './client';

type SortKey = 'relevance' | 'name' | 'year';

const AVATAR_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#14b8a6', '#f97316',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '') || parts[0]?.[0] || '?';
}

const PAGE_SIZE = 8;

interface Props {
  response: SearchResponse;
  searchQuery: string;
  /** Number of AI-extracted highlights currently active in the filter panel. */
  aiFiltersActive?: number;
  /** Callback fired by the "Clear AI filters" button on the banner. */
  onClearAiFilters?: () => void;
}

export default function ResultsList({
  response,
  searchQuery,
  aiFiltersActive = 0,
  onClearAiFilters,
}: Props) {
  const [sort, setSort] = useState<SortKey>('relevance');
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const list = [...response.hits];
    if (sort === 'name') list.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
    else if (sort === 'year')
      list.sort((a, b) => (b.year_founded ?? 0) - (a.year_founded ?? 0));
    else list.sort((a, b) => b.score - a.score);
    return list;
  }, [response.hits, sort]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cfg = intentConfig(response.classifier_intent);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-foreground/75">
        No results.
      </div>
    );
  }

  const reasoning =
    typeof response.metadata?.query_classification?.reasoning === 'string'
      ? response.metadata.query_classification.reasoning
      : null;

  return (
    <section className="space-y-3">
      <div
        className="flex flex-wrap items-start justify-between gap-2 rounded-lg border bg-gradient-to-r from-indigo-900/40 to-blue-900/40 px-3 py-2.5 text-sm"
        style={{ borderColor: `${cfg.color}55` }}
      >
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: cfg.color }} />
            <span className="font-medium">{cfg.banner(searchQuery, total)}</span>
          </span>
          {reasoning && (
            <span className="text-xs italic text-foreground/75">
              {reasoning}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {aiFiltersActive > 0 && onClearAiFilters && (
            <button
              onClick={onClearAiFilters}
              className="rounded-md border border-violet-400/50 bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-100 hover:bg-violet-500/25"
            >
              Clear AI filters · {aiFiltersActive}
            </button>
          )}
          <span
            className="rounded-md px-2 py-0.5 text-xs font-semibold text-white"
            style={{ background: cfg.color }}
          >
            {cfg.label}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/70">
        <span>
          Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          {response.duration_ms ? ` · ${response.duration_ms}ms` : ''}
        </span>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-foreground/60">Sort</span>
          {(['relevance', 'name', 'year'] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setSort(k);
                setPage(1);
              }}
              className={cn(
                'rounded-full border px-2 py-0.5 transition',
                sort === k
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-foreground/75 hover:text-foreground',
              )}
            >
              {k === 'relevance' ? 'Relevance' : k === 'name' ? 'Name' : 'Year founded'}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {pageItems.map((h) => (
          <ResultRow key={h.id} hit={h} />
        ))}
      </ul>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-50"
          >
            <ChevronLeft className="h-3 w-3" /> prev
          </button>
          <span className="text-foreground/70">
            page {page} / {pages}
          </span>
          <button
            disabled={page === pages}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-50"
          >
            next <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </section>
  );
}

function ResultRow({ hit }: { hit: SearchHit }) {
  const name = hit.title ?? hit.id;
  const pct = Math.round((hit.score ?? 0) * 100);
  const tone =
    hit.score >= 0.8
      ? { dot: 'bg-emerald-400', badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' }
      : hit.score >= 0.5
        ? { dot: 'bg-amber-400', badge: 'border-amber-500/40 bg-amber-500/15 text-amber-200' }
        : { dot: 'bg-slate-400', badge: 'border-border text-foreground/70' };
  return (
    <li className="flex gap-4 p-4">
      <CompanyLogo domain={hit.domain} name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn('h-2 w-2 shrink-0 rounded-full', tone.dot)}
              title={`Relevance ${pct}%`}
            />
            {hit.url ? (
              <a
                href={hit.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-base font-semibold hover:underline"
              >
                {name}
              </a>
            ) : (
              <span className="truncate text-base font-semibold">{name}</span>
            )}
            {hit.domain && (
              <a
                href={`https://${hit.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-xs text-foreground/60 hover:text-foreground/85 hover:underline"
              >
                {hit.domain}
              </a>
            )}
          </div>
          <span
            className={cn(
              'rounded-md border px-2 py-0.5 font-mono text-xs font-semibold',
              tone.badge,
            )}
            title={`Score ${hit.score.toFixed(3)}`}
          >
            {pct}% match
          </span>
        </div>

        {/* Pill-chip metadata row */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {hit.industry && <Pill icon={<Building2 className="h-3 w-3" />}>{hit.industry}</Pill>}
          {hit.size_range && <Pill icon={<Users className="h-3 w-3" />}>{hit.size_range}</Pill>}
          {hit.year_founded && (
            <Pill icon={<Calendar className="h-3 w-3" />}>Est. {hit.year_founded}</Pill>
          )}
          {hit.location && <Pill icon={<MapPin className="h-3 w-3" />}>{hit.location}</Pill>}
          {hit.current_employee_estimate != null && (
            <Pill icon={<Users className="h-3 w-3" />}>
              ~{hit.current_employee_estimate.toLocaleString()} employees
            </Pill>
          )}
        </div>

        {/* LinkedIn URL — prominent, dedicated row */}
        {hit.linkedin_url && (
          <a
            href={hit.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#0A66C2]/40 bg-[#0A66C2]/10 px-2 py-1 text-xs font-medium text-[#7CB9FF] hover:bg-[#0A66C2]/20"
          >
            <Linkedin className="h-3.5 w-3.5" />
            <span className="truncate">{hit.linkedin_url.replace(/^https?:\/\//, '')}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {(hit.summary || hit.matching_reason) && (
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">
            {hit.summary ?? `💡 ${hit.matching_reason}`}
          </p>
        )}
        {(hit.search_method || hit.ranking_source) && (
          <div className="mt-1.5 text-[10px] uppercase tracking-wider text-foreground/55">
            {[hit.search_method, hit.ranking_source].filter(Boolean).join(' / ')}
          </div>
        )}

        {hit.linkedin_profile && <ProfileBlock profile={hit.linkedin_profile} />}
        {hit.event_data && Object.keys(hit.event_data).length > 0 && (
          <RecentActivity data={hit.event_data} />
        )}
      </div>
    </li>
  );
}

function Pill({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground/85">
      {icon && <span className="text-foreground/60">{icon}</span>}
      {children}
    </span>
  );
}

function CompanyLogo({ domain, name }: { domain?: string | null; name: string }) {
  const [errored, setErrored] = useState(false);
  const showFavicon = domain && !errored;
  if (showFavicon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
        alt=""
        onError={() => setErrored(true)}
        className="h-11 w-11 shrink-0 rounded-md border border-border bg-background object-contain p-1.5"
      />
    );
  }
  const color = getAvatarColor(name);
  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white"
      style={{ background: color }}
    >
      {initials(name).toUpperCase()}
    </div>
  );
}

function ProfileBlock({ profile }: { profile: LinkedinProfile }) {
  const specs = profile.specialties ?? [];
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
        Profile
      </div>
      <div className="mt-2 space-y-1.5 text-sm text-foreground/85">
        {profile.description && (
          <p className="leading-relaxed">{profile.description}</p>
        )}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {profile.headquarters && (
            <ProfileMeta icon={<MapPin className="h-3.5 w-3.5" />} label="Headquarters" value={profile.headquarters} />
          )}
          {profile.company_size && (
            <ProfileMeta icon={<Users className="h-3.5 w-3.5" />} label="Size" value={profile.company_size} />
          )}
          {profile.industry && (
            <ProfileMeta icon={<Building2 className="h-3.5 w-3.5" />} label="Industry" value={profile.industry} />
          )}
          {profile.founded_year && (
            <ProfileMeta icon={<Calendar className="h-3.5 w-3.5" />} label="Founded" value={String(profile.founded_year)} />
          )}
          {profile.website && (
            <ProfileMeta
              icon={<Globe className="h-3.5 w-3.5" />}
              label="Website"
              value={
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline hover:text-foreground"
                >
                  {profile.website.replace(/^https?:\/\//, '')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              }
            />
          )}
        </div>
        {specs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Tag className="h-3.5 w-3.5 text-foreground/65" />
            {specs.map((s) => (
              <span
                key={s}
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground/80"
              >
                {s}
              </span>
            ))}
          </div>
        )}
        {profile.recent_updates && (
          <p className="text-xs italic text-foreground/70">{profile.recent_updates}</p>
        )}
      </div>
    </div>
  );
}

function ProfileMeta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-foreground/65">{icon}</span>
      <span className="text-xs uppercase tracking-wider text-foreground/65">{label}:</span>
      <span className="text-sm text-foreground/90">{value}</span>
    </div>
  );
}

function RecentActivity({ data }: { data: Record<string, unknown> }) {
  const sourceUrl = typeof data.source_url === 'string' ? data.source_url : null;
  const headline =
    (typeof data.headline === 'string' && data.headline) ||
    (typeof data.title === 'string' && data.title) ||
    null;
  const summary =
    (typeof data.summary === 'string' && data.summary) ||
    (typeof data.description === 'string' && data.description) ||
    null;
  const publishedAt =
    (typeof data.published_at === 'string' && data.published_at) ||
    (typeof data.date === 'string' && data.date) ||
    null;

  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-200">
        <Newspaper className="h-3.5 w-3.5" /> Recent activity
      </div>
      {headline && (
        <div className="mt-1 text-sm font-medium text-foreground/90">{headline}</div>
      )}
      {summary && (
        <p className="mt-1 text-sm text-foreground/80">{summary}</p>
      )}
      {publishedAt && (
        <div className="mt-1 text-xs text-foreground/65">{publishedAt}</div>
      )}
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-sm text-amber-200 hover:underline"
        >
          Read full article <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
