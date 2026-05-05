'use client';

import { useState } from 'react';
import {
  Download,
  ExternalLink,
  ImageIcon,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  EndpointMissingError,
  LINKEDIN_API_BASE,
  generateImage as apiGenerateImage,
  imageHref,
} from './client';
import type { DemoAction, DemoState, GeneratedImage } from './useDemoState';

interface Props {
  state: DemoState;
  dispatch: React.Dispatch<DemoAction>;
}

const QUALITY: Array<{
  key: 'low' | 'medium' | 'high';
  label: string;
  est: string;
  desc: string;
}> = [
  { key: 'low',    label: 'Low',    est: '≈12s',  desc: 'fast iteration' },
  { key: 'medium', label: 'Medium', est: '≈30s',  desc: 'LinkedIn sweet spot' },
  { key: 'high',   label: 'High',   est: '≈70s',  desc: 'press-ready' },
];

export default function ImageStudio({ state, dispatch }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  function patch(p: Partial<DemoState>) {
    dispatch({ type: 'PATCH', payload: p });
  }

  async function generate() {
    if (!state.image_prompt.trim() || !state.current_job_id) return;
    setBusy(true);
    setError(null);
    setUnavailable(false);
    try {
      const resp = await apiGenerateImage({
        job_id: state.current_job_id,
        prompt: state.image_prompt.trim(),
        quality: state.image_quality,
      });
      const newImg: GeneratedImage = {
        image_id: resp.image_id,
        image_url: resp.image_url,
        prompt: state.image_prompt.trim(),
        quality: state.image_quality,
        ts: new Date().toISOString(),
      };
      // Update cost as well — we don't have the cost in the response, but we
      // can ask the post job for its latest cost breakdown after generation.
      try {
        const { getPost } = await import('./client');
        const job = await getPost(state.current_job_id);
        const cost = job.result?.cost_breakdown ?? null;
        dispatch({ type: 'IMAGE_ADDED', image: newImg, cost });
      } catch {
        dispatch({ type: 'IMAGE_ADDED', image: newImg });
      }
      setActiveIdx(state.images.length); // jump to the new one
    } catch (e) {
      if (e instanceof EndpointMissingError) setUnavailable(true);
      else setError(e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canGenerate =
    Boolean(state.current_job_id) && state.image_prompt.trim().length >= 10 && !busy;

  const active = state.images[activeIdx] ?? state.images[state.images.length - 1];

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-2 flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-foreground/85" />
        <h4 className="text-sm font-semibold">Cover image studio</h4>
        {state.images.length > 0 && (
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10.5px] text-foreground/70">
            {state.images.length} render{state.images.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-xs text-foreground/65">
        Visual Director suggests the prompt — edit it freely and regenerate as many times as you
        like. Each render costs $$, so iterate at low quality first.
      </p>

      <textarea
        value={state.image_prompt}
        onChange={(e) => patch({ image_prompt: e.target.value })}
        rows={4}
        placeholder="Visual Director prompt — derived from emotional beats + post draft."
        className="mt-3 w-full resize-y rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-1 focus:ring-ring"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-border">
          {QUALITY.map((q) => (
            <button
              key={q.key}
              type="button"
              disabled={busy}
              onClick={() => patch({ image_quality: q.key })}
              title={`${q.label} — ${q.est} · ${q.desc}`}
              className={cn(
                'px-2.5 py-1.5 text-[11.5px] font-medium transition disabled:opacity-50',
                state.image_quality === q.key
                  ? 'bg-foreground text-background'
                  : 'bg-background text-foreground/75 hover:bg-muted',
              )}
            >
              {q.label}
              <span className="ml-1 text-[10px] opacity-70">{q.est}</span>
            </button>
          ))}
        </div>

        <button
          onClick={generate}
          disabled={!canGenerate}
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          {busy ? `Generating (${state.image_quality})…` : state.images.length === 0 ? 'Generate image' : 'Regenerate'}
        </button>

        {!state.current_job_id && (
          <span className="text-[11px] text-foreground/55">
            Generate a post first — image gen needs the run id.
          </span>
        )}
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {unavailable && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200">
          Image generation isn&apos;t reachable —{' '}
          <a
            className="inline-flex items-center gap-1 underline"
            href={LINKEDIN_API_BASE}
            target="_blank"
            rel="noopener noreferrer"
          >
            run on the live app <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {/* Active image preview */}
      <div className="mt-4">
        {active ? (
          <div className="rounded-lg border border-border bg-background p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageHref(active.image_url || active.image_id)}
              alt={active.prompt}
              className="mx-auto max-h-[420px] w-full rounded-md object-contain"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-foreground/65">
              <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono">{active.image_id}</code>
              <span className="rounded-full border border-border px-1.5 py-0.5">
                {active.quality}
              </span>
              <a
                href={imageHref(active.image_url || active.image_id)}
                target="_blank"
                rel="noopener noreferrer"
                download={`${active.image_id}.png`}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
              >
                <Download className="h-3 w-3" /> Download
              </a>
            </div>
          </div>
        ) : busy ? (
          <BusyPlate quality={state.image_quality} />
        ) : (
          <div className="flex h-44 items-center justify-center rounded-md border border-dashed border-border text-xs text-foreground/55">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              No image yet — choose quality and hit Generate.
            </span>
          </div>
        )}
      </div>

      {/* Gallery — older renders */}
      {state.images.length > 1 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/65">
            Gallery
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {state.images.map((img, i) => (
              <button
                key={img.image_id}
                type="button"
                onClick={() => setActiveIdx(i)}
                className={cn(
                  'overflow-hidden rounded-md border transition',
                  i === activeIdx
                    ? 'border-foreground ring-1 ring-foreground/40'
                    : 'border-border hover:border-foreground/40',
                )}
                title={img.prompt}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageHref(img.image_url || img.image_id)}
                  alt={img.prompt}
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BusyPlate({ quality }: { quality: 'low' | 'medium' | 'high' }) {
  const eta = quality === 'low' ? '≈12s' : quality === 'high' ? '≈70s' : '≈30s';
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-foreground/20 bg-muted/30">
      <div className="relative h-12 w-12">
        <span className="absolute inset-0 rounded-full bg-foreground/10 [animation:ping_1.6s_cubic-bezier(0,0,0.2,1)_infinite]" />
        <span className="absolute inset-0 inline-flex items-center justify-center">
          <ImageIcon className="h-5 w-5 text-foreground/70" />
        </span>
      </div>
      <p className="text-[12.5px] font-medium text-foreground/85">Painting cover image…</p>
      <p className="text-[11px] text-foreground/55">{quality} quality · {eta}</p>
    </div>
  );
}
