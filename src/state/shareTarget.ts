import { extractLinkQuery } from './sharedLink.ts';

type ShareTarget = { kind: 'link'; query: string } | { kind: 'text'; text: string } | { kind: 'empty' };

/** Read the static GET share target; ordinary application addresses return null. */
export function readShareTarget(search: string, options?: { origin?: string; base?: string }): ShareTarget | null {
  const params = new URLSearchParams(search);
  const keys = ['share-url', 'share-text', 'share-title'];
  if (!keys.some((key) => params.has(key))) return null;
  const values = keys.map((key) => (params.get(key) ?? '').trim()).filter(Boolean);
  for (const value of values) {
    const query = extractLinkQuery(value, options);
    if (query) return { kind: 'link', query };
  }
  return values.length ? { kind: 'text', text: values.join('\n') } : { kind: 'empty' };
}
