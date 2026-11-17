import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHiResClient } from './hiresClient.ts';

afterEach(() => vi.useRealTimers());

function channel() {
  const port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
  const port2 = { postMessage: (data: unknown) => port1.onmessage?.({ data }), close: vi.fn() };
  return { port1, port2 } as unknown as MessageChannel;
}

describe('imagery pack client', () => {
  it('relays progress and the final state', async () => {
    const worker = {
      postMessage: vi.fn((_message: unknown, transfer: Transferable[]) => {
        const port = transfer[0] as MessagePort;
        port.postMessage({ type: 'progress', done: 1, total: 4 });
        port.postMessage({ type: 'result', state: 'ready', failed: false });
      }),
    };
    const client = createHiResClient({ worker: async () => worker, channel });
    const progress = vi.fn();
    await expect(client.install(progress)).resolves.toEqual({ state: 'ready', failed: false });
    expect(worker.postMessage.mock.calls[0][0]).toEqual({ type: 'hires-install' });
    expect(progress).toHaveBeenCalledWith(0.25);
  });
  it('sends sync and delete requests', async () => {
    const types: unknown[] = [];
    const worker = {
      postMessage: (message: unknown, transfer: Transferable[]) => {
        types.push((message as { type: string }).type);
        (transfer[0] as MessagePort).postMessage({ type: 'result', state: 'absent', failed: false });
      },
    };
    const client = createHiResClient({ worker: async () => worker, channel });
    await client.sync();
    await client.remove();
    expect(types).toEqual(['hires-sync', 'hires-delete']);
  });
  it('fails without a worker and when the worker stays silent', async () => {
    await expect(createHiResClient({ worker: async () => null, channel }).install()).rejects.toThrow(
      'No service worker',
    );
    vi.useFakeTimers();
    const silent = createHiResClient({ worker: async () => ({ postMessage: () => {} }), channel, timeoutMs: 1000 });
    const result = silent.sync();
    const assertion = expect(result).rejects.toThrow('did not answer');
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });
});
