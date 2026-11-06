/** Avoid dirtying projected DOM layers when a paused frame repeats the same pose. */
export function setStyle<K extends 'opacity' | 'visibility' | 'display' | 'transform' | 'fontSize'>(
  element: HTMLElement,
  property: K,
  value: CSSStyleDeclaration[K],
): void {
  if (element.style[property] !== value) element.style[property] = value;
}

export function setClass(element: HTMLElement, name: string, enabled: boolean): void {
  if (element.classList.contains(name) !== enabled) element.classList.toggle(name, enabled);
}
