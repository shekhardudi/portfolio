/**
 * In-memory pub-sub for in-flight demo jobs.
 *
 * Backs the navbar "Session active · N jobs running" pill and the home-card
 * status badges. Lives entirely in module scope (one instance per tab) so
 * subscribers in different React trees see the same registry.
 *
 * The store implements the `Store<T>` shape useSyncExternalStore expects:
 * `subscribe(listener)` + `getSnapshot()` + a stable snapshot reference
 * across no-op updates (we cache `lastSnapshot`).
 */

import type { JobHandle, JobRegistrySnapshot, SolutionSlug } from './types';

type Listener = () => void;

class JobRegistryStore {
  private jobs = new Map<string, JobHandle>();
  private listeners = new Set<Listener>();
  /** Cached so `useSyncExternalStore` sees a stable reference across reads
   *  that didn't change anything (else React detects a "new" snapshot every
   *  render and schedules an infinite re-render). */
  private lastSnapshot: JobRegistrySnapshot = { count: 0, list: [] };
  /** Bumped on every actual mutation; lastSnapshot is rebuilt on demand. */
  private revision = 0;
  private lastSnapshotRevision = 0;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): JobRegistrySnapshot => {
    if (this.revision !== this.lastSnapshotRevision) {
      this.lastSnapshot = {
        count: this.jobs.size,
        list: Array.from(this.jobs.values()),
      };
      this.lastSnapshotRevision = this.revision;
    }
    return this.lastSnapshot;
  };

  /** SSR-safe stub — returns an empty snapshot when there's no DOM. */
  getServerSnapshot = (): JobRegistrySnapshot => EMPTY_SNAPSHOT;

  register(handle: JobHandle): void {
    // Re-registering the same id REPLACES the handle. This matters when
    // a panel remounts and resumes an in-flight job (scout/intelli-search/
    // agentic-hr): the new mount needs its own cancel closure to take
    // effect on Reset-all, and the count must stay flat (no duplicate
    // entry under a sibling id). The previous behaviour was idempotent
    // and silently kept the original cancel callback, which leaked
    // stale closures and — combined with sibling ids — let the count
    // drift above the actual number of running jobs.
    const existed = this.jobs.has(handle.id);
    this.jobs.set(handle.id, handle);
    // Only bump if we actually changed the size — replacing a handle's
    // cancel callback doesn't change the rendered count, but if React
    // consumers care about handle identity we still want them to re-read.
    // bump() is cheap so just always call it.
    if (!existed) this.bump();
  }

  unregister(id: string): void {
    if (!this.jobs.delete(id)) return;
    this.bump();
  }

  list(): JobHandle[] {
    return Array.from(this.jobs.values());
  }

  listForSlug(slug: SolutionSlug): JobHandle[] {
    return this.list().filter((j) => j.slug === slug);
  }

  count(): number {
    return this.jobs.size;
  }

  /**
   * Best-effort cancel + drop. Each handle's `cancel()` is invoked if
   * present; the entry is removed regardless. Polling loops elsewhere
   * detect "I was unregistered" via the version guard, not through this.
   */
  cancelAll(): void {
    for (const handle of this.jobs.values()) {
      try {
        handle.cancel?.();
      } catch {
        /* swallow — we're already shutting down */
      }
    }
    if (this.jobs.size === 0) return;
    this.jobs.clear();
    this.bump();
  }

  cancelForSlug(slug: SolutionSlug): void {
    let mutated = false;
    for (const [id, handle] of this.jobs) {
      if (handle.slug !== slug) continue;
      try {
        handle.cancel?.();
      } catch {
        /* ignore */
      }
      this.jobs.delete(id);
      mutated = true;
    }
    if (mutated) this.bump();
  }

  private bump(): void {
    this.revision += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const EMPTY_SNAPSHOT: JobRegistrySnapshot = { count: 0, list: [] };

/** Single per-tab instance shared by every consumer. */
export const jobRegistry = new JobRegistryStore();
