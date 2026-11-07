import { MeshLambertMaterial, NoColorSpace, SRGBColorSpace, Texture, type ColorSpace } from 'three';
import type { GlobeRendererOptions, TextureSet } from './GlobeRenderer.ts';
import { clamp01, easeInOutCubic } from './math3d.ts';

const MEDIUM_TEXTURE_SIZE = 4096;
const LARGE_TEXTURE_SIZE = 8192;
const LARGE_TEXTURE_DISTANCE = 2.2;
const LARGE_TEXTURE_MIN_MEMORY_GB = 4;
const MAX_ANISOTROPY = 8;
const CITY_LIGHTS = 1.4;
const CITY_LIGHTS_FADE_MS = 700;
const CITY_LIGHTS_UPLOAD_DELAY_MS = 50;

type LoadState = 'idle' | 'loading' | 'done';
interface TextureContext {
  material: MeshLambertMaterial;
  capabilities: { maxTextureSize: number; getMaxAnisotropy(): number };
  urls: TextureSet;
  cityLights: { value: number };
  reducedMotion(): boolean;
  illuminated(): boolean;
  requestRender(): void;
  onReady: GlobeRendererOptions['onTextureReady'];
}

/**
 * Owns progressive day textures, lazy night lights and every texture's lifetime. A 1K preview appears
 * almost instantly, then 4K (unless the GPU is limited below 4096 px). The 8K texture (~2 MB download,
 * ~170 MB of GPU memory with mipmaps) loads only when a capable non-touch device zooms in close, where
 * the extra detail is visible. Night lights matter only with day/night shading, so they load last.
 */
export class GlobeTextures {
  private textures = new Set<Texture>();
  private retired = new Set<Texture>();
  private retirementFrame = 0;
  private disposed = false;
  private daySettled = false;
  private quality = 0;
  private mediumState: LoadState = 'idle';
  private largeState: LoadState = 'idle';
  private lightsState: LoadState = 'idle';
  private lightsFadeStart: number | null = null;
  private moonMap: Promise<Texture | null> | null = null;

  constructor(private context: TextureContext) {}

  async load(): Promise<void> {
    const preview = await this.decode(this.context.urls.preview).catch(() => null);
    if (this.disposed) return;
    if (preview) this.apply(preview, 1);
    // A close first view can request 8K while the preview is still decoding.
    if (this.largeState !== 'loading' && this.quality < 3) await this.loadMedium();
    this.daySettled = true;
    this.ensureCityLights();
  }

  maybeUpgrade(distance: number): void {
    if (this.disposed || this.largeState !== 'idle' || distance > LARGE_TEXTURE_DISTANCE) return;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (
      this.context.capabilities.maxTextureSize < LARGE_TEXTURE_SIZE ||
      coarse ||
      memory < LARGE_TEXTURE_MIN_MEMORY_GB
    ) {
      this.largeState = 'done';
      return;
    }
    this.largeState = 'loading';
    void this.decode(this.context.urls.large)
      .then((texture) => {
        if (texture) this.apply(texture, 3);
      })
      .catch(() => this.loadMedium())
      .finally(() => {
        this.largeState = 'done';
      });
  }

  private async loadMedium(): Promise<void> {
    if (this.disposed || this.mediumState !== 'idle' || this.context.capabilities.maxTextureSize < MEDIUM_TEXTURE_SIZE)
      return;
    this.mediumState = 'loading';
    const texture = await this.decode(this.context.urls.medium).catch(() => null);
    if (texture) this.apply(texture, 2);
    this.mediumState = 'done';
  }

  ensureCityLights(): void {
    if (this.disposed || this.lightsState !== 'idle' || !this.daySettled || !this.context.illuminated()) return;
    this.lightsState = 'loading';
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const url =
      this.context.capabilities.maxTextureSize >= MEDIUM_TEXTURE_SIZE && !coarse
        ? this.context.urls.lightsLarge
        : this.context.urls.lightsSmall;
    void this.decode(url, NoColorSpace)
      .then((texture) => {
        if (!texture || this.disposed) return;
        this.context.material.emissiveMap = texture;
        this.context.material.needsUpdate = true;
        this.context.cityLights.value = this.context.reducedMotion() ? CITY_LIGHTS : 0;
        // Let the shader upload finish before starting the fade.
        if (!this.context.reducedMotion()) this.lightsFadeStart = performance.now() + CITY_LIGHTS_UPLOAD_DELAY_MS;
        this.context.requestRender();
      })
      .catch((error: unknown) => {
        if (!this.disposed) console.warn('City lights unavailable', error);
      })
      .finally(() => {
        this.lightsState = 'done';
      });
  }

  /** The Moon's surface, decoded once when the sky first needs it. */
  moon(): Promise<Texture | null> {
    this.moonMap ??= this.decode(this.context.urls.moon).catch((error: unknown) => {
      if (!this.disposed) console.warn('Moon texture unavailable', error);
      return null;
    });
    return this.moonMap;
  }

  stepLights(now: number): boolean {
    if (this.lightsFadeStart === null) return false;
    const t = clamp01((now - this.lightsFadeStart) / CITY_LIGHTS_FADE_MS);
    this.context.cityLights.value = CITY_LIGHTS * easeInOutCubic(t);
    if (t >= 1) this.lightsFadeStart = null;
    return t < 1;
  }

  private async decode(url: string, colorSpace: ColorSpace = SRGBColorSpace): Promise<Texture | null> {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    // Decoding cannot be cancelled. Never create a GPU resource after teardown.
    if (this.disposed) return null;
    const texture = new Texture(image);
    texture.colorSpace = colorSpace;
    texture.anisotropy = Math.min(MAX_ANISOTROPY, this.context.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.textures.add(texture);
    return texture;
  }

  private apply(texture: Texture, quality: number): void {
    if (this.disposed || quality <= this.quality) {
      this.release(texture);
      return;
    }
    const previous = this.context.material.map;
    this.quality = quality;
    this.context.material.map = texture;
    this.context.material.color.set(0xffffff);
    this.context.material.needsUpdate = true;
    this.context.requestRender();
    this.context.onReady?.(quality === 1 ? 'preview' : 'full');
    if (!previous) return;
    // Retire the actual replaced map after the next upload, even if loads finished out of order.
    this.retired.add(previous);
    if (!this.retirementFrame) {
      this.retirementFrame = requestAnimationFrame(() => {
        this.retirementFrame = 0;
        for (const old of this.retired) this.release(old);
        this.retired.clear();
      });
    }
  }

  private release(texture: Texture): void {
    if (this.textures.delete(texture)) texture.dispose();
  }

  restore(): void {
    for (const texture of this.textures) texture.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.retirementFrame);
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
    this.retired.clear();
    this.context.material.map = null;
    this.context.material.emissiveMap = null;
  }
}
