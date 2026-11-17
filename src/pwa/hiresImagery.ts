import hiresPack from '../data/generated/hires-pack.json' with { type: 'json' };
import { roundedMegabytes, type HiResManifest } from '../lib/hiresPack.ts';
import { loadHighResImagery, saveHighResImagery } from '../state/storage.ts';
import { createHiResClient, type HiResClient } from './hiresClient.ts';

export interface HiResImageryState {
  /** False where the pack cannot be stored: no service worker (development, some private modes). */
  supported: boolean;
  /** The saved choice. Only a completed download keeps it on. */
  enabled: boolean;
  status: 'off' | 'downloading' | 'ready' | 'failed';
  /** Download progress, 0 … 1. */
  progress: number;
  /** The confirmation question is open. */
  confirming: boolean;
  /** Real size of the pack in whole megabytes, from the build's manifest. */
  megabytes: number;
}

export interface HiResImageryDependencies {
  client: HiResClient | null;
  load(): boolean | null;
  save(on: boolean): void;
  bytes: number;
}

/**
 * The opt-in full-resolution imagery pack. Off unless the visitor confirmed the download; a failed download
 * leaves it off with nothing stored; turning it off deletes the stored pack. The globe uses the tiles only
 * while the status is `ready`.
 */
export function createHiResImagery(deps: HiResImageryDependencies) {
  let state: HiResImageryState = {
    supported: !!deps.client,
    enabled: false,
    status: 'off',
    progress: 0,
    confirming: false,
    megabytes: roundedMegabytes(deps.bytes),
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<HiResImageryState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  /** Each start or removal supersedes the one before; stale results are ignored. */
  let generation = 0;
  let started = false;

  const run = async (kind: 'install' | 'sync') => {
    const client = deps.client;
    if (!client) return;
    const mine = ++generation;
    set({ enabled: true, status: 'downloading', progress: 0, confirming: false });
    try {
      const reply = await client[kind]((progress) => {
        if (mine === generation) set({ progress });
      });
      if (mine !== generation) return;
      if (reply.state === 'ready' && !reply.failed) {
        set({ enabled: true, status: 'ready', progress: 1 });
      } else if (kind === 'sync' && reply.state === 'absent' && !reply.failed) {
        // The stored pack is gone (the browser cleared it). Do not quietly download it again.
        deps.save(false);
        set({ enabled: false, status: 'off', progress: 0 });
      } else {
        throw new Error('Imagery pack incomplete');
      }
    } catch {
      if (mine !== generation) return;
      if (kind === 'install') {
        // The worker removes a partial pack on failure; make the choice match what is stored.
        deps.save(false);
        set({ enabled: false, status: 'failed', progress: 0 });
      } else {
        // An update failed: what is stored stays, the globe keeps its current maps, and the next visit retries.
        set({ enabled: true, status: 'failed', progress: 0 });
      }
    }
  };

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** On startup: a saved "on" brings the stored pack up to date; nothing is downloaded when it is off. */
    start() {
      if (started || !deps.client) return;
      started = true;
      if (deps.load() === true) void run('sync');
    },
    /** The switch was turned on: ask first. */
    ask() {
      if (state.supported && !state.enabled && state.status !== 'downloading') set({ confirming: true, status: 'off' });
    },
    /** The question was declined or dismissed: nothing changes and nothing is downloaded. */
    cancel() {
      if (state.confirming) set({ confirming: false });
    },
    /** The question was confirmed: remember the choice and start the download. */
    confirm() {
      if (!state.confirming) return;
      deps.save(true);
      void run('install');
    },
    /** Switch off: back to the current textures, and the stored pack deleted. */
    async disable() {
      generation++;
      deps.save(false);
      set({ enabled: false, status: 'off', progress: 0, confirming: false });
      try {
        await deps.client?.remove();
      } catch {
        // Without a worker there is nothing stored to delete.
      }
    },
  };
}
export type HiResImagery = ReturnType<typeof createHiResImagery>;

function browserClient(): HiResClient | null {
  try {
    if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    const container = navigator.serviceWorker;
    return createHiResClient({
      worker: async () => {
        const ready = await Promise.race([
          container.ready,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
        return ready?.active ?? null;
      },
      channel: () => new MessageChannel(),
    });
  } catch {
    return null;
  }
}

export const hiresImagery = createHiResImagery({
  client: browserClient(),
  load: loadHighResImagery,
  save: saveHighResImagery,
  bytes: (hiresPack as HiResManifest).bytes,
});
