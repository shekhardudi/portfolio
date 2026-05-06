/**
 * SSR-safe storage helpers used by the session layer.
 *
 * Server-side renders see no `window`; reads return `null` and writes are
 * silently dropped. Callers wire real values in via a client-only effect
 * (see SessionProvider).
 */

import type { SolutionSlug } from './types';

const SITE_SESSION_KEY = 'site:session';

/** Per-solution session is keyed by slug. */
export function solutionSessionKey(slug: SolutionSlug): string {
  return `solution:${slug}`;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function safeRead(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(storage: Storage | null, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // quota exceeded or storage disabled — drop silently
  }
}

function safeRemove(storage: Storage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function getSession(): Storage | null {
  if (!isBrowser()) return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getLocal(): Storage | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ─── sessionStorage (per-tab, ephemeral) ────────────────────────────────────

export function readSessionJson<T>(key: string): T | null {
  const raw = safeRead(getSession(), key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeSessionJson<T>(key: string, value: T): void {
  safeWrite(getSession(), key, JSON.stringify(value));
}

export function removeSession(key: string): void {
  safeRemove(getSession(), key);
}

// ─── localStorage (cross-tab, durable) ──────────────────────────────────────

export function readLocalJson<T>(key: string): T | null {
  const raw = safeRead(getLocal(), key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeLocalJson<T>(key: string, value: T): void {
  safeWrite(getLocal(), key, JSON.stringify(value));
}

export function removeLocal(key: string): void {
  safeRemove(getLocal(), key);
}

// ─── Convenience site-session entry ─────────────────────────────────────────

export const SITE_SESSION_STORAGE_KEY = SITE_SESSION_KEY;
