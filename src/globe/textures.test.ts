// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MeshLambertMaterial, Texture } from 'three';
import { GlobeTextures } from './textures.ts';

function deferred() {
  const callbacks: { resolve?: () => void; reject?: (error: Error) => void } = {};
  const promise = new Promise<void>((yes, no) => {
    callbacks.resolve = yes;
    callbacks.reject = no;
  });
  return { promise, resolve: () => callbacks.resolve?.(), reject: (error: Error) => callbacks.reject?.(error) };
}

let pending: Map<string, ReturnType<typeof deferred>>;
let frames: Map<number, FrameRequestCallback>;
let material: MeshLambertMaterial;
let textures: GlobeTextures;
let ready: Mock<(quality: 'preview' | 'full') => void>;
let illuminated: boolean;
const urlOfMap = () => (material.map?.image as HTMLImageElement | undefined)?.getAttribute('src');
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const complete = async (url: string) => {
  const load = pending.get(url);
  expect(load, `${url} should have been requested`).toBeDefined();
  load?.resolve();
  await settle();
};

beforeEach(() => {
  pending = new Map();
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: function (this: HTMLImageElement) {
      const load = deferred();
      pending.set(this.getAttribute('src') ?? '', load);
      return load.promise;
    },
  });
  material = new MeshLambertMaterial();
  ready = vi.fn();
  illuminated = false;
  textures = new GlobeTextures({
    material,
    capabilities: { maxTextureSize: 8192, getMaxAnisotropy: () => 16 },
    urls: { preview: '1k', medium: '4k', large: '8k', lightsSmall: 'lights2k', lightsLarge: 'lights4k', moon: 'moon' },
    cityLights: { value: 0 },
    reducedMotion: () => false,
    illuminated: () => illuminated,
    requestRender: vi.fn(),
    onReady: ready,
  });
});

afterEach(() => {
  textures.dispose();
  material.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('progressive globe textures', () => {
  it('loads preview then medium, deferring old-map disposal until the next frame', async () => {
    const loading = textures.load();
    await complete('1k');
    const preview = material.map;
    const dispose = vi.spyOn(preview as Texture, 'dispose');
    expect(urlOfMap()).toBe('1k');
    await complete('4k');
    await loading;
    expect(urlOfMap()).toBe('4k');
    expect(material.map?.anisotropy).toBe(8);
    expect(ready.mock.calls).toEqual([['preview'], ['full']]);
    expect(dispose).not.toHaveBeenCalled();
    for (const callback of frames.values()) callback(0);
    expect(dispose).toHaveBeenCalledOnce();
    textures.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps 8K when it decodes before the preview and skips the medium download', async () => {
    const loading = textures.load();
    textures.maybeUpgrade(2);
    await complete('8k');
    expect(urlOfMap()).toBe('8k');
    const release = vi.spyOn(Texture.prototype, 'dispose');
    await complete('1k');
    await loading;
    expect(urlOfMap()).toBe('8k');
    expect(pending.has('4k')).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(ready.mock.calls).toEqual([['full']]);
  });

  it('keeps 8K when a previously requested medium texture finishes later', async () => {
    const loading = textures.load();
    await complete('1k');
    const preview = material.map;
    textures.maybeUpgrade(2);
    await complete('8k');
    const dispose = vi.spyOn(Texture.prototype, 'dispose');
    await complete('4k');
    await loading;
    expect(urlOfMap()).toBe('8k');
    expect(dispose).toHaveBeenCalledOnce();
    for (const callback of frames.values()) callback(0);
    expect(dispose.mock.instances).toContain(preview);
  });

  it('falls back to medium exactly once when the large request fails', async () => {
    const loading = textures.load();
    textures.maybeUpgrade(2);
    pending.get('8k')?.reject(new Error('offline'));
    await settle();
    await complete('1k');
    await complete('4k');
    await loading;
    expect(urlOfMap()).toBe('4k');
    textures.maybeUpgrade(2);
    expect(pending.size).toBe(3);
  });

  it('does not block medium loading when the device cannot use 8K', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const loading = textures.load();
    textures.maybeUpgrade(2);
    await complete('1k');
    await complete('4k');
    await loading;
    expect(pending.has('8k')).toBe(false);
    expect(urlOfMap()).toBe('4k');
  });

  it('creates no texture or readiness notification when decoding finishes after disposal', async () => {
    const loading = textures.load();
    textures.dispose();
    const release = vi.spyOn(Texture.prototype, 'dispose');
    await complete('1k');
    await loading;
    expect(material.map).toBeNull();
    expect(ready).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('cancels retirement and releases every live texture exactly once on teardown', async () => {
    const loading = textures.load();
    await complete('1k');
    const previewDispose = vi.spyOn(material.map as Texture, 'dispose');
    await complete('4k');
    await loading;
    const mediumDispose = vi.spyOn(material.map as Texture, 'dispose');
    expect(frames.size).toBe(1);
    textures.dispose();
    textures.dispose();
    expect(frames.size).toBe(0);
    expect(previewDispose).toHaveBeenCalledOnce();
    expect(mediumDispose).toHaveBeenCalledOnce();
    expect(material.map).toBeNull();
  });

  it('does not attach night lights when disposed between decode and its continuation', async () => {
    illuminated = true;
    const loading = textures.load();
    await complete('1k');
    await complete('4k');
    await loading;
    const load = pending.get('lights4k');
    expect(load).toBeDefined();
    load?.resolve();
    // decode() creates its texture in the first microtask; its consumer runs in the next one.
    await Promise.resolve();
    textures.dispose();
    await settle();
    expect(material.emissiveMap).toBeNull();
    expect(frames.size).toBe(0);
  });
});
