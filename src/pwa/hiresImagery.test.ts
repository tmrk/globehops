import { describe, expect, it, vi } from 'vitest';
import { createHiResImagery } from './hiresImagery.ts';
import type { HiResClient, HiResReply } from './hiresClient.ts';

const ready: HiResReply = { state: 'ready', failed: false };
function setup(saved: boolean | null = null, replies: Partial<Record<'install' | 'sync', HiResReply | Error>> = {}) {
  let stored = saved;
  const answer = (kind: 'install' | 'sync') => async (progress?: (fraction: number) => void) => {
    progress?.(0.5);
    const reply = replies[kind] ?? ready;
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const client = {
    available: vi.fn(async () => true),
    install: vi.fn(answer('install')),
    sync: vi.fn(answer('sync')),
    status: vi.fn(async () => ready),
    remove: vi.fn(async (): Promise<HiResReply> => ({ state: 'absent', failed: false })),
  };
  const save = vi.fn((on: boolean) => {
    stored = on;
  });
  const imagery = createHiResImagery({
    client: client as unknown as HiResClient,
    load: () => stored,
    save,
    bytes: 11_077_254,
  });
  return { imagery, client, save, stored: () => stored };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('opt-in imagery pack', () => {
  it('is off by default and downloads nothing on startup, whether storage is empty or says off', async () => {
    for (const saved of [null, false]) {
      const { imagery, client } = setup(saved);
      imagery.start();
      await settle();
      expect(imagery.getSnapshot()).toMatchObject({
        enabled: false,
        status: 'off',
        confirming: false,
        supported: true,
      });
      expect(client.install).not.toHaveBeenCalled();
      expect(client.sync).not.toHaveBeenCalled();
    }
  });
  it('shows the real size from the manifest in whole megabytes', () => {
    expect(setup().imagery.getSnapshot().megabytes).toBe(11);
  });
  it('asks before anything is downloaded, and cancel leaves it off', async () => {
    const { imagery, client, save, stored } = setup();
    imagery.ask();
    expect(imagery.getSnapshot()).toMatchObject({ confirming: true, enabled: false });
    expect(save).not.toHaveBeenCalled();
    imagery.cancel();
    await settle();
    expect(imagery.getSnapshot()).toMatchObject({ confirming: false, enabled: false, status: 'off' });
    expect(client.install).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });
  it('confirming saves "on", downloads with progress and becomes ready', async () => {
    const { imagery, client, stored } = setup();
    const seen: number[] = [];
    imagery.subscribe(() => seen.push(imagery.getSnapshot().progress));
    imagery.ask();
    imagery.confirm();
    expect(stored()).toBe(true);
    expect(imagery.getSnapshot()).toMatchObject({ enabled: true, status: 'downloading', confirming: false });
    await settle();
    expect(client.install).toHaveBeenCalledTimes(1);
    expect(seen).toContain(0.5);
    expect(imagery.getSnapshot()).toMatchObject({ enabled: true, status: 'ready', progress: 1 });
  });
  it('confirm does nothing without a question, so it cannot start a download on its own', async () => {
    const { imagery, client } = setup();
    imagery.confirm();
    await settle();
    expect(client.install).not.toHaveBeenCalled();
    expect(imagery.getSnapshot().enabled).toBe(false);
  });
  it('turns back off and says so when the download fails, leaving nothing marked on', async () => {
    for (const reply of [new Error('offline'), { state: 'absent', failed: true } as HiResReply]) {
      const { imagery, stored } = setup(null, { install: reply });
      imagery.ask();
      imagery.confirm();
      await settle();
      expect(imagery.getSnapshot()).toMatchObject({ enabled: false, status: 'failed' });
      expect(stored()).toBe(false);
    }
  });
  it('turning off deletes the stored pack and returns to the current textures', async () => {
    const { imagery, client, stored } = setup();
    imagery.ask();
    imagery.confirm();
    await settle();
    await imagery.disable();
    expect(client.remove).toHaveBeenCalledTimes(1);
    expect(imagery.getSnapshot()).toMatchObject({ enabled: false, status: 'off', progress: 0 });
    expect(stored()).toBe(false);
  });
  it('turning off during a download ignores the late result', async () => {
    const { imagery, client } = setup();
    let finish: (reply: HiResReply) => void = () => {};
    client.install.mockImplementation(() => new Promise<HiResReply>((resolve) => (finish = resolve)));
    imagery.ask();
    imagery.confirm();
    await imagery.disable();
    finish(ready);
    await settle();
    expect(imagery.getSnapshot()).toMatchObject({ enabled: false, status: 'off' });
  });
  it('brings a saved pack up to date on startup, and keeps it when an update fails', async () => {
    const good = setup(true);
    good.imagery.start();
    await settle();
    expect(good.client.sync).toHaveBeenCalledTimes(1);
    expect(good.client.install).not.toHaveBeenCalled();
    expect(good.imagery.getSnapshot()).toMatchObject({ enabled: true, status: 'ready' });
    const failing = setup(true, { sync: { state: 'partial', failed: true } });
    failing.imagery.start();
    await settle();
    expect(failing.imagery.getSnapshot()).toMatchObject({ enabled: true, status: 'failed' });
    expect(failing.stored()).toBe(true);
  });
  it('does not quietly download again when the browser cleared a saved pack', async () => {
    const { imagery, client, stored } = setup(true, { sync: { state: 'absent', failed: false } });
    imagery.start();
    await settle();
    expect(client.install).not.toHaveBeenCalled();
    expect(imagery.getSnapshot()).toMatchObject({ enabled: false, status: 'off' });
    expect(stored()).toBe(false);
  });
  it('is unavailable without a service worker and never asks', () => {
    const imagery = createHiResImagery({ client: null, load: () => true, save: vi.fn(), bytes: 1 });
    imagery.start();
    imagery.ask();
    expect(imagery.getSnapshot()).toMatchObject({ supported: false, confirming: false, enabled: false });
  });
});
