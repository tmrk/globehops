import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assembleManifest, excludedFromPrecache, insertHeadTags, precacheUrl, revision } from './pwa.ts';
import { localizedHtml } from '../src/i18n/html.ts';

describe('precache manifest', () => {
  it('maps all page aliases to directory URLs', () => {
    expect(['index.html', 'hu/index.html', 'en/index.html', 'sv/index.html', 'assets/app.js'].map(precacheUrl)).toEqual(
      ['', 'hu/', 'en/', 'sv/', 'assets/app.js'],
    );
  });
  it('excludes only worker, maps, OS files and promotional imagery', () => {
    for (const path of [
      'sw.js',
      'a.js.map',
      '.DS_Store',
      'a/.DS_Store',
      'og-image.png',
      'splash/a.png',
      'screenshots/a.webp',
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
