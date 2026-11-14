import { linkHasStops, parseLink } from './link.ts';

/** Extract a supported app link from the first 64 KB of pasted or shared text. */
export function extractLinkQuery(text: string, options: { origin?: string; base?: string } = {}): string | null {
  try {
    const input = text.slice(0, 64 * 1024).trim();
    const base = `/${(options.base ?? import.meta.env?.BASE_URL ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace(
      /^\/\//,
      '/',
    );
    const origin = options.origin ?? globalThis.location?.origin;
    const queryOnly = (query: string): string | null => {
      const params = new URLSearchParams(query.replace(/^#\??/, '').replace(/^\?/, ''));
      for (const key of [...params.keys()]) if (key.toLowerCase() === 'lang') params.delete(key);
      const result = `?${params.toString().replace(/%3A/gi, ':')}`;
      return linkHasStops(parseLink(result)) ? result : null;
    };
    if (/^(?:#\??|\?)?[a-z\d.]+=/i.test(input)) return queryOnly(input);
    for (const match of input.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      let url: URL;
      try {
        url = new URL(match[0].replace(/[.,!;:)\]}>]+$/, ''));
      } catch {
        continue;
      }
      const production = url.hostname === 'globehops.marki.im' && !url.port;
      const legacy = url.hostname === 'tmrk.github.io' && !url.port;
      if (!production && url.origin !== origin && !legacy) continue;
      const bases = legacy ? ['/globehops/'] : [base, '/globehops/', ...(production ? ['/'] : [])];
      if (
        !bases.some(
          (root) =>
            url.pathname === root ||
            url.pathname === root.slice(0, -1) ||
            ['en', 'hu', 'sv'].some(
              (locale) => url.pathname === `${root}${locale}/` || url.pathname === `${root}${locale}`,
            ),
        )
      )
        continue;
      const result = queryOnly(url.search || url.hash);
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  }
}
