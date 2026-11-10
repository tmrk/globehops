// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { CountryLabelLayer } from './countryLabels.ts';

let parent: HTMLDivElement;
let layer: CountryLabelLayer;
let camera: PerspectiveCamera;
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        format: 2,
        meta: { source: 'test', version: '1', license: 'CC0' },
        labels: [
          ['country', 'Country', 'Ország', 'Land', 0, 0, 0, 1],
          ['ocean', 'Ocean', 'Óceán', 'Hav', 10, 10, 0, 0],
        ],
      }),
    }),
  );
  parent = document.createElement('div');
  layer = new CountryLabelLayer(parent, 'labels', vi.fn());
  camera = new PerspectiveCamera(30, 1.6, 0.1, 100);
  camera.position.set(5, 0, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
});

afterEach(() => {
  layer.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reuses text metrics and leaves DOM untouched for an unchanged frame, then remeasures a new locale', async () => {
  layer.setVisible(true, true);
  await settle();
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(60);
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
  layer.measure(camera, 900);
  layer.update(camera, 1440, 900, []);
  expect(width).toHaveBeenCalledTimes(2);
  expect(height).toHaveBeenCalledTimes(2);
  const observer = new MutationObserver(() => {});
  observer.observe(parent, { subtree: true, attributes: true, childList: true, characterData: true });
  layer.measure(camera, 900);
  layer.update(camera, 1440, 900, []);
  expect(width).toHaveBeenCalledTimes(2);
  expect(observer.takeRecords()).toEqual([]);
  layer.setLocale('sv');
  layer.measure(camera, 900);
  layer.update(camera, 1440, 900, []);
  expect(width).toHaveBeenCalledTimes(4);
  const visible = [...parent.querySelectorAll<HTMLElement>('.country-label')].filter(
    (element) => element.style.display !== 'none',
  );
  expect(visible.map((element) => element.textContent)).toEqual(['Land', 'Hav']);
  observer.disconnect();
});

it('keeps measurements hidden, reserves airport rectangles, and removes all resources on disposal', async () => {
  layer.setVisible(true, false);
  await settle();
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(60);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
  layer.measure(camera, 900);
  layer.update(camera, 1440, 900, [{ x0: 0, y0: 0, x1: 1440, y1: 900 }]);
  expect(
    [...parent.querySelectorAll<HTMLElement>('.country-label')].every((element) => element.style.display === 'none'),
  ).toBe(true);
  layer.dispose();
  layer.measure(camera, 900);
  layer.update(camera, 1440, 900, []);
  expect(parent.children).toHaveLength(0);
});

it('aborts a pending dataset fetch and creates no labels after teardown', async () => {
  let resolveJson: ((value: unknown) => void) | undefined;
  const json = new Promise<unknown>((resolve) => {
    resolveJson = resolve;
  });
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => json } as Response);
  layer.setVisible(true, true);
  await settle();
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  layer.dispose();
  expect(signal?.aborted).toBe(true);
  resolveJson?.({ format: 2, meta: { source: 'test', version: '1', license: 'CC0' }, labels: [] });
  await settle();
  expect(parent.children).toHaveLength(0);
});
