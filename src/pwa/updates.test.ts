import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppUpdater, type AppBuild, type UpdateWorker, type UpdaterDependencies } from './updates.ts';

const build: AppBuild = { version: '2.0.0', commit: 'abc1234', date: '2026-11-08' };
class Worker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  messages: unknown[] = [];
  answer: unknown = build;
  postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
    this.messages.push(message);
    if (this.answer !== undefined && Array.isArray(transfer)) {
      (transfer[0] as MessagePort).postMessage(this.answer);
    }
  }
  change(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}
function setup(controlled = true) {
  const worker = new Worker();
  worker.state = 'activated';
  const registration = Object.assign(new EventTarget(), {
    active: controlled ? worker : (null as UpdateWorker | null),
    waiting: null as UpdateWorker | null,
    installing: null as UpdateWorker | null,
    update: vi.fn(async () => {}),
  });
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? worker : (null as UpdateWorker | null),
    register: vi.fn(async () => registration),
  });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  let time = 0;
  let online = true;
  const reload = vi.fn();
  // Synchronous ports make message delivery deterministic; the timeout uses Vitest's clock.
  const channel = () => {
    const port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
    const port2 = { postMessage: (data: unknown) => port1.onmessage?.({ data }), close: vi.fn() };
    return { port1, port2 } as unknown as MessageChannel;
  };
  const deps: UpdaterDependencies = {
    serviceWorker: container,
    window,
    document,
    reload,
    now: () => time,
    online: () => online,
    base: '/custom/',
    channel,
    installed: () => false,
    persist: vi.fn(async () => true),
  };
  const updater = createAppUpdater(deps);
  const found = (next: Worker) => {
    registration.installing = next;
    registration.dispatchEvent(new Event('updatefound'));
  };
  return {
    updater,
    deps,
    registration,
    container,
    worker,
    document,
    window,
    reload,
    found,
    time: (value: number) => {
      time = value;
    },
    online: (value: boolean) => {
      online = value;
    },
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => vi.useRealTimers());

describe('app update lifecycle', () => {
  it('registers without HTTP cache, explicitly checks at every launch and starts once', async () => {
    const s = setup();
    await s.updater.start();
    await s.updater.start();
    expect(s.container.register).toHaveBeenCalledExactlyOnceWith('/custom/sw.js', {
      scope: '/custom/',
      updateViaCache: 'none',
    });
    expect(s.registration.update).toHaveBeenCalledTimes(1);
    expect(s.updater.getSnapshot()).toMatchObject({
      supported: true,
      offlineReady: true,
      status: 'current',
      checkedAt: 0,
    });
    const secondLaunch = createAppUpdater(s.deps);
    await secondLaunch.start();
    expect(s.registration.update).toHaveBeenCalledTimes(2);
    expect(s.deps.persist).not.toHaveBeenCalled();
  });
  it('reports an existing waiting build, allows dismissal, and reloads once when applied', async () => {
    const s = setup();
    const next = new Worker();
    next.state = 'installed';
    s.registration.waiting = next;
    await s.updater.start();
    expect(s.updater.getSnapshot()).toMatchObject({ status: 'ready', available: build });
    s.updater.dismiss();
    expect(s.updater.getSnapshot().dismissed).toBe(true);
    s.updater.apply();
    expect(next.messages).toContainEqual({ type: 'skip-waiting' });
    expect(s.reload).not.toHaveBeenCalled();
    s.container.controller = next;
    s.container.dispatchEvent(new Event('controllerchange'));
    s.container.dispatchEvent(new Event('controllerchange'));
    expect(s.reload).toHaveBeenCalledTimes(1);
  });
  it('observes downloading, installed and build metadata on a controlled page', async () => {
    const s = setup();
    await s.updater.start();
    const subscriber = vi.fn();
    const unsubscribe = s.updater.subscribe(subscriber);
    const next = new Worker();
    s.found(next);
    expect(s.updater.getSnapshot().status).toBe('downloading');
    s.registration.waiting = next;
    next.change('installed');
    await flush();
    expect(s.updater.getSnapshot()).toMatchObject({ status: 'ready', available: build });
    expect(subscriber).toHaveBeenCalled();
    unsubscribe();
  });
  it('times out unknown build metadata without losing the update', async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.updater.start();
    const next = new Worker();
    next.answer = undefined;
    s.found(next);
    s.registration.waiting = next;
    next.change('installed');
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.updater.getSnapshot()).toMatchObject({ status: 'ready', available: null });
  });
  it('first installation and first clients.claim never reload; a later activation in another tab does', async () => {
    const s = setup(false);
    const first = new Worker();
    s.registration.installing = first;
    await s.updater.start();
    first.change('installed');
    expect(s.updater.getSnapshot()).toMatchObject({ offlineReady: true, status: 'current', available: null });
    s.container.controller = first;
    s.container.dispatchEvent(new Event('controllerchange'));
    expect(s.reload).not.toHaveBeenCalled();
    s.container.controller = new Worker();
    s.container.dispatchEvent(new Event('controllerchange'));
    expect(s.reload).toHaveBeenCalledTimes(1);
  });
  it('silently distinguishes offline checks from failed online checks, and retries online', async () => {
    const s = setup();
    await s.updater.start();
    s.registration.update.mockRejectedValue(new Error('network'));
    s.online(false);
    await s.updater.check();
    expect(s.updater.getSnapshot().status).toBe('offline');
    s.online(true);
    await s.updater.check();
    expect(s.updater.getSnapshot().status).toBe('failed');
    s.registration.update.mockResolvedValue();
    s.window.dispatchEvent(new Event('online'));
    await flush();
    expect(s.updater.getSnapshot().status).toBe('current');
  });
  it('throttles visible resumes to 60 seconds, ignores hidden pages and deduplicates checks', async () => {
    const s = setup();
    await s.updater.start();
    s.time(59_999);
    s.document.dispatchEvent(new Event('visibilitychange'));
    expect(s.registration.update).toHaveBeenCalledTimes(1);
    s.time(60_000);
    s.document.visibilityState = 'hidden';
    s.document.dispatchEvent(new Event('visibilitychange'));
    expect(s.registration.update).toHaveBeenCalledTimes(1);
    s.document.visibilityState = 'visible';
    s.document.dispatchEvent(new Event('visibilitychange'));
    s.document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(s.registration.update).toHaveBeenCalledTimes(2);
    expect(s.updater.getSnapshot().checkedAt).toBe(60_000);
  });
  it('handles unsupported and blocked registration without throwing', async () => {
    const s = setup();
    const unsupported = createAppUpdater({ ...s.deps, serviceWorker: undefined });
    await unsupported.start();
    expect(unsupported.getSnapshot().supported).toBe(false);
    s.container.register.mockRejectedValue(new Error('blocked'));
    await expect(s.updater.start()).resolves.toBeUndefined();
    expect(s.updater.getSnapshot().supported).toBe(false);
  });
  it('requests persistence only in an installed app, once, even if refused', async () => {
    const s = setup();
    s.deps.installed = () => true;
    s.deps.persist = vi.fn(async () => {
      throw new Error('refused');
    });
    const updater = createAppUpdater(s.deps);
    await updater.start();
    await updater.start();
    expect(s.deps.persist).toHaveBeenCalledTimes(1);
    expect(s.registration.update).toHaveBeenCalledTimes(1);
  });
  it('reports failed installations and preserves a ready update on network failure', async () => {
    const s = setup();
    await s.updater.start();
    const next = new Worker();
    s.found(next);
    next.change('redundant');
    expect(s.updater.getSnapshot().status).toBe('failed');
    const good = new Worker();
    s.found(good);
    s.registration.waiting = good;
    good.change('installed');
    await flush();
    s.registration.update.mockRejectedValue(new Error('network'));
    await s.updater.check();
    expect(s.updater.getSnapshot()).toMatchObject({ status: 'ready', available: build });
  });
});
