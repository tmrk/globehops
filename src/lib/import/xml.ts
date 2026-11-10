/** Iterative, non-validating XML reader. Never resolves DTDs, external resources or custom entities. */
import { invalid } from './common.ts';
export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}
function entities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole: string, entity: string) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (!entity.startsWith('#')) return predefined[entity] ?? whole;
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\uFFFD';
  });
}
const local = (name: string) => name.slice(name.lastIndexOf(':') + 1).toLowerCase();
export function parseXml(source: string): XmlNode {
  const document: XmlNode = { tag: '#document', attrs: {}, children: [], text: '' };
  const stack = [document];
  const names: string[] = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] !== '<') {
      const end = source.indexOf('<', i),
        next = end < 0 ? source.length : end;
      stack[stack.length - 1].text += entities(source.slice(i, next));
      i = next;
      continue;
    }
    if (source.startsWith('<!--', i) || source.startsWith('<![CDATA[', i) || source.startsWith('<?', i)) {
      const cdata = source.startsWith('<![CDATA[', i),
        pi = source.startsWith('<?', i);
      const marker = cdata ? ']]>' : pi ? '?>' : '-->';
      const start = i + (cdata ? 9 : pi ? 2 : 4),
        end = source.indexOf(marker, start);
      if (end < 0) invalid('Unclosed XML comment, CDATA or processing instruction');
      if (cdata) stack[stack.length - 1].text += source.slice(start, end);
      i = end + marker.length;
      continue;
    }
    if (source.startsWith('<!', i)) invalid('DTD and entity declarations are not supported');
    let end = i + 1,
      quote = '';
    for (; end < source.length; end++) {
      const c = source[end];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end === source.length) invalid('Unclosed XML tag');
    const body = source.slice(i + 1, end).trim();
    i = end + 1;
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      if (names.pop() !== name || stack.length < 2) invalid(`Unexpected </${name}>`);
      stack.pop();
      continue;
    }
    const selfClosing = body.endsWith('/');
    const content = selfClosing ? body.slice(0, -1).trimEnd() : body;
    const match = /^([A-Za-z_][\w.:-]*)/.exec(content);
    if (!match) invalid('Invalid XML element name');
    const name = match[1];
    const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
    let pos = name.length;
    while (pos < content.length) {
      while (/\s/.test(content[pos] ?? '') && pos < content.length) pos++;
      if (pos === content.length) break;
      const attr = /^([A-Za-z_][\w.:-]*)\s*=\s*(['"])/.exec(content.slice(pos));
      if (!attr) invalid(`Invalid attribute on <${name}>`);
      pos += attr[0].length;
      const close = content.indexOf(attr[2], pos);
      if (close < 0) invalid(`Unclosed attribute on <${name}>`);
      attrs[local(attr[1])] = entities(content.slice(pos, close));
      pos = close + 1;
    }
    const node: XmlNode = { tag: local(name), attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) {
      stack.push(node);
      names.push(name);
    }
  }
  if (stack.length !== 1) invalid(`Unclosed <${names[names.length - 1]}>`);
  if (document.children.length !== 1 || document.text.trim()) invalid('Expected one XML root element');
  return document.children[0];
}
export const child = (node: XmlNode, tag: string): XmlNode | undefined => node.children.find((n) => n.tag === tag);
export const value = (node: XmlNode, tag: string): string | null => child(node, tag)?.text.trim() || null;
/** Iterative preorder, optionally stopping at selected nodes to avoid counting nested geometries twice. */
export function descendants(node: XmlNode, tags: readonly string[], stopAtMatch = false): XmlNode[] {
  const found: XmlNode[] = [],
    stack = [node];
  while (stack.length) {
    const next = stack.pop()!;
    const matched = tags.includes(next.tag);
    if (matched) found.push(next);
    if (!matched || !stopAtMatch) for (let j = next.children.length - 1; j >= 0; j--) stack.push(next.children[j]);
  }
  return found;
}
