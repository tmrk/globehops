import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { revision } from './pwa.ts';

const scope = 'https://example.com/custom/';
const files = new Map([
  ['', '<html>base</html>'],
  ['hu/', '<html>hu</html>'],
  ...Array.from({ length: 8 }, (_, i): [string, string] => [`assets/${i}.js`, `chunk ${i}`]),
]);
const manifest = [...files].map(([url, body]) => ({ url, revision: revision(body) }));
const tileFiles = new Map([
  ['hires/day-0-0.webp', 'day tile 0'],
  ['hires/day-1-0.webp', 'day tile 1'],
  ['hires/night-0-0.webp', 'night tile 0'],
]);
const hiresManifest = (tiles: Map<string, string>) => ({
  pack: 'pack-a',
  tiles: [...tiles].map(([url, body]) => ({ url, revision: revision(body) })),
});
const hiresName = 'globehops-hires-pack';
const changedTileFiles = new Map([...tileFiles, ['hires/day-1-0.webp', 'day tile 1, newer imagery']]);
let source: string;
let changedSource: string;
async function buildWorker(tiles: Map<string, string>): Promise<string> {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: {
      __PRECACHE_MANIFEST__: JSON.stringify(manifest),
      __HIRES_MANIFEST__: JSON.stringify(hiresManifest(tiles)),
      __APP_BUILD__: JSON.stringify({ version: '2', commit: 'abc', date: '2026-11-08' }),
    },
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      lib: { entry: new URL('../src/pwa/sw.ts', import.meta.url).pathname, formats: ['iife'], name: 'TestWorker' },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output) || output.output[0].type !== 'chunk') throw new Error('Expected worker script');
  return output.output[0].code;
}
beforeAll(async () => {
  source = await buildWorker(tileFiles);
  changedSource = await buildWorker(changedTileFiles);
});
afterAll(() => vi.restoreAllMocks());

class MemoryCache {
  entries = new Map<string, Response>();
  async put(url: string, response: Response) {
    this.entries.set(url, response.clone());
  }
  async match(url: string) {
    return this.entries.get(url)?.clone();
  }
  async delete(url: string) {
    return this.entries.delete(url);
  }
}
async function storedPack(bodies: Map<string, string>) {
  const cache = new MemoryCache();
  for (const [url, body] of bodies) await cache.put(`${scope}${url}`, new Response(body));
  await cache.put(
    `${scope}__hires-revisions.json`,
    Response.json(Object.fromEntries([...bodies].map(([url, body]) => [`${scope}${url}`, revision(body)]))),
  );
  return cache;
}
function harness(
  previous?: MemoryCache,
  options: { pack?: MemoryCache; served?: Map<string, string>; worker?: string } = {},
) {
  const stores = new Map<string, MemoryCache>(previous ? [['globehops-precache-old', previous]] : []);
  if (options.pack) stores.set(hiresName, options.pack);
  const served = options.served ?? tileFiles;
  const events = new Map<string, (event: unknown) => void>();
  const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const path = url.pathname.slice('/custom/'.length);
    const body = files.get(path) ?? served.get(path);
    return new Response(body ?? 'missing', {
      status: body === undefined ? 404 : 200,
      headers: { 'Content-Type': path.endsWith('.js') ? 'application/javascript' : 'text/html' },
    });
  });
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  runInNewContext(options.worker ?? source, {
    self: {
      registration: { scope, active: previous ? {} : null },
      clients: { claim },
      skipWaiting,
      addEventListener: (type: string, callback: (event: unknown) => void) => events.set(type, callback),
    },
    crypto: webcrypto,
    URL,
    Response,
    TextEncoder,
    fetch: fetcher,
    caches: {
      keys: async () => [...stores.keys()],
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new MemoryCache());
        return stores.get(name)!;
      },
      delete: async (name: string) => stores.delete(name),
    },
  });
  const lifecycle = (type: string) =>
    new Promise<void>((resolve, reject) => {
      events.get(type)!({ waitUntil: (promise: Promise<void>) => promise.then(resolve, reject) });
    });
  const request = (url: string, mode = 'navigate', method = 'GET', range = false) => {
    let response: Promise<Response> | undefined;
    events.get('fetch')!({
      request: { url, mode, method, headers: new Headers(range ? { Range: 'bytes=0-10' } : {}) },
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    return response;
  };
  const hiresFetches = () =>
    fetcher.mock.calls
      .map(([input]) =>
        new URL(typeof input === 'object' && 'url' in input ? input.url : String(input)).pathname.slice(
          '/custom/'.length,
        ),
      )
      .filter((path) => path.startsWith('hires/'));
  /** Sends a pack request as the page does and resolves with its final reply and every progress report. */
  const send = (type: string) =>
    new Promise<{ result: Record<string, unknown>; progress: number[][] }>((resolve) => {
      const progress: number[][] = [];
      const port = {
        postMessage: (message: Record<string, unknown>) => {
          if (message.type === 'progress') progress.push([message.done as number, message.total as number]);
          else resolve({ result: message, progress });
        },
      };
      events.get('message')!({ data: { type }, ports: [port], waitUntil: () => {} });
    });
  return { stores, fetcher, skipWaiting, claim, lifecycle, request, events, hiresFetches, send };
}

describe('compiled classic service worker', () => {
  it('installs verified bytes at clean URLs, retries mismatches, and never skips waiting automatically', async () => {
    const h = harness();
    const normal = h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementationOnce(async () => new Response('stale CDN bytes')).mockImplementation(normal);
    await h.lifecycle('install');
    expect(h.fetcher).toHaveBeenCalledTimes(files.size + 1);
    for (const [url, init] of h.fetcher.mock.calls) {
      expect(new URL(String(url)).searchParams.get('__rev')).toMatch(/^[a-f0-9]{16}$/);
      expect(init).toEqual({ cache: 'no-store' });
    }
    const cache = [...h.stores.values()][0];
    expect(await (await cache.match(scope))?.text()).toBe(files.get(''));
    expect((await cache.match(`${scope}assets/0.js`))?.headers.get('Content-Type')).toBe('application/javascript');
    expect(await (await cache.match(`${scope}__precache-revisions.json`))?.json()).toEqual(
      Object.fromEntries(manifest.map(({ url, revision }) => [url, revision])),
    );
    expect(h.skipWaiting).not.toHaveBeenCalled();
  });
  it('copies unchanged responses without network and cleans old caches only on activation', async () => {
    const old = new MemoryCache();
    await old.put(scope, new Response(files.get('')));
    await old.put(`${scope}__precache-revisions.json`, Response.json({ '': revision(files.get('')!) }));
    const h = harness(old);
    await h.lifecycle('install');
    expect(h.fetcher).toHaveBeenCalledTimes(files.size - 1);
    expect(h.stores.has('globehops-precache-old')).toBe(true);
    await h.lifecycle('activate');
    expect(h.stores.has('globehops-precache-old')).toBe(false);
    expect(h.claim).toHaveBeenCalledTimes(1);
  });
  it('rejects a broken deployment after retry and preserves the previous offline version', async () => {
    const old = new MemoryCache();
    await old.put(scope, new Response('previous app'));
    const h = harness(old);
    h.fetcher.mockImplementation(async () => new Response('wrong bytes'));
    await expect(h.lifecycle('install')).rejects.toThrow('revision mismatch');
    expect(h.stores.size).toBe(1);
    expect(await (await old.match(scope))?.text()).toBe('previous app');
    expect(h.claim).not.toHaveBeenCalled();
  });
  it('serves cached navigation aliases offline, falls back for unknown pages, and passes through other requests', async () => {
    const h = harness();
    await h.lifecycle('install');
    h.fetcher.mockRejectedValue(new Error('offline'));
    for (const path of ['', 'index.html', 'hu', 'hu/', 'hu/index.html']) {
      expect(await (await h.request(`${scope}${path}?route=CPH-LHR`))?.text()).toBe(
        files.get(path.startsWith('hu') ? 'hu/' : ''),
      );
    }
    expect(await (await h.request(`${scope}unknown`))?.text()).toBe(files.get(''));
    expect(await (await h.request(`${scope}assets/0.js`, 'cors'))?.text()).toBe('chunk 0');
    await expect(h.request(`${scope}uncached.json`, 'cors')).rejects.toThrow('offline');
    expect(h.request('https://analytics.example.com/')).toBeUndefined();
    expect(h.request('https://example.com/outside/')).toBeUndefined();
    expect(h.request(scope, 'cors', 'POST')).toBeUndefined();
    expect(h.request(scope, 'cors', 'GET', true)).toBeUndefined();
  });
  it('responds to explicit activation and build messages', async () => {
    const h = harness();
    h.events.get('message')!({ data: { type: 'skip-waiting' }, waitUntil: () => {} });
    expect(h.skipWaiting).toHaveBeenCalledTimes(1);
    const port = { postMessage: vi.fn() };
    h.events.get('message')!({ data: { type: 'build' }, ports: [port] });
    expect(port.postMessage).toHaveBeenCalledWith({ version: '2', commit: 'abc', date: '2026-11-08' });
  });

  describe('optional imagery pack', () => {
    const packKeys = (stores: Map<string, MemoryCache>) =>
      [...stores.keys()].filter((key) => key.startsWith('globehops-hires-'));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('never downloads the pack, or creates its cache, when it was not installed', async () => {
      const old = new MemoryCache();
      const h = harness(old);
      await h.lifecycle('install');
      await h.lifecycle('activate');
      await settle();
      expect(h.hiresFetches()).toEqual([]);
      expect(packKeys(h.stores)).toEqual([]);
      expect((await h.send('hires-sync')).result).toMatchObject({ state: 'absent', failed: false });
      expect(h.hiresFetches()).toEqual([]);
      expect(packKeys(h.stores)).toEqual([]);
    });
    it('keeps an installed pack through an app update without fetching any unchanged tile', async () => {
      const pack = await storedPack(tileFiles);
      const old = new MemoryCache();
      await old.put(scope, new Response(files.get('')));
      const h = harness(old, { pack });
      await h.lifecycle('install');
      await h.lifecycle('activate');
      await settle();
      expect(h.stores.has('globehops-precache-old')).toBe(false);
      expect(h.stores.get(hiresName)).toBe(pack);
      expect(h.hiresFetches()).toEqual([]);
      expect(await (await pack.match(`${scope}hires/day-0-0.webp`))?.text()).toBe('day tile 0');
    });
    it('refetches only the tile whose revision changed after an app update', async () => {
      const pack = await storedPack(tileFiles);
      const old = new MemoryCache();
      const h = harness(old, { pack, served: changedTileFiles, worker: changedSource });
      await h.lifecycle('install');
      await h.lifecycle('activate');
      await vi.waitFor(async () =>
        expect(await (await pack.match(`${scope}hires/day-1-0.webp`))?.text()).toBe('day tile 1, newer imagery'),
      );
      await settle();
      expect(h.hiresFetches()).toEqual(['hires/day-1-0.webp']);
      expect(await (await pack.match(`${scope}hires/day-0-0.webp`))?.text()).toBe('day tile 0');
      expect(await (await pack.match(`${scope}__hires-revisions.json`))?.json()).toEqual(
        Object.fromEntries(
          hiresManifest(changedTileFiles).tiles.map(({ url, revision: rev }) => [`${scope}${url}`, rev]),
        ),
      );
    });
    it('does not fail or roll back the app update when a tile cannot be refetched', async () => {
      const pack = await storedPack(tileFiles);
      const old = new MemoryCache();
      await old.put(scope, new Response(files.get('')));
      const h = harness(old, { pack, served: new Map(), worker: changedSource });
      await h.lifecycle('install');
      await expect(h.lifecycle('activate')).resolves.toBeUndefined();
      await settle();
      expect(h.claim).toHaveBeenCalledTimes(1);
      expect(h.stores.has(hiresName)).toBe(true);
      expect(await (await pack.match(`${scope}hires/day-0-0.webp`))?.text()).toBe('day tile 0');
      expect((await h.send('hires-status')).result).toMatchObject({ state: 'partial' });
    });
    it('installs the pack on request with progress and verified bytes, in its own cache', async () => {
      const h = harness();
      await h.lifecycle('install');
      const precache = [...h.stores.keys()];
      const { result, progress } = await h.send('hires-install');
      expect(result).toEqual({ type: 'result', pack: 'pack-a', state: 'ready', failed: false });
      expect(progress.at(0)).toEqual([0, 3]);
      expect(progress.at(-1)).toEqual([3, 3]);
      expect(packKeys(h.stores)).toEqual([hiresName]);
      expect(precache.every((key) => key.startsWith('globehops-precache-'))).toBe(true);
      expect(h.hiresFetches().sort()).toEqual([...tileFiles.keys()].sort());
      for (const [url] of h.fetcher.mock.calls)
        expect(new URL(String(url)).searchParams.get('__rev')).toMatch(/^[a-f0-9]{16}$/);
    });
    it('removes a partial pack when the download fails', async () => {
      const h = harness();
      const normal = h.fetcher.getMockImplementation()!;
      h.fetcher.mockImplementation(async (input, init) =>
        String(input).includes('night-0-0') ? new Response('stale', { status: 200 }) : normal(input, init),
      );
      const { result } = await h.send('hires-install');
      expect(result).toMatchObject({ state: 'absent', failed: true });
      expect(packKeys(h.stores)).toEqual([]);
    });
    it('serves tiles from the pack cache when present and from the network otherwise', async () => {
      const pack = await storedPack(tileFiles);
      const h = harness(undefined, { pack });
      await h.lifecycle('install');
      h.fetcher.mockClear();
      expect(await (await h.request(`${scope}hires/day-0-0.webp`, 'cors'))?.text()).toBe('day tile 0');
      expect(h.fetcher).not.toHaveBeenCalled();
      const none = harness();
      await none.lifecycle('install');
      none.fetcher.mockClear();
      expect(await (await none.request(`${scope}hires/day-0-0.webp`, 'cors'))?.text()).toBe('day tile 0');
      expect(none.hiresFetches()).toEqual(['hires/day-0-0.webp']);
      expect(packKeys(none.stores)).toEqual([]);
    });
    it('clears the pack without touching the precache, and activation drops only old precaches', async () => {
      const pack = await storedPack(tileFiles);
      const old = new MemoryCache();
      const h = harness(old, { pack });
      await h.lifecycle('install');
      await h.lifecycle('activate');
      await settle();
      expect(h.stores.has(hiresName)).toBe(true);
      const precache = [...h.stores.keys()].filter((key) => key.startsWith('globehops-precache-'));
      expect(precache).toHaveLength(1);
      expect((await h.send('hires-delete')).result).toMatchObject({ state: 'absent', failed: false });
      expect(packKeys(h.stores)).toEqual([]);
      expect([...h.stores.keys()]).toEqual(precache);
      expect(await (await h.stores.get(precache[0])!.match(scope))?.text()).toBe(files.get(''));
      expect(h.hiresFetches()).toEqual([]);
    });
  });
});
