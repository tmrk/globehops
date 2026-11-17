/**
 * The optional full-resolution Earth imagery pack: tile grids, the manifest shape, and the maths that
 * chooses which tiles a camera needs. Pure, so the texture builder (Node), the service worker, the settings
 * and the globe share one description. Nothing here touches the network, the DOM or Three.js.
 *
 * Day tiles cut the 21,600 × 10,800 Blue Marble into 8 × 4 pieces of 2,700 px; night tiles cut the
 * 13,500 × 6,750 Black Marble into 4 × 2 pieces of 3,375 px. Both stay under a 4096 px GPU limit.
 */

export type HiResKind = 'day' | 'night';

export interface HiResGrid {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  /** WebP quality of the generated tiles. */
  quality: number;
}

export const HIRES_GRIDS: Readonly<Record<HiResKind, HiResGrid>> = {
  day: { cols: 8, rows: 4, tileWidth: 2700, tileHeight: 2700, quality: 80 },
  night: { cols: 4, rows: 2, tileWidth: 3375, tileHeight: 3375, quality: 75 },
};

export interface HiResTile {
  /** Base-relative URL, for example `hires/day-3-1.webp`. */
  url: string;
  kind: HiResKind;
  /** Column from the west (0°) edge of the map at 180°W, and row from the north. */
  col: number;
  row: number;
  width: number;
  height: number;
  bytes: number;
  /** First 16 hex digits of the SHA-256 of the file's bytes. */
  revision: string;
}

export interface HiResManifest {
  /** Identifier derived from every tile's URL and revision; unchanged when the imagery is unchanged. */
  pack: string;
  /** Exact size of all tile files together. The manifest itself is not counted. */
  bytes: number;
  tiles: HiResTile[];
}

export function hiresTileUrl(kind: HiResKind, col: number, row: number): string {
  return `hires/${kind}-${col}-${row}.webp`;
}

export function hiresTileKey(kind: HiResKind, col: number, row: number): string {
  return `${kind}:${col}:${row}`;
}

/** The pack's directory inside the build output; its files never enter the main precache. */
export const HIRES_DIRECTORY = 'hires/';

/** Every tile position of a grid, row by row from the north-west corner. */
export function hiresPositions(kind: HiResKind): { col: number; row: number }[] {
  const { cols, rows } = HIRES_GRIDS[kind];
  return Array.from({ length: cols * rows }, (_, i) => ({ col: i % cols, row: Math.floor(i / cols) }));
}

/** Geographic bounds of one tile, in degrees. */
export function hiresTileBounds(kind: HiResKind, col: number, row: number) {
  const { cols, rows } = HIRES_GRIDS[kind];
  return {
    west: -180 + (col * 360) / cols,
    east: -180 + ((col + 1) * 360) / cols,
    north: 90 - (row * 180) / rows,
    south: 90 - ((row + 1) * 180) / rows,
  };
}

/** True when the manifest describes a complete pack: every day and night tile once, with sane sizes. */
export function isCompletePack(manifest: HiResManifest): boolean {
  const seen = new Set(manifest.tiles.map((tile) => hiresTileKey(tile.kind, tile.col, tile.row)));
  const expected = (['day', 'night'] as const).flatMap((kind) =>
    hiresPositions(kind).map(({ col, row }) => hiresTileKey(kind, col, row)),
  );
  return (
    seen.size === manifest.tiles.length &&
    expected.length === seen.size &&
    expected.every((key) => seen.has(key)) &&
    manifest.bytes === manifest.tiles.reduce((total, tile) => total + tile.bytes, 0)
  );
}

const MB = 1000 * 1000;

/** The download size to show, in whole megabytes (decimal, as download sizes are usually quoted). */
export function roundedMegabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / MB));
}

const DEG = Math.PI / 180;

/** Angle in degrees between two points on the sphere. */
function angleBetween(latA: number, lngA: number, latB: number, lngB: number): number {
  const a = latA * DEG;
  const b = latB * DEG;
  const cos = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((lngA - lngB) * DEG);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
}

function wrapDegrees(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Angle in degrees from a point to the nearest point of a tile (0 when the point is inside it). */
export function angleToTile(kind: HiResKind, col: number, row: number, lat: number, lng: number): number {
  const { west, east, north, south } = hiresTileBounds(kind, col, row);
  const clampedLat = Math.max(south, Math.min(north, lat));
  const lngFromWest = wrapDegrees(lng - west + 180) + 180; // 0 … 360 from the west edge
  if (lngFromWest <= east - west) return Math.abs(lat - clampedLat);
  // Outside the tile's longitudes the nearest point lies on a bounding meridian.
  let best = Infinity;
  for (const edge of [west, east]) {
    const dLng = Math.abs(wrapDegrees(lng - edge)) * DEG;
    const ideal = Math.atan(Math.tan(lat * DEG) / Math.max(1e-9, Math.cos(dLng))) / DEG;
    const edgeLat = Math.max(south, Math.min(north, Math.abs(dLng) > Math.PI / 2 ? clampedLat : ideal));
    best = Math.min(best, angleBetween(lat, lng, edgeLat, edge));
  }
  return best;
}

/** Tiles within `radius` degrees of a point, nearest first. */
export function tilesWithin(
  kind: HiResKind,
  lat: number,
  lng: number,
  radius: number,
): { col: number; row: number; angle: number }[] {
  return hiresPositions(kind)
    .map(({ col, row }) => ({ col, row, angle: angleToTile(kind, col, row, lat, lng) }))
    .filter((tile) => tile.angle <= radius)
    .sort((a, b) => a.angle - b.angle || a.row - b.row || a.col - b.col);
}

/** Texel density of the 8K map the pack improves on: 8,192 px around 360°. */
export const BASE_PIXELS_PER_DEGREE = 8192 / 360;
/** Tiles only load once the screen shows this many times the 8K map's pixels per degree. */
export const HIRES_ZOOM_FACTOR = 1.5;
/** The most day tiles kept on the GPU together (about 40 MB each with mipmaps; four cover any one view). */
export const MAX_DAY_TILES = 4;

/**
 * Screen pixels per degree of surface straight below the camera, for a camera `distance` globe radii from the
 * centre, a vertical field of view in degrees and a viewport height in device pixels.
 */
export function screenPixelsPerDegree(distance: number, fovDegrees: number, viewportPixels: number): number {
  const surface = Math.max(1e-6, distance - 1);
  return (viewportPixels / (2 * Math.tan((fovDegrees * DEG) / 2) * surface)) * DEG;
}

/** True once the 8K map is being magnified enough for the full-resolution tiles to show more. */
export function wantsHiRes(distance: number, fovDegrees: number, viewportPixels: number): boolean {
  return screenPixelsPerDegree(distance, fovDegrees, viewportPixels) >= BASE_PIXELS_PER_DEGREE * HIRES_ZOOM_FACTOR;
}

/**
 * Angular radius in degrees of the globe the viewport shows around the point below the camera: the corner of
 * the frustum where it meets the sphere, or the horizon when the corner looks past it.
 */
export function visibleRadiusDegrees(distance: number, fovDegrees: number, aspect: number): number {
  const half = Math.atan(Math.tan((fovDegrees * DEG) / 2) * Math.sqrt(1 + aspect * aspect));
  const horizon = Math.acos(Math.min(1, 1 / Math.max(1, distance)));
  const reach = distance * Math.sin(half);
  if (reach >= 1) return horizon / DEG;
  return Math.min(horizon, Math.asin(reach) - half) / DEG;
}

export interface HiResView {
  distance: number;
  fovDegrees: number;
  aspect: number;
  /** Viewport height in device pixels. */
  viewportPixels: number;
  /** Surface point below the camera. */
  lat: number;
  lng: number;
  /** The GPU's largest texture; tiles that do not fit are never chosen. */
  maxTextureSize: number;
}

/**
 * The day tiles to show for a view, nearest the centre first and at most `limit`; empty when the camera is too
 * far out for the extra detail to show, or the GPU cannot take a tile. Everything outside keeps the 8K map.
 */
export function chooseDayTiles(view: HiResView, limit = MAX_DAY_TILES): { col: number; row: number }[] {
  const { tileWidth, tileHeight } = HIRES_GRIDS.day;
  if (view.maxTextureSize < Math.max(tileWidth, tileHeight)) return [];
  if (!wantsHiRes(view.distance, view.fovDegrees, view.viewportPixels)) return [];
  const radius = visibleRadiusDegrees(view.distance, view.fovDegrees, view.aspect);
  return tilesWithin('day', view.lat, view.lng, radius)
    .slice(0, limit)
    .map(({ col, row }) => ({ col, row }));
}

/** The night tile that holds a day tile's region, and where that region sits inside it (fractions, from the top). */
export function nightRegionOfDay(
  col: number,
  row: number,
): { col: number; row: number; x: number; y: number; size: [number, number] } {
  const day = HIRES_GRIDS.day;
  const night = HIRES_GRIDS.night;
  const across = day.cols / night.cols;
  const down = day.rows / night.rows;
  return {
    col: Math.floor(col / across),
    row: Math.floor(row / down),
    x: (col % across) / across,
    y: (row % down) / down,
    size: [1 / across, 1 / down],
  };
}

/** Latitude and longitude in degrees of a scene-space direction (see `latLngToVector3`). */
export function directionToLatLng(x: number, y: number, z: number): { lat: number; lng: number } {
  const length = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / length))) / DEG, lng: Math.atan2(-z, x) / DEG };
}

/**
 * Texture repeat and offset that map a patch's own 0…1 coordinates onto part of a texture. The region is given
 * as fractions of the texture from its top-left corner. A decoded bitmap keeps its first row at v = 0 (see
 * `GlobeTextures.decode`); an ordinary image is flipped, as three.js uploads it.
 */
export function textureRegion(
  region: { x: number; y: number; width: number; height: number },
  bitmap: boolean,
): { repeat: [number, number]; offset: [number, number] } {
  const { x, y, width, height } = region;
  return bitmap
    ? { repeat: [width, -height], offset: [x, y + height] }
    : { repeat: [width, height], offset: [x, 1 - y - height] };
}
