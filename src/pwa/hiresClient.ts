import type { HiResState } from './hiresCache.ts';

export interface HiResReply {
  state: HiResState;
  failed: boolean;
}
export interface HiResWorker {
  postMessage(message: unknown, transfer: Transferable[]): void;
}
export interface HiResClientDependencies {
  /** Resolves to the active worker, or null when there is no service worker (development, unsupported). */
  worker(): Promise<HiResWorker | null>;
  channel(): MessageChannel;
  /** Longest silence from the worker before the request counts as failed. */
  timeoutMs?: number;
}

const SILENCE_MS = 20_000;

/** Talks to the service worker about the imagery pack: install, sync, status and delete. */
export function createHiResClient(deps: HiResClientDependencies) {
  async function request(
    type: 'hires-install' | 'hires-sync' | 'hires-status' | 'hires-delete',
    onProgress?: (fraction: number) => void,
  ): Promise<HiResReply> {
    const worker = await deps.worker();
    if (!worker) throw new Error('No service worker');
    const channel = deps.channel();
    return new Promise<HiResReply>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (done: () => void) => {
        clearTimeout(timer);
        channel.port1.close();
        channel.port2.close();
        done();
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => finish(() => reject(new Error('The service worker did not answer'))),
          deps.timeoutMs ?? SILENCE_MS,
        );
      };
      channel.port1.onmessage = (event: MessageEvent<Record<string, unknown> | null>) => {
        const message = event.data;
        if (message?.type === 'progress' && typeof message.done === 'number' && typeof message.total === 'number') {
          arm();
          onProgress?.(message.total > 0 ? message.done / message.total : 1);
        } else if (message?.type === 'result') {
          const state = message.state === 'ready' || message.state === 'partial' ? message.state : 'absent';
          finish(() => resolve({ state, failed: message.failed === true }));
        }
      };
      arm();
      try {
        worker.postMessage({ type }, [channel.port2]);
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error('Could not reach the service worker')));
      }
    });
  }
  return {
    available: async () => (await deps.worker()) !== null,
    install: (onProgress?: (fraction: number) => void) => request('hires-install', onProgress),
    sync: (onProgress?: (fraction: number) => void) => request('hires-sync', onProgress),
    status: () => request('hires-status'),
    remove: () => request('hires-delete'),
  };
}
export type HiResClient = ReturnType<typeof createHiResClient>;
