import { createHiResCache, type HiResManifestLike, type HiResProgress } from './hiresCache.ts';
import { hash, verifiedFetch } from './verifiedFetch.ts';
import { navigationCacheUrl, scopedGet } from './swRouting.ts';

declare const __PRECACHE_MANIFEST__: { url: string; revision: string }[];
declare const __HIRES_MANIFEST__: HiResManifestLike;
declare const __APP_BUILD__: { version: string; commit: string; date: string };
const worker = self as unknown as ServiceWorkerGlobalScope;
const prefix = 'globehops-precache-';
const scope = worker.registration.scope;
const revisionsUrl = new URL('__precache-revisions.json', scope).href;
const entries = __PRECACHE_MANIFEST__;
const urls = new Set(entries.map((entry) => new URL(entry.url, scope).href));

const hiresManifest = __HIRES_MANIFEST__;
const hires = createHiResCache({ scope, manifest: hiresManifest, storage: caches });
const cacheName = hash(new TextEncoder().encode(JSON.stringify(entries)).buffer).then((id) => prefix + id);

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
      // The app update is complete. Bring an installed imagery pack up to date in the background without
      // holding activation back; nothing happens when the pack was never installed, and a failure is retried
      // by the page's next sync.
      void hires.sync().catch(() => {});
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!scopedGet(request.url, scope, request.method, request.headers.has('Range'))) return;
  event.respondWith(
    (async () => {
      if (request.mode !== 'navigate' && hires.has(request.url)) {
        const tile = await hires.match(request.url);
        if (tile) return tile;
        return fetch(request);
      }
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

/** Runs one imagery pack request for the page, reporting progress and the final state over its port. */
function packRequest(event: ExtendableMessageEvent, run: (progress: HiResProgress) => Promise<unknown>): void {
  const port = event.ports[0];
  const finish = async (failed: boolean) => {
    const state = await hires.state().catch(() => 'absent' as const);
    port?.postMessage({ type: 'result', pack: hiresManifest.pack, state, failed });
  };
  event.waitUntil(
    run((done, total) => port?.postMessage({ type: 'progress', done, total })).then(
      () => finish(false),
      () => finish(true),
    ),
  );
}

worker.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'skip-waiting') event.waitUntil(worker.skipWaiting());
  if (type === 'build') event.ports[0]?.postMessage(__APP_BUILD__);
  if (type === 'hires-install') packRequest(event, (progress) => hires.install(progress));
  if (type === 'hires-sync') packRequest(event, (progress) => hires.sync(progress));
  if (type === 'hires-status') packRequest(event, async () => {});
  if (type === 'hires-delete') packRequest(event, () => hires.clear());
});
