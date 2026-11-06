// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import raw from '../data/generated/airports.json';
import { decodeDataset } from '../data/airports.ts';
import { buildSearchIndex } from '../data/search.ts';
import { I18nProvider } from '../i18n/I18nProvider.tsx';
import { en } from '../i18n/messages/en.ts';
import { AirportPicker } from './AirportPicker.tsx';

it('ignores composition keys and keeps the active descendant valid when results change', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  const { airports } = decodeDataset(raw);
  const london = airports.filter((airport) => airport.city === 'London').slice(0, 3);
  expect(london).toHaveLength(3);
  const onSelect = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (index = buildSearchIndex(london)) =>
    act(() =>
      root.render(
        createElement(I18nProvider, {
          initialLocale: 'en',
          initialMessages: en,
          children: createElement(AirportPicker, {
            index,
            label: 'Departure airport',
            caption: 'From',
            placeholder: 'Choose an airport',
            variant: 'takeover',
            onSelect,
            onCancel: vi.fn(),
          }),
        }),
      ),
    );
  try {
    await render();
    const input = container.querySelector('input');
    if (!input) throw new Error('Missing search input');
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'London');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const press = (key: string, isComposing = false) =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key, isComposing, bubbles: true }));
    await act(() => press('Enter', true));
    expect(onSelect).not.toHaveBeenCalled();
    await act(() => press('ArrowUp'));
    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? '')?.getAttribute('aria-selected')).toBe('true');
    await render(buildSearchIndex(london.slice(0, 1)));
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    await act(() => press('Enter'));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(london[0]);
  } finally {
    await act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    vi.unstubAllGlobals();
  }
});
