'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getCountryFacets,
  getCityFacets,
  getIndustryFacets,
  getStateFacets,
  type UserFilters,
} from './client';
import { SIZE_OPTIONS } from './data/industries';

export interface FiltersState {
  industries: string[];
  size_range?: string;
  country?: string;
  state?: string;
  city?: string;
  year_from?: number;
  year_to?: number;
}

export const EMPTY_FILTERS: FiltersState = {
  industries: [],
  size_range: undefined,
  country: '',
  state: '',
  city: '',
  year_from: undefined,
  year_to: undefined,
};

interface Props {
  filters: FiltersState;
  onChange: (next: FiltersState) => void;
  /** Chip labels that overlap a filter value — get a glow */
  aiHighlights?: { industries?: string[]; country?: string };
  className?: string;
}

export default function FilterPanel({ filters, onChange, aiHighlights, className }: Props) {
  const [industryOptions, setIndustryOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [stateOptions, setStateOptions] = useState<string[]>([]);
  const [cityOptions, setCityOptions] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const [industries, countries] = await Promise.all([
          getIndustryFacets(ctrl.signal),
          getCountryFacets(ctrl.signal),
        ]);
        if (!mounted) return;
        setIndustryOptions(industries);
        setCountryOptions(countries);
      } catch {
        if (!mounted) return;
        setIndustryOptions([]);
        setCountryOptions([]);
      }
    })();

    return () => {
      mounted = false;
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const ctrl = new AbortController();

    if (!filters.country) {
      setStateOptions([]);
      return () => {
        mounted = false;
        ctrl.abort();
      };
    }

    (async () => {
      try {
        const states = await getStateFacets(filters.country ?? '', ctrl.signal);
        if (!mounted) return;
        setStateOptions(states);
      } catch {
        if (!mounted) return;
        setStateOptions([]);
      }
    })();

    return () => {
      mounted = false;
      ctrl.abort();
    };
  }, [filters.country]);

  useEffect(() => {
    let mounted = true;
    const ctrl = new AbortController();

    if (!filters.country || !filters.state) {
      setCityOptions([]);
      return () => {
        mounted = false;
        ctrl.abort();
      };
    }

    (async () => {
      try {
        const cities = await getCityFacets(filters.country ?? '', filters.state ?? '', ctrl.signal);
        if (!mounted) return;
        setCityOptions(cities);
      } catch {
        if (!mounted) return;
        setCityOptions([]);
      }
    })();

    return () => {
      mounted = false;
      ctrl.abort();
    };
  }, [filters.country, filters.state]);

  const topIndustries = industryOptions.slice(0, 10);

  // Trigger a 2-pulse glow animation whenever the AI-extracted highlight set changes.
  // pulseKey changes → React re-mounts the chips that match → CSS animation runs again.
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    setPulseKey((k) => k + 1);
  }, [aiHighlights?.industries?.join('|'), aiHighlights?.country]);

  function toggleIndustry(name: string) {
    const next = filters.industries.includes(name)
      ? filters.industries.filter((i) => i !== name)
      : [...filters.industries, name];
    onChange({ ...filters, industries: next });
  }

  const hasGlow =
    !!(aiHighlights?.industries && aiHighlights.industries.length > 0) ||
    !!aiHighlights?.country;

  const hasActiveFilters =
    filters.industries.length > 0 ||
    !!filters.size_range ||
    !!filters.country ||
    !!filters.state ||
    !!filters.city ||
    filters.year_from != null ||
    filters.year_to != null;

  function clearAi() {
    // Removes only the AI-highlighted parts; leaves user picks alone.
    const next = { ...filters };
    if (aiHighlights?.industries) {
      next.industries = filters.industries.filter(
        (i) => !aiHighlights.industries!.includes(i),
      );
    }
    if (aiHighlights?.country && next.country === aiHighlights.country) {
      next.country = '';
    }
    onChange(next);
  }

  function clearAll() {
    onChange({ ...EMPTY_FILTERS });
  }

  return (
    <aside className={cn('space-y-5 rounded-xl border border-border bg-muted/40 p-4', className)}>
      <header className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Filters</h4>
        <div className="flex items-center gap-2">
          {hasGlow && (
            <button
              type="button"
              onClick={clearAi}
              className="inline-flex items-center gap-1 text-xs text-foreground/75 hover:text-foreground"
            >
              <Sparkles className="h-3 w-3" /> Clear AI
            </button>
          )}
          <button
            type="button"
            onClick={clearAll}
            disabled={!hasActiveFilters}
            className="inline-flex items-center gap-1.5 rounded-md border border-foreground/25 bg-foreground/10 px-2.5 py-1 text-sm font-medium text-foreground hover:bg-foreground/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Clear all
          </button>
        </div>
      </header>

      {/* Industries */}
      <Section label="Industries">
        {topIndustries.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {topIndustries.map((name) => {
              const active = filters.industries.includes(name);
              const glow = aiHighlights?.industries?.includes(name);
              return (
                <button
                  key={glow ? `${name}-${pulseKey}` : name}
                  type="button"
                  onClick={() => toggleIndustry(name)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition',
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground/75 hover:text-foreground',
                    glow && !active && 'animate-ai-pulse border-violet-500/60 bg-violet-500/15 text-violet-100',
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-foreground/65">No industry facets available.</div>
        )}
        {filters.industries.length > 0 && (
          <button
            onClick={() => onChange({ ...filters, industries: [] })}
            className="mt-2 inline-flex items-center gap-1 text-xs text-foreground/75 hover:text-foreground"
          >
            <X className="h-3 w-3" /> clear ({filters.industries.length})
          </button>
        )}
      </Section>

      {/* Size */}
      <Section label="Company size">
        <div className="flex flex-wrap gap-1.5">
          {SIZE_OPTIONS.map(({ label, value }) => {
            const active = filters.size_range === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() =>
                  onChange({ ...filters, size_range: active ? undefined : value })
                }
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition',
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-foreground/75 hover:text-foreground',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Location */}
      <Section label="Location">
        <div className="grid grid-cols-1 gap-2">
          <CountrySelect
            options={countryOptions}
            value={filters.country ?? ''}
            onChange={(v) => onChange({ ...filters, country: v })}
            glow={!!aiHighlights?.country && filters.country === aiHighlights.country}
          />
          <StateSelect
            options={stateOptions}
            disabled={!filters.country}
            label="State"
            value={filters.state ?? ''}
            onChange={(v) => onChange({ ...filters, state: v, city: '' })}
          />
          <CitySelect
            options={cityOptions}
            disabled={!filters.state}
            value={filters.city ?? ''}
            onChange={(v) => onChange({ ...filters, city: v })}
          />
        </div>
      </Section>

      {/* Year range */}
      <Section label="Founded">
        <div className="flex items-center gap-2">
          <NumInput
            placeholder="from"
            value={filters.year_from}
            onChange={(v) => onChange({ ...filters, year_from: v })}
          />
          <span className="text-xs text-foreground/75">–</span>
          <NumInput
            placeholder="to"
            value={filters.year_to}
            onChange={(v) => onChange({ ...filters, year_to: v })}
          />
        </div>
      </Section>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/80">
        {label}
      </div>
      {children}
    </div>
  );
}

function CountrySelect({
  options,
  value,
  onChange,
  glow,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  glow?: boolean;
}) {
  return (
    <label className="block">
      <span className="sr-only">Country</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring',
          glow && 'ring-1 ring-violet-500/50',
        )}
      >
        <option value="">All countries</option>
        {options.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

function StateSelect({
  options,
  label,
  value,
  onChange,
  disabled,
}: {
  options: string[];
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">All states</option>
        {options.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </label>
  );
}

function CitySelect({
  options,
  value,
  onChange,
  disabled,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="sr-only">City</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">All cities</option>
        {options.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  glow,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  glow?: boolean;
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        className={cn(
          'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring',
          glow && 'ring-1 ring-violet-500/50',
        )}
      />
    </label>
  );
}

function NumInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value?: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <input
      type="number"
      min={1800}
      max={2100}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) =>
        onChange(e.target.value === '' ? undefined : Number(e.target.value))
      }
      className="w-24 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

export function filtersToBackend(f: FiltersState): UserFilters | undefined {
  const out: UserFilters = {};
  if (f.industries.length) out.industries = f.industries;
  if (f.size_range) out.size_range = f.size_range;
  if (f.country) out.country = f.country;
  if (f.state) out.state = f.state;
  if (f.city) out.city = f.city;
  if (f.year_from != null) out.year_from = f.year_from;
  if (f.year_to != null) out.year_to = f.year_to;
  return Object.keys(out).length ? out : undefined;
}
