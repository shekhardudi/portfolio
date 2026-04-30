'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAutocompleteSuggestions } from './client';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  busy?: boolean;
}

export default function IntelliSearchBar({
  query,
  onQueryChange,
  onSubmit,
  busy,
}: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  function selectSuggestion(value: string) {
    onQueryChange(value);
    setOpen(false);
    setActiveIndex(-1);
  }

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setSuggestions([]);
      setActiveIndex(-1);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const list = await getAutocompleteSuggestions(query);
        if (!cancelled) setSuggestions(list.slice(0, 6));
      } catch {
        // ignore fetch errors for autocomplete
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    if (suggestions.length === 0) {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (activeIndex >= suggestions.length) {
      setActiveIndex(suggestions.length - 1);
    }
  }, [open, suggestions, activeIndex]);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
          onSubmit();
        }}
        className="flex flex-wrap gap-2"
      >
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onFocus={() => setOpen(suggestions.length > 0)}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                if (!open && suggestions.length > 0) setOpen(true);
                if (suggestions.length > 0) {
                  e.preventDefault();
                  setActiveIndex((i) => (i + 1) % suggestions.length);
                }
                return;
              }

              if (e.key === 'ArrowUp') {
                if (suggestions.length > 0) {
                  e.preventDefault();
                  setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                }
                return;
              }

              if (e.key === 'Enter' && open && activeIndex >= 0 && activeIndex < suggestions.length) {
                e.preventDefault();
                selectSuggestion(suggestions[activeIndex]);
              }
            }}
            placeholder="search companies"
            className="h-11 w-full bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>

        <button
          type="submit"
          disabled={busy || !query.trim()}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
        </button>
      </form>

      {open && suggestions.length > 0 && (
        <ul className={cn(
          'absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg',
        )}>
          {suggestions.map((s, idx) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent input blur
                  selectSuggestion(s);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                  idx === activeIndex && 'bg-muted',
                )}
              >
                <Search className="h-3 w-3 text-muted-foreground" />
                <span>{s}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
