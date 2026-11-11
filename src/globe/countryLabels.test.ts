// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Mesh, PerspectiveCamera, Scene, type Texture } from 'three';
import { CountryLabelLayer, type LabelRenderer } from './countryLabels.ts';
import { LABEL_TEXT_PAD, type LabelTextPainter } from './labelText.ts';

let scene: Scene;
let layer: CountryLabelLayer;
let camera: PerspectiveCamera;
let painter: {
  measure: ReturnType<typeof vi.fn<LabelTextPainter['measure']>>;
  draw: ReturnType<typeof vi.fn<(text: string, kind: string, fontPx: number, scale: number) => HTMLCanvasElement>>;
};
let renderer: { getPixelRatio: () => number; initTexture: ReturnType<typeof vi.fn<LabelRenderer['initTexture']>> };
let fontLoaded: () => void;
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const meshes = () => scene.getObjectByName('Place names')?.children.filter((o): o is Mesh => o instanceof Mesh) ?? [];
const frame = (reserved = [] as { x0: number; y0: number; x1: number; y1: number }[]) => {
  layer.measure(camera, 900);
  layer.update(camera, 1440, 900, reserved);
};

beforeEach(() => {
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
  painter = {
    measure: vi.fn<LabelTextPainter['measure']>(() => ({ width: 60, height: 20 })),
    draw: vi.fn((_text: string, _kind: string, _px: number, scale: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = (60 + 2 * LABEL_TEXT_PAD) * scale;
      canvas.height = (20 + 2 * LABEL_TEXT_PAD) * scale;
      return canvas;
    }),
  };
  renderer = { getPixelRatio: () => 2, initTexture: vi.fn<LabelRenderer['initTexture']>() };
  scene = new Scene();
  layer = new CountryLabelLayer(scene, renderer, 'labels', vi.fn(), document.body, (loaded) => {
    fontLoaded = loaded;
    return painter as unknown as LabelTextPainter;
  });
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

it('sets each name once per size, draws it in the globe, and sets it again for a new locale', async () => {
  layer.setVisible(true, true);
  await settle();
  frame();
  expect(painter.measure).toHaveBeenCalledTimes(2);
  expect(painter.draw).toHaveBeenCalledTimes(2);
  expect(renderer.initTexture).toHaveBeenCalledTimes(2);
  expect(layer.placedNames().map(({ name, kind }) => ({ name, kind }))).toEqual([
    { name: 'Country', kind: 'country' },
    { name: 'Ocean', kind: 'ocean' },
  ]);
  expect(meshes().filter((mesh) => mesh.visible)).toHaveLength(2);
  // The quad covers the text box and its shadow room, centred on the label's point.
  const [country] = layer.placedNames();
  expect(country.x1 - country.x0).toBe(60);
  expect(country.y1 - country.y0).toBe(20);

  frame();
  expect(painter.measure).toHaveBeenCalledTimes(2);
  expect(painter.draw).toHaveBeenCalledTimes(2);

  layer.setLocale('sv');
  frame();
  expect(painter.measure).toHaveBeenCalledTimes(4);
  expect(painter.draw).toHaveBeenCalledTimes(4);
  expect(painter.draw.mock.calls.slice(2).map(([text]) => text)).toEqual(['LAND', 'HAV']);
  expect(layer.placedNames().map(({ name }) => name)).toEqual(['Land', 'Hav']);
});

it('gives way to airport rectangles and hides with the layer', async () => {
  layer.setVisible(true, false);
  await settle();
  frame([{ x0: 0, y0: 0, x1: 1440, y1: 900 }]);
  expect(layer.placedNames()).toEqual([]);
  expect(meshes().every((mesh) => !mesh.visible)).toBe(true);
  frame();
  expect(layer.placedNames().map(({ name }) => name)).toEqual(['Country']);
  layer.setVisible(false, false);
  expect(layer.placedNames()).toEqual([]);
});

it('sets names again after a font arrives or the WebGL context returns, and frees everything on disposal', async () => {
  layer.setVisible(true, true);
  await settle();
  frame();
  const textures = painter.draw.mock.results.length;
  const disposed = vi.fn();
  for (const mesh of meshes())
    (mesh.material as unknown as { uniforms: { map: { value: Texture } } }).uniforms.map.value.addEventListener(
      'dispose',
      disposed,
    );
  fontLoaded();
  frame();
  expect(painter.measure).toHaveBeenCalledTimes(4);
  expect(painter.draw).toHaveBeenCalledTimes(textures + 2);
  expect(disposed).toHaveBeenCalledTimes(2);
  layer.restore();
  frame();
  expect(painter.draw).toHaveBeenCalledTimes(textures + 4);
  layer.dispose();
  expect(scene.getObjectByName('Place names')).toBeUndefined();
  frame();
  expect(layer.placedNames()).toEqual([]);
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
  expect(scene.children).toHaveLength(0);
});
