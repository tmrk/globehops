/** Returns the clean scoped page URL, or null for a navigation outside the known pages. */
export function navigationCacheUrl(address: string, scope: string): string | null {
  const url = new URL(address);
  const base = new URL(scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
  const path = url.pathname.slice(base.pathname.length);
  if (path === '' || path === 'index.html') return base.href;
  const locale = /^(en|hu|sv)(?:\/|\/index\.html)?$/.exec(path)?.[1];
  return locale ? new URL(`${locale}/`, base).href : null;
}

export function scopedGet(address: string, scope: string, method: string, hasRange: boolean): boolean {
  const url = new URL(address);
  const base = new URL(scope);
  return method === 'GET' && !hasRange && url.origin === base.origin && url.pathname.startsWith(base.pathname);
}
