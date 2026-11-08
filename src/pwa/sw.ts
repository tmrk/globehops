import { navigationCacheUrl, scopedGet } from './swRouting.ts';

declare const __PRECACHE_MANIFEST__: { url: string; revision: string }[];
declare const __APP_BUILD__: { version: string; commit: string; date: string };
const worker = self as unknown as ServiceWorkerGlobalScope;
const prefix = 'globehops-precache-';
const scope = worker.registration.scope;
const revisionsUrl = new URL('__precache-revisions.json', scope).href;
const entries = __PRECACHE_MANIFEST__;
const urls = new Set(entries.map((entry) => new URL(entry.url, scope).href));

async function hash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
const cacheName = hash(new TextEncoder().encode(JSON.stringify(entries)).buffer).then((id) => prefix + id);

async function verifiedFetch(url: string, revision: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const address = new URL(url);
      address.searchParams.set('__rev', revision);
      const response = await fetch(address, { cache: 'no-store' });
      if (!response.ok) throw new Error('Precache response failed');
      const bytes = await response.arrayBuffer();
      if ((await hash(bytes)) !== revision) throw new Error('Precache revision mismatch');
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error('Precache download failed');
}

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const name = await cacheName;
      const existing = await caches.keys();
      const sharedWithActive = existing.includes(name) && !!worker.registration.active;
      const previousName = existing.filter((key) => key.startsWith(prefix) && key !== name).at(-1);
      const previous = previousName ? await caches.open(previousName) : null;
      const stored = await previous?.match(revisionsUrl);
      const revisions: Record<string, string> = stored ? await stored.json() : {};
      const cache = await caches.open(name);
      let next = 0;
      try {
        // Await all workers before deleting a failed installation's partial cache.
        const results = await Promise.allSettled(
          Array.from({ length: Math.min(6, entries.length) }, async () => {
            while (next < entries.length) {
              const entry = entries[next++];
              const url = new URL(entry.url, scope).href;
              const reused = revisions[entry.url] === entry.revision ? await previous?.match(url) : null;
              await cache.put(url, reused ?? (await verifiedFetch(url, entry.revision)));
            }
          }),
        );
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        await cache.put(
          revisionsUrl,
          Response.json(Object.fromEntries(entries.map(({ url, revision }) => [url, revision]))),
        );
      } catch (error) {
        // Never remove a cache shared with an already-active worker (identical manifest).
        if (!sharedWithActive) await caches.delete(name);
        throw error;
      }
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const name = await cacheName;
      await Promise.all(
        (await caches.keys()).filter((key) => key.startsWith(prefix) && key !== name).map((key) => caches.delete(key)),
      );
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!scopedGet(request.url, scope, request.method, request.headers.has('Range'))) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(await cacheName);
      if (request.mode === 'navigate') {
        const page = navigationCacheUrl(request.url, scope);
        const cached = page ? await cache.match(page) : null;
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
          const fallback = await cache.match(scope);
          if (fallback) return fallback;
          throw new Error('Offline page unavailable');
        }
      }
      if (urls.has(request.url)) {
        const cached = await cache.match(request.url);
        if (cached) return cached;
      }
      return fetch(request);
    })(),
  );
});

worker.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') event.waitUntil(worker.skipWaiting());
  if (event.data?.type === 'build') event.ports[0]?.postMessage(__APP_BUILD__);
});
