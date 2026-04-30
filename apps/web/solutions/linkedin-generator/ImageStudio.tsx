'use client';

import { useState } from 'react';
import { Download, ExternalLink, ImageIcon, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { EndpointMissingError, LINKEDIN_API_BASE, generateImage } from './client';
import type { DemoAction, DemoState } from './useDemoState';

interface Props {
  state: DemoState;
  dispatch: React.Dispatch<DemoAction>;
}

export default function ImageStudio({ state, dispatch }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  function patch(p: Partial<DemoState>) {
    dispatch({ type: 'PATCH', payload: p });
  }

  async function generate() {
    if (!state.dalle_prompt.trim()) return;
    setBusy(true);
    setError(null);
    setUnavailable(false);
    try {
      const { image_url } = await generateImage(state.dalle_prompt);
      patch({ image_url });
    } catch (e) {
      if (e instanceof EndpointMissingError) setUnavailable(true);
      else setError(e instanceof ApiError ? `${e.status} — ${e.body}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-5">
      <h4 className="mb-2 flex items-center gap-1 text-sm font-semibold">
        <ImageIcon className="h-4 w-4" /> Image
      </h4>

      <textarea
        value={state.dalle_prompt}
        onChange={(e) => patch({ dalle_prompt: e.target.value })}
        rows={4}
        placeholder="DALL-E prompt — derived from the critic output if available…"
        className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-1 focus:ring-ring"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={generate}
          disabled={busy || !state.dalle_prompt.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
          Generate
        </button>
        {state.image_url && (
          <a
            href={state.image_url}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
          >
            <Download className="h-3 w-3" /> Download
          </a>
        )}
        {error && (
          <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300">
            {error}
          </span>
        )}
      </div>

      {unavailable && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          Image generation isn&apos;t enabled on this backend yet —{' '}
          <a
            className="inline-flex items-center gap-1 underline"
            href={`${LINKEDIN_API_BASE}/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            run on live app <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {state.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={state.image_url}
          alt="Generated cover"
          className="mt-4 max-h-96 w-full rounded-md border border-border object-contain"
        />
      ) : (
        <div className="mt-4 flex h-48 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          No image yet — generate one with the prompt above.
        </div>
      )}
    </div>
  );
}
