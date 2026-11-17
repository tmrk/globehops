import {
  Mesh,
  MeshLambertMaterial,
  NoColorSpace,
  SRGBColorSpace,
  SphereGeometry,
  type ColorSpace,
  type Object3D,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import {
  HIRES_GRIDS,
  chooseDayTiles,
  directionToLatLng,
  hiresTileKey,
  hiresTileUrl,
  nightRegionOfDay,
  textureRegion,
} from '../lib/hiresPack.ts';

/** How long a tile stays on the GPU after the view moves away from it. */
const RETIRE_MS = 8000;
/** A tile that failed to load is not requested again for this long. */
const RETRY_MS = 30_000;
/** The view must move this far (globe radii of camera distance, or degrees of centre) before tiles are reconsidered. */
const DISTANCE_STEP = 0.01;
const CENTRE_STEP = 0.5;
const NIGHT_TILE_SIZE = HIRES_GRIDS.night.tileWidth;
const NIGHT_MIN_MEMORY_GB = 4;
/** Segments per tile side: 16 × 16 per tile reproduces the base globe's 128 × 64 grid exactly. */
const SEGMENTS_PER_TILE = 16;

const isBitmap = (source: unknown): source is ImageBitmap =>
  typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap;

export interface HiResView {
  distance: number;
  fovDegrees: number;
  aspect: number;
  /** Drawing-buffer height in device pixels. */
  viewportPixels: number;
  /** Scene-space camera position; the controls' target is the origin. */
  x: number;
  y: number;
  z: number;
}

export interface HiResTilesContext {
  /** Where the tile patches go: the same parent as the base globe. */
  parent: Object3D;
  /** The base globe's material, whose shading, night lights and settings the patches follow. */
  base: MeshLambertMaterial;
  /** The base globe's shader hook, so a patch is shaded exactly like the surface under it. */
  shade(shader: WebGLProgramParametersWithUniforms): void;
  maxTextureSize: number;
  /** Decodes off the main thread; the result is owned by the texture manager until released. */
  decode(url: string, colorSpace: ColorSpace): Promise<Texture | null>;
  release(texture: Texture): void;
  /** Runs a change that uploads to the GPU once the globe is still. */
  afterStill(apply: () => void): void;
  illuminated(): boolean;
  requestRender(): void;
  urlFor(tileUrl: string): string;
  coarsePointer(): boolean;
  deviceMemoryGb(): number;
  now(): number;
}

interface Patch {
  col: number;
  row: number;
  loading: boolean;
  failedAt: number;
  lastWanted: number;
  day: Texture | null;
  mesh: Mesh<SphereGeometry, MeshLambertMaterial> | null;
  /** This patch's own night-light texture clone: a region of a hi-res night tile or of the base lights. */
  lights: Texture | null;
  lightsSource: 'night' | 'base' | null;
}

interface NightTile {
  texture: Texture | null;
  loading: Promise<void> | null;
  failedAt: number;
}

/**
 * Optional full-resolution Earth imagery. While the camera is zoomed in past what the 8K map shows, the few day
 * tiles around the view are decoded off the main thread and laid over the globe as sphere patches that match
 * the base globe's own vertices, shaded by the same shader. Tiles load only while enabled, the camera is close
 * enough and the GPU can take them; the base maps stay underneath, so any failure leaves today's picture.
 */
export class HiResTiles {
  private enabled = false;
  private patches = new Map<string, Patch>();
  private nights = new Map<string, NightTile>();
  private generation = 0;
  private lastDistance = Infinity;
  private lastLat = NaN;
  private lastLng = NaN;
  private wasIlluminated = false;
  /** Tiles the last view wanted; they stay however long the camera then rests. */
  private wanted = new Set<string>();
  private retireTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private context: HiResTilesContext) {}

  /** Turns the tiles on or off. Off removes every patch and releases its textures. */
  setEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.generation++;
      this.wanted.clear();
      this.clear();
      this.context.requestRender();
    } else {
      this.lastDistance = Infinity;
    }
  }

  /** Called every frame with the camera; does work only when the view changed enough to matter. */
  update(view: HiResView): void {
    if (!this.enabled || this.disposed) return;
    const { lat, lng } = directionToLatLng(view.x, view.y, view.z);
    const illuminated = this.context.illuminated();
    const moved =
      Math.abs(view.distance - this.lastDistance) >= DISTANCE_STEP ||
      !(Math.abs(lat - this.lastLat) < CENTRE_STEP && Math.abs(lng - this.lastLng) < CENTRE_STEP);
    if (!moved && illuminated === this.wasIlluminated) return;
    this.lastDistance = view.distance;
    this.lastLat = lat;
    this.lastLng = lng;
    this.wasIlluminated = illuminated;
    const wanted = chooseDayTiles({
      distance: view.distance,
      fovDegrees: view.fovDegrees,
      aspect: view.aspect,
      viewportPixels: view.viewportPixels,
      lat,
      lng,
      maxTextureSize: this.context.maxTextureSize,
    });
    const now = this.context.now();
    this.wanted = new Set(wanted.map(({ col, row }) => hiresTileKey('day', col, row)));
    for (const { col, row } of wanted) {
      const key = hiresTileKey('day', col, row);
      let patch = this.patches.get(key);
      if (!patch) {
        patch = {
          col,
          row,
          loading: false,
          failedAt: -Infinity,
          lastWanted: now,
          day: null,
          mesh: null,
          lights: null,
          lightsSource: null,
        };
        this.patches.set(key, patch);
      }
      patch.lastWanted = now;
      if (!patch.mesh && !patch.loading && now - patch.failedAt >= RETRY_MS) void this.load(patch);
      else if (patch.mesh && illuminated) void this.ensureNight(patch).then(() => this.refreshLights());
    }
    this.scheduleRetire();
  }

  /** Night lights for patches: call once the base globe's own lights have been applied. */
  refreshLights(): void {
    if (this.disposed) return;
    for (const patch of this.patches.values()) if (patch.mesh) this.applyLights(patch);
    this.context.requestRender();
  }

  /** How many tiles are on the globe now. */
  residentCount(): number {
    let count = 0;
    for (const patch of this.patches.values()) if (patch.mesh) count++;
    return count;
  }

  /** The day tile URLs currently on the globe, for diagnostics and tests. */
  residentTiles(): string[] {
    return [...this.patches.values()]
      .filter((patch) => patch.mesh)
      .map((patch) => hiresTileUrl('day', patch.col, patch.row));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.generation++;
    this.clear();
  }

  private nightAllowed(): boolean {
    return (
      this.context.maxTextureSize >= NIGHT_TILE_SIZE &&
      !this.context.coarsePointer() &&
      this.context.deviceMemoryGb() >= NIGHT_MIN_MEMORY_GB
    );
  }

  private async load(patch: Patch): Promise<void> {
    const generation = this.generation;
    const stale = () => generation !== this.generation || this.disposed;
    patch.loading = true;
    const fail = () => {
      patch.failedAt = this.context.now();
      patch.loading = false;
    };
    try {
      const day = await this.context.decode(
        this.context.urlFor(hiresTileUrl('day', patch.col, patch.row)),
        SRGBColorSpace,
      );
      if (!day) return fail();
      if (stale()) {
        this.context.release(day);
        return;
      }
      // While the sky is lit the night lights matter too: wait for them so the patch never shows a dark city.
      if (this.context.illuminated()) await this.ensureNight(patch);
      if (stale()) {
        this.context.release(day);
        return;
      }
      // The patch stays "loading" until it is on the globe, so a still-pending one is not requested twice.
      this.context.afterStill(() => {
        patch.loading = false;
        if (stale()) this.context.release(day);
        else this.show(patch, day);
      });
    } catch {
      fail();
    }
  }

  /** The hi-res night tile covering a patch, loaded once and shared by the patches inside it. */
  private async ensureNight(patch: Patch): Promise<void> {
    if (!this.nightAllowed()) return;
    const region = nightRegionOfDay(patch.col, patch.row);
    const key = hiresTileKey('night', region.col, region.row);
    let night = this.nights.get(key);
    if (!night) {
      night = { texture: null, loading: null, failedAt: -Infinity };
      this.nights.set(key, night);
    }
    if (night.texture || (night.loading === null && this.context.now() - night.failedAt < RETRY_MS)) return;
    const generation = this.generation;
    night.loading ??= this.context
      .decode(this.context.urlFor(hiresTileUrl('night', region.col, region.row)), NoColorSpace)
      .then((texture) => {
        if (!texture) return;
        if (generation !== this.generation || this.disposed) this.context.release(texture);
        else night!.texture = texture;
      })
      .catch(() => {
        night!.failedAt = this.context.now();
      })
      .finally(() => {
        night!.loading = null;
      });
    await night.loading;
  }

  private show(patch: Patch, day: Texture): void {
    const { cols, rows } = HIRES_GRIDS.day;
    const material = new MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0x000000,
      map: day,
      // The patch lies exactly on the base globe: win the depth test there, never above it.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.onBeforeCompile = this.context.shade;
    const geometry = new SphereGeometry(
      1,
      SEGMENTS_PER_TILE,
      SEGMENTS_PER_TILE,
      (patch.col * Math.PI * 2) / cols,
      (Math.PI * 2) / cols,
      (patch.row * Math.PI) / rows,
      Math.PI / rows,
    );
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 0;
    patch.day = day;
    patch.mesh = mesh;
    this.applyLights(patch);
    this.context.parent.add(mesh);
    this.context.requestRender();
  }

  /** The patch's night lights: its region of the hi-res night tile, else of the base lights, else none. */
  private applyLights(patch: Patch): void {
    const mesh = patch.mesh;
    if (!mesh) return;
    const region = nightRegionOfDay(patch.col, patch.row);
    const night = this.nights.get(hiresTileKey('night', region.col, region.row))?.texture ?? null;
    const source = night ?? this.context.base.emissiveMap;
    const kind = night ? 'night' : source ? 'base' : null;
    if (kind === patch.lightsSource && (kind !== 'base' || patch.lights?.source === source?.source)) return;
    patch.lights?.dispose();
    patch.lights = null;
    patch.lightsSource = kind;
    if (source && kind) {
      const clone = source.clone();
      const { cols, rows } = HIRES_GRIDS.day;
      // A night tile covers several day tiles; the base lights cover the whole globe.
      const area =
        kind === 'night'
          ? { x: region.x, y: region.y, width: region.size[0], height: region.size[1] }
          : { x: patch.col / cols, y: patch.row / rows, width: 1 / cols, height: 1 / rows };
      const { repeat, offset } = textureRegion(area, isBitmap(source.image));
      clone.repeat.set(repeat[0], repeat[1]);
      clone.offset.set(offset[0], offset[1]);
      clone.needsUpdate = true;
      patch.lights = clone;
    }
    mesh.material.emissiveMap = patch.lights;
    mesh.material.needsUpdate = true;
  }

  private scheduleRetire(): void {
    if (this.retireTimer !== undefined || !this.patches.size) return;
    this.retireTimer = setTimeout(() => {
      this.retireTimer = undefined;
      this.retire();
      this.scheduleRetire();
    }, RETIRE_MS / 2);
  }

  /** Releases patches the view has not needed for a while, and night tiles no patch uses. */
  private retire(): void {
    if (this.disposed) return;
    const now = this.context.now();
    let changed = false;
    for (const [key, patch] of this.patches) {
      if (this.wanted.has(key)) patch.lastWanted = now;
      if (patch.loading || now - patch.lastWanted < RETIRE_MS) continue;
      this.removePatch(patch);
      this.patches.delete(key);
      changed = true;
    }
    const used = new Set(
      [...this.patches.values()].map((patch) => {
        const region = nightRegionOfDay(patch.col, patch.row);
        return hiresTileKey('night', region.col, region.row);
      }),
    );
    for (const [key, night] of this.nights) {
      if (used.has(key) || night.loading) continue;
      if (night.texture) this.context.release(night.texture);
      this.nights.delete(key);
    }
    if (changed) this.context.requestRender();
  }

  private removePatch(patch: Patch): void {
    const mesh = patch.mesh;
    if (mesh) {
      this.context.parent.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    patch.lights?.dispose();
    if (patch.day) this.context.release(patch.day);
    patch.mesh = patch.day = patch.lights = null;
    patch.lightsSource = null;
  }

  private clear(): void {
    clearTimeout(this.retireTimer);
    this.retireTimer = undefined;
    for (const patch of this.patches.values()) this.removePatch(patch);
    this.patches.clear();
    for (const night of this.nights.values()) if (night.texture) this.context.release(night.texture);
    this.nights.clear();
  }
}
