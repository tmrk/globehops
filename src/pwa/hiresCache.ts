import { verifiedFetch } from './verifiedFetch.ts';

/**
 * The optional full-resolution imagery lives in a cache of its own, never in the main precache: the precache's
 * `globehops-precache-` caches are replaced on every app update, while this one is only touched when the visitor
 * installs, updates (changed tiles only) or deletes the pack.
 */
export const HIRES_CACHE_PREFIX = 'globehops-hires-';
export const HIRES_CACHE = `${HIRES_CACHE_PREFIX}pack`;

export interface HiResEntry {
  url: string;
  revision: string;
}
export interface HiResManifestLike {
  pack: string;
  tiles: HiResEntry[];
}
/** `absent`: nothing stored. `ready`: every tile stored at the manifest's revision. `partial`: anything else. */
export type HiResState = 'absent' | 'ready' | 'partial';
export type HiResProgress = (done: number, total: number) => void;

const CONCURRENCY = 3;

class Cancelled extends Error {}

export interface HiResStorage {
  keys(): Promise<string[]>;
  open(name: string): Promise<{
    put(url: string, response: Response): Promise<void>;
    match(url: string): Promise<Response | undefined>;
    delete(url: string): Promise<boolean>;
  }>;
  delete(name: string): Promise<boolean>;
}

/**
 * Installs, brings up to date and deletes the pack. Operations run one at a time; deleting cancels one in
 * progress. Tiles are stored under their clean URLs with a record of the revision each was stored at
 * (`__hires-revisions.json`), written after every tile, so the record never claims more than the cache holds.
 */
export function createHiResCache(options: {
  scope: string;
  manifest: HiResManifestLike;
  storage: HiResStorage;
  fetchTile?: (url: string, revision: string) => Promise<Response>;
}) {
  const { scope, manifest, storage } = options;
  const fetchTile = options.fetchTile ?? verifiedFetch;
  const revisionsUrl = new URL('__hires-revisions.json', scope).href;
  const tiles = manifest.tiles.map((tile) => ({ ...tile, href: new URL(tile.url, scope).href }));
  const hrefs = new Set(tiles.map((tile) => tile.href));
  let epoch = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };
  const installed = async () => (await storage.keys()).includes(HIRES_CACHE);

  async function records(): Promise<Record<string, string>> {
    const stored = await (await storage.open(HIRES_CACHE)).match(revisionsUrl);
    try {
      return stored ? ((await stored.json()) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  async function state(): Promise<HiResState> {
    if (!(await installed())) return 'absent';
    const stored = await records();
    return tiles.every((tile) => stored[tile.href] === tile.revision) ? 'ready' : 'partial';
  }

  /** Fetches the tiles whose stored revision differs from the manifest's, and drops tiles the manifest lacks. */
  async function fill(progress?: HiResProgress): Promise<void> {
    const mine = epoch;
    const cache = await storage.open(HIRES_CACHE);
    const stored = await records();
    const wanted = tiles.filter((tile) => stored[tile.href] !== tile.revision);
    let finished = tiles.length - wanted.length;
    progress?.(finished, tiles.length);
    let next = 0;
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, async () => {
        while (next < wanted.length) {
          if (epoch !== mine) throw new Cancelled();
          const tile = wanted[next++];
          const response = await fetchTile(tile.href, tile.revision);
          if (epoch !== mine) throw new Cancelled();
          await cache.put(tile.href, response);
          stored[tile.href] = tile.revision;
          await cache.put(revisionsUrl, Response.json(stored));
          progress?.(++finished, tiles.length);
        }
      }),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    for (const href of Object.keys(stored)) {
      if (hrefs.has(href)) continue;
      await cache.delete(href);
      delete stored[href];
    }
    await cache.put(revisionsUrl, Response.json(Object.fromEntries(tiles.map((tile) => [tile.href, tile.revision]))));
  }

  return {
    /** True for the pack's tile URLs: the only ones served from this cache. */
    has: (url: string) => hrefs.has(url),
    state: () => enqueue(state),
    /** Downloads the whole pack. A failure removes everything stored, so no partial pack stays behind. */
    install: (progress?: HiResProgress) =>
      enqueue(async () => {
        try {
          await fill(progress);
        } catch (error) {
          if (!(error instanceof Cancelled)) await storage.delete(HIRES_CACHE);
          throw error;
        }
      }),
    /**
     * After an app update: does nothing unless the pack is installed; otherwise fetches only the tiles whose
     * revision changed. A failure keeps what is stored and is retried by the next sync.
     */
    sync: (progress?: HiResProgress) =>
      enqueue(async () => {
        if (await installed()) await fill(progress);
      }),
    /** Deletes every cache of the pack, freeing its storage, and stops any download in progress. */
    clear: () => {
      epoch++;
      return enqueue(async () => {
        for (const name of await storage.keys()) if (name.startsWith(HIRES_CACHE_PREFIX)) await storage.delete(name);
      });
    },
    /** The stored tile for a request, without creating the cache when it is absent. */
    async match(url: string): Promise<Response | undefined> {
      if (!hrefs.has(url) || !(await installed())) return undefined;
      return (await storage.open(HIRES_CACHE)).match(url);
    },
  };
}
