import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  assembleManifest,
  excludedFromPrecache,
  insertHeadTags,
  precacheUrl,
  revision,
  workerHiResManifest,
} from './pwa.ts';
import hiresPackManifest from '../src/data/generated/hires-pack.json' with { type: 'json' };
import type { HiResManifest } from '../src/lib/hiresPack.ts';
import { localizedHtml } from '../src/i18n/html.ts';

describe('precache manifest', () => {
  it('maps all page aliases to directory URLs', () => {
    expect(['index.html', 'hu/index.html', 'en/index.html', 'sv/index.html', 'assets/app.js'].map(precacheUrl)).toEqual(
      ['', 'hu/', 'en/', 'sv/', 'assets/app.js'],
    );
  });
  it('excludes only worker, maps, OS files, host configuration and promotional imagery', () => {
    for (const path of [
      'sw.js',
      '_headers',
      '_redirects',
      '404.html',
      'robots.txt',
      'a.js.map',
      '.DS_Store',
      'a/.DS_Store',
      'og-image.png',
      'splash/a.png',
      'screenshots/a.webp',
      'hires/day-0-0.webp',
      'hires/night-3-1.webp',
      'hires/manifest.json',
    ]) {
      expect(excludedFromPrecache(path), path).toBe(true);
    }
    for (const path of [
      'manifest.webmanifest',
      'icon-192.png',
      'textures/earth.webp',
      'assets/lazy.js',
      'agent/dataset.json',
    ]) {
      expect(excludedFromPrecache(path), path).toBe(false);
    }
  });
  it('leaves the imagery pack out of the default precache however many tiles the public directory holds', () => {
    const publicFiles = new Map<string, string | Uint8Array>([['manifest.webmanifest', '{}']]);
    for (const tile of hiresPackManifest.tiles) publicFiles.set(tile.url, new Uint8Array([1, 2, 3]));
    expect(publicFiles.size).toBeGreaterThan(40);
    const withPack = assembleManifest(publicFiles, new Map([['assets/app.js', 'app']]));
    expect(withPack).toEqual(
      assembleManifest(new Map([['manifest.webmanifest', '{}']]), new Map([['assets/app.js', 'app']])),
    );
    expect(withPack.some((entry) => entry.url.startsWith('hires/'))).toBe(false);
  });
  it('bakes only tile URLs and revisions, with the pack identifier, into the worker', () => {
    const baked = workerHiResManifest(hiresPackManifest as HiResManifest);
    expect(baked.pack).toBe(hiresPackManifest.pack);
    expect(baked.tiles).toHaveLength(hiresPackManifest.tiles.length);
    expect(Object.keys(baked.tiles[0]).sort()).toEqual(['revision', 'url']);
  });
  it('hashes exact UTF-8/binary bytes and makes deterministic manifests with bundle precedence', () => {
    expect(revision('hello')).toBe('2cf24dba5fb0a30e');
    expect(revision('árvíz')).toBe(revision(new TextEncoder().encode('árvíz')));
    expect(revision(new Uint8Array([0, 255]))).not.toBe(revision(new Uint8Array([0, 254])));
    const files = new Map([
      ['index.html', 'old'],
      ['fonts/font.woff2', 'font'],
      ['splash/a.png', 'skip'],
    ]);
    const output = new Map([
      ['hu/index.html', 'hu'],
      ['index.html', 'new'],
      ['agent/dataset.json', '{}'],
      ['assets/lazy.js', 'lazy'],
    ]);
    const manifest = assembleManifest(files, output);
    expect(manifest).toEqual([
      { url: 'agent/dataset.json', revision: revision('{}') },
      { url: 'assets/lazy.js', revision: revision('lazy') },
      { url: 'fonts/font.woff2', revision: revision('font') },
      { url: 'hu/', revision: revision('hu') },
      { url: '', revision: revision('new') },
    ]);
    expect(assembleManifest(new Map([...files].reverse()), new Map([...output].reverse()))).toEqual(manifest);
  });
  it('injects optional head tags before localization without disturbing native metadata', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const tags = '<link rel="apple-touch-startup-image" href="/custom/splash/example.png" />';
    expect(insertHeadTags(html)).toBe(html);
    for (const locale of ['en', 'hu', 'sv'] as const) {
      const localized = localizedHtml(insertHeadTags(html, tags), '/custom/', locale);
      expect(localized).toContain(tags);
      expect(localized).toContain(`<html lang="${locale}">`);
      expect(localized).toContain('maximum-scale=1, user-scalable=no');
      expect(localized).toContain('content="black-translucent"');
      expect(localized.indexOf(tags)).toBeLessThan(localized.indexOf('</head>'));
    }
  });
  it('declares native install and launch behavior without requiring parallel image assets', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
    expect(manifest).toMatchObject({
      id: './',
      start_url: './',
      scope: './',
      share_target: {
        action: './',
        method: 'GET',
        params: { title: 'share-title', text: 'share-text', url: 'share-url' },
      },
      lang: 'en',
      dir: 'ltr',
      display: 'fullscreen',
      display_override: ['fullscreen', 'standalone'],
      orientation: 'any',
      categories: ['travel', 'navigation', 'education'],
      launch_handler: { client_mode: ['navigate-existing', 'auto'] },
    });
    expect(manifest.icons).toHaveLength(4);
    expect(manifest.screenshots.map((item: { form_factor: string }) => item.form_factor)).toEqual(['wide', 'narrow']);
  });
});
