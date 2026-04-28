/**
 * Tiny fetch wrapper used by every solution client.
 * - Adds a default 30s timeout (configurable per call)
 * - Normalizes errors into ApiError with status + body excerpt
 * - Knows how to follow SSE streams via fetchEventSource-light
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message?: string,
  ) {
    super(message ?? `API error ${status}`);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiFetch<T = unknown>(
  url: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { timeoutMs = 30_000, headers, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiError(res.status, body);
    }

    if (res.status === 204) return undefined as T;

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stream Server-Sent Events from a URL. Calls onMessage for each `data:` line.
 * Returns a cancel() function to abort early.
 */
export function streamSSE(
  url: string,
  onMessage: (data: string) => void,
  opts: { onError?: (e: Error) => void; signal?: AbortSignal } = {},
): () => void {
  const ctrl = new AbortController();
  const merged = mergeSignals(ctrl.signal, opts.signal);

  (async () => {
    try {
      const res = await fetch(url, { signal: merged });
      if (!res.ok || !res.body) {
        throw new ApiError(res.status, await res.text().catch(() => ''));
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nlIdx;
        while ((nlIdx = buf.indexOf('\n\n')) !== -1) {
          const event = buf.slice(0, nlIdx);
          buf = buf.slice(nlIdx + 2);
          for (const line of event.split('\n')) {
            if (line.startsWith('data:')) {
              onMessage(line.slice(5).trim());
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        opts.onError?.(e as Error);
      }
    }
  })();

  return () => ctrl.abort();
}

function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  if (a.aborted || b.aborted) ctrl.abort();
  return ctrl.signal;
}
