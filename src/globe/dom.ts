/**
 * Inline styles last written through these helpers. Projected layers write dozens of elements every frame;
 * comparing with what was written avoids reading `element.style` back, which serialises (allocates) a fresh
 * string on every read, and skips writes that would not change anything.
 */
const written = new WeakMap<HTMLElement, Map<string, string>>();

function changes(element: HTMLElement, name: string, value: string): boolean {
  let styles = written.get(element);
  if (!styles) written.set(element, (styles = new Map()));
  if (styles.get(name) === value) return false;
  styles.set(name, value);
  return true;
}

/** Writes an inline style unless it already holds `value`. Use it for every write to the property. */
export function setStyle<K extends 'opacity' | 'visibility' | 'display' | 'transform' | 'translate' | 'fontSize'>(
  element: HTMLElement,
  property: K,
  value: CSSStyleDeclaration[K],
): void {
  if (changes(element, property, value)) element.style[property] = value;
}

/** Sets a custom property unless it already holds `value`. */
export function setVar(element: HTMLElement, name: `--${string}`, value: string): void {
  if (changes(element, name, value)) element.style.setProperty(name, value);
}

/** The value last written by `setStyle`/`setVar`, without reading the DOM. */
export function writtenStyle(element: HTMLElement, name: string): string | undefined {
  return written.get(element)?.get(name);
}

export function setClass(element: HTMLElement, name: string, enabled: boolean): void {
  if (element.classList.contains(name) !== enabled) element.classList.toggle(name, enabled);
}
