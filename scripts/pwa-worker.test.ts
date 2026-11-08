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
let source: string;
beforeAll(async () => {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: {
      __PRECACHE_MANIFEST__: JSON.stringify(manifest),
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
  source = output.output[0].code;
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
}
function harness(previous?: MemoryCache) {
  const stores = new Map<string, MemoryCache>(previous ? [['globehops-precache-old', previous]] : []);
  const events = new Map<string, (event: unknown) => void>();
  const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const path = url.pathname.slice('/custom/'.length);
    const body = files.get(path);
    return new Response(body ?? 'missing', {
      status: body === undefined ? 404 : 200,
      headers: { 'Content-Type': path.endsWith('.js') ? 'application/javascript' : 'text/html' },
    });
  });
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  runInNewContext(source, {
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
  return { stores, fetcher, skipWaiting, claim, lifecycle, request, events };
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
});
