// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Group, MeshLambertMaterial, Texture, type Mesh } from 'three';
import { HiResTiles, type HiResTilesContext, type HiResView } from './hiresTiles.ts';

/** Over Budapest at 19°E, 47.5°N (scene directions follow latLngToVector3). */
const rad = Math.PI / 180;
const above = (lat: number, lng: number, distance: number): HiResView => ({
  distance,
  fovDegrees: 30,
  aspect: 1.6,
  viewportPixels: 1000,
  x: distance * Math.cos(lat * rad) * Math.cos(lng * rad),
  y: distance * Math.sin(lat * rad),
  z: -distance * Math.cos(lat * rad) * Math.sin(lng * rad),
});
const close = above(47.5, 19, 1.4);
const far = above(47.5, 19, 3);
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

let parent: Group;
let base: MeshLambertMaterial;
let decode: ReturnType<typeof vi.fn<HiResTilesContext['decode']>>;
let release: ReturnType<typeof vi.fn<HiResTilesContext['release']>>;
let illuminated: boolean;
let coarse: boolean;
let maxTextureSize: number;
let clockNow: number;
let tiles: HiResTiles;

beforeEach(() => {
  parent = new Group();
  base = new MeshLambertMaterial();
  illuminated = false;
  coarse = false;
  maxTextureSize = 8192;
  clockNow = 1000;
  decode = vi.fn(async () => new Texture());
  release = vi.fn();
  tiles = new HiResTiles({
    parent,
    base,
    shade: () => {},
    maxTextureSize,
    decode,
    release,
    afterStill: (apply) => apply(),
    illuminated: () => illuminated,
    requestRender: vi.fn(),
    urlFor: (url) => `/base/${url}`,
    coarsePointer: () => coarse,
    deviceMemoryGb: () => 8,
    now: () => clockNow,
  });
});

afterEach(() => {
  tiles.dispose();
  base.dispose();
  vi.useRealTimers();
});

const requested = () => decode.mock.calls.map(([url]) => url);

describe('full-resolution tiles', () => {
  it('request nothing and add nothing while switched off', async () => {
    tiles.update(close);
    await settle();
    expect(decode).not.toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
  });
  it('request nothing while zoomed out, even when switched on', async () => {
    tiles.setEnabled(true);
    tiles.update(far);
    await settle();
    expect(decode).not.toHaveBeenCalled();
  });
  it('load the day tiles around a close view and lay them over the globe', async () => {
    tiles.setEnabled(true);
    tiles.update(close);
    await settle();
    expect(requested()[0]).toBe('/base/hires/day-4-0.webp');
    expect(requested().every((url) => url.includes('/day-'))).toBe(true);
    expect(requested().length).toBeLessThanOrEqual(4);
    expect(parent.children.length).toBe(requested().length);
    expect(tiles.residentTiles()).toContain('hires/day-4-0.webp');
    const patch = parent.children[0] as Mesh<never, MeshLambertMaterial>;
    expect(patch.material.map).toBeInstanceOf(Texture);
    expect(patch.material.polygonOffset).toBe(true);
    // The same tile is not requested again while the view stays put.
    const count = decode.mock.calls.length;
    tiles.update({ ...close, distance: 1.405 });
    await settle();
    expect(decode.mock.calls.length).toBe(count);
  });
  it('never request tiles the GPU cannot hold', async () => {
    const small = new HiResTiles({
      parent,
      base,
      shade: () => {},
      maxTextureSize: 2048,
      decode,
      release,
      afterStill: (apply) => apply(),
      illuminated: () => false,
      requestRender: vi.fn(),
      urlFor: (url) => url,
      coarsePointer: () => false,
      deviceMemoryGb: () => 8,
      now: () => 0,
    });
    small.setEnabled(true);
    small.update(close);
    await settle();
    expect(decode).not.toHaveBeenCalled();
    small.dispose();
  });
  it('wait for the globe to be still before the patch appears', async () => {
    let apply: (() => void) | null = null;
    const waiting = new HiResTiles({
      parent,
      base,
      shade: () => {},
      maxTextureSize: 8192,
      decode,
      release,
      afterStill: (change) => (apply = change),
      illuminated: () => false,
      requestRender: vi.fn(),
      urlFor: (url) => url,
      coarsePointer: () => false,
      deviceMemoryGb: () => 8,
      now: () => 0,
    });
    waiting.setEnabled(true);
    waiting.update(close);
    await settle();
    expect(parent.children).toHaveLength(0);
    (apply as (() => void) | null)?.();
    expect(parent.children).toHaveLength(1);
    waiting.dispose();
  });
  it('load the night tile too while the sky is lit and give the patch its own lights', async () => {
    illuminated = true;
    tiles.setEnabled(true);
    tiles.update(close);
    await settle();
    expect(requested().some((url) => url.endsWith('night-2-0.webp'))).toBe(true);
    const patch = parent.children.find((child) => (child as Mesh<never, MeshLambertMaterial>).material.emissiveMap);
    expect(patch).toBeDefined();
    const map = (patch as Mesh<never, MeshLambertMaterial>).material.emissiveMap!;
    // Day tile 4,0 is the left half of night tile 2,0's top row: x 0, y 0, half width and height.
    expect(map.repeat.x).toBeCloseTo(0.5);
  });
  it('reuse the base lights when the device keeps to small night maps', async () => {
    illuminated = true;
    coarse = true;
    base.emissiveMap = new Texture();
    tiles.setEnabled(true);
    tiles.update(close);
    await settle();
    expect(requested().some((url) => url.includes('night-'))).toBe(false);
    const patch = parent.children[0] as Mesh<never, MeshLambertMaterial>;
    expect(patch.material.emissiveMap).not.toBeNull();
    expect(patch.material.emissiveMap!.repeat.x).toBeCloseTo(1 / 8);
  });
  it('remove every patch and release its textures when switched off', async () => {
    illuminated = true;
    tiles.setEnabled(true);
    tiles.update(close);
    await settle();
    const made = decode.mock.calls.length;
    tiles.setEnabled(false);
    expect(parent.children).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(made);
    expect(tiles.residentTiles()).toEqual([]);
    tiles.update(above(10, 10, 1.4));
    await settle();
    expect(decode.mock.calls.length).toBe(made);
  });
  it('release a tile that finishes decoding after being switched off', async () => {
    let finish: (texture: Texture) => void = () => {};
    decode.mockImplementationOnce(() => new Promise<Texture>((resolve) => (finish = resolve)));
    tiles.setEnabled(true);
    tiles.update(close);
    tiles.setEnabled(false);
    const late = new Texture();
    finish(late);
    await settle();
    expect(release).toHaveBeenCalledWith(late);
    expect(parent.children).toHaveLength(0);
  });
  it('retire patches the view has left, and keep the base maps when a tile fails to load', async () => {
    vi.useFakeTimers();
    tiles.setEnabled(true);
    tiles.update(close);
    await settle();
    expect(parent.children.length).toBeGreaterThan(0);
    clockNow += 20_000;
    tiles.update(above(-30, -120, 1.4));
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(tiles.residentTiles().includes('hires/day-4-0.webp')).toBe(false);
    decode.mockClear();
    decode.mockRejectedValue(new Error('offline'));
    tiles.update(above(47.5, 19, 1.4));
    await settle();
    expect(decode).toHaveBeenCalled();
    const attempts = decode.mock.calls.length;
    clockNow += 1000;
    tiles.update(above(47.5, 19.9, 1.4));
    await settle();
    expect(decode.mock.calls.length).toBe(attempts);
  });
  it('keep the tiles of a view the camera rests on, however long it rests', async () => {
    vi.useFakeTimers();
    tiles.setEnabled(true);
    tiles.update(close);
    await settle();
    const shown = tiles.residentCount();
    expect(shown).toBeGreaterThan(0);
    clockNow += 60_000;
    vi.advanceTimersByTime(60_000);
    expect(tiles.residentCount()).toBe(shown);
  });
  it('dispose geometry and materials of removed patches', async () => {
    tiles.setEnabled(true);
    tiles.update(close);
    await settle();
    const patch = parent.children[0] as Mesh<BufferGeometry, MeshLambertMaterial>;
    const geometry = vi.spyOn(patch.geometry, 'dispose');
    const material = vi.spyOn(patch.material, 'dispose');
    tiles.dispose();
    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
  });
});
