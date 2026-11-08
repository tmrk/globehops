import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild, type Plugin } from 'vite';

export interface PrecacheEntry {
  url: string;
  revision: string;
}

export function precacheUrl(file: string): string {
  return file === 'index.html' ? '' : file.replace(/\/index\.html$/, '/');
}

export function excludedFromPrecache(file: string): boolean {
  return (
    file === 'sw.js' ||
    file.endsWith('.map') ||
    file.split('/').includes('.DS_Store') ||
    file === 'og-image.png' ||
    /^(splash|screenshots)\//.test(file)
  );
}

export function revision(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** Bundle files take precedence over public files, just as they do in the output directory. */
export function assembleManifest(
  publicFiles: ReadonlyMap<string, string | Uint8Array>,
  outputFiles: ReadonlyMap<string, string | Uint8Array>,
): PrecacheEntry[] {
  return [...new Map([...publicFiles, ...outputFiles])]
    .filter(([file]) => !excludedFromPrecache(file))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, bytes]) => ({ url: precacheUrl(file), revision: revision(bytes) }));
}

export function insertHeadTags(html: string, tags?: string): string {
  return tags ? html.replace('</head>', `${tags}\n</head>`) : html;
}

async function publicFiles(directory: string, prefix = ''): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) {
      for (const [file, bytes] of await publicFiles(path, `${name}/`)) files.set(file, bytes);
    } else if (entry.isFile() && !excludedFromPrecache(name)) files.set(name, await readFile(path));
  }
  return files;
}

export function pwa(options: {
  base: string;
  build: { version: string; commit: string; date: string };
  headTags?: string;
}): Plugin {
  let publicDir: string | false;
  return {
    name: 'globehops-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    transformIndexHtml(html) {
      return insertHeadTags(html, options.headTags);
    },
    generateBundle: {
      order: 'post',
      async handler(_output, bundle) {
        const output = new Map(
          Object.values(bundle).map((file) => [file.fileName, file.type === 'chunk' ? file.code : file.source]),
        );
        const manifest = assembleManifest(publicDir ? await publicFiles(publicDir) : new Map(), output);
        const result = await viteBuild({
          configFile: false,
          publicDir: false,
          logLevel: 'warn',
          base: options.base,
          define: {
            __PRECACHE_MANIFEST__: JSON.stringify(manifest),
            __APP_BUILD__: JSON.stringify(options.build),
          },
          build: {
            write: false,
            minify: true,
            target: 'es2022',
            lib: {
              entry: fileURLToPath(new URL('../src/pwa/sw.ts', import.meta.url)),
              formats: ['iife'],
              name: 'GlobeHopsWorker',
            },
          },
        });
        const outputs = Array.isArray(result) ? result : [result];
        const chunks = outputs.flatMap((item) => ('output' in item ? item.output : []));
        if (chunks.length !== 1 || chunks[0].type !== 'chunk' || chunks[0].imports.length) {
          throw new Error('Service worker must compile to one classic script');
        }
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: chunks[0].code });
      },
    },
  };
}
