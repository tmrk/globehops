import type { Plugin } from 'vite';
import { localeFromPath, localizedPath } from '../src/i18n/detect.ts';
import { localizedHtml, notFoundHtml } from '../src/i18n/html.ts';
import { LOCALES } from '../src/i18n/locales.ts';
export function localizedPages(base: string): Plugin {
  return {
    name: 'localized-pages',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') throw new Error('Built index.html is missing');
      const html = String(index.source);
      for (const locale of LOCALES)
        this.emitFile({ type: 'asset', fileName: `${locale}/index.html`, source: localizedHtml(html, base, locale) });
      index.source = localizedHtml(html, base, null);
      // Hosts such as Cloudflare Pages serve this for unknown paths instead of falling back to the app.
      this.emitFile({ type: 'asset', fileName: '404.html', source: notFoundHtml(base) });
    },
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const locale = localeFromPath(url.pathname, base);
        const path = locale ? localizedPath(base, locale) : null;
        if (path && (url.pathname === path || url.pathname === path.slice(0, -1))) {
          request.url = localizedPath(base, null) + url.search;
        }
        next();
      });
    },
  };
}
