import { describe, expect, it } from 'vitest';
import {
  BASE_MAP_PIXELS,
  BASE_PIXELS_PER_DEGREE,
  HIRES_DAY_PIXELS,
  HIRES_GRIDS,
  MAX_DAY_TILES,
  angleToTile,
  chooseDayTiles,
  closestCameraDistance,
  directionToLatLng,
  hiresTileBounds,
  nightRegionOfDay,
  roundedMegabytes,
  textureRegion,
  screenPixelsPerDegree,
  tilesWithin,
  visibleRadiusDegrees,
  wantsHiRes,
  type HiResView,
} from './hiresPack.ts';

const view = (overrides: Partial<HiResView> = {}): HiResView => ({
  distance: 1.4,
  fovDegrees: 30,
  aspect: 1.6,
  viewportPixels: 1000,
  lat: 47.5,
  lng: 19,
  maxTextureSize: 8192,
  ...overrides,
});

describe('tile geometry', () => {
  it('numbers tiles from the north-west corner', () => {
    expect(hiresTileBounds('day', 0, 0)).toEqual({ west: -180, east: -135, north: 90, south: 45 });
    expect(hiresTileBounds('night', 3, 1)).toEqual({ west: 90, east: 180, north: 0, south: -90 });
  });
  it('finds the distance to the nearest part of a tile', () => {
    // Budapest sits in day column 4 (0° to 45°E), row 1 (45°N to 0°).
    expect(angleToTile('day', 4, 0, 47.5, 19)).toBe(0);
    expect(angleToTile('day', 4, 1, 47.5, 19)).toBeCloseTo(2.5, 6);
    expect(angleToTile('day', 3, 0, 47.5, 19)).toBeGreaterThan(12);
    expect(angleToTile('day', 3, 0, 47.5, 19)).toBeLessThan(13);
    // Across the antimeridian the neighbour is near, not 360° away.
    expect(angleToTile('day', 0, 1, 20, 179)).toBeLessThan(2);
  });
  it('lists tiles in a cap, nearest first, and none beyond it', () => {
    const near = tilesWithin('day', 47.5, 19, 10);
    expect(near[0]).toMatchObject({ col: 4, row: 0, angle: 0 });
    expect(near.map((tile) => tile.angle)).toEqual([...near.map((tile) => tile.angle)].sort((a, b) => a - b));
    expect(near.length).toBeLessThan(8);
    expect(tilesWithin('day', 0, 0, 180)).toHaveLength(32);
  });
  it('maps a day tile to its region of the night tile that covers it', () => {
    expect(nightRegionOfDay(0, 0)).toEqual({ col: 0, row: 0, x: 0, y: 0, size: [0.5, 0.5] });
    expect(nightRegionOfDay(5, 3)).toEqual({ col: 2, row: 1, x: 0.5, y: 0.5, size: [0.5, 0.5] });
    expect(HIRES_GRIDS.day.cols / HIRES_GRIDS.night.cols).toBe(2);
  });
});

describe('zoom gate', () => {
  it('needs more screen pixels per degree the closer the camera gets', () => {
    expect(screenPixelsPerDegree(1.2, 30, 1000)).toBeGreaterThan(screenPixelsPerDegree(2, 30, 1000));
    expect(screenPixelsPerDegree(1.5, 30, 2000)).toBeCloseTo(2 * screenPixelsPerDegree(1.5, 30, 1000), 6);
  });
  it('stays on the 8K map until it is magnified well past its own detail', () => {
    expect(wantsHiRes(3, 30, 1000)).toBe(false);
    expect(wantsHiRes(1.4, 30, 1000)).toBe(true);
    const edge = screenPixelsPerDegree(1.8, 30, 1000);
    expect(wantsHiRes(1.8, 30, 1000)).toBe(edge >= BASE_PIXELS_PER_DEGREE * 1.5);
  });
  it('sees less of the globe when closer', () => {
    expect(visibleRadiusDegrees(1.4, 30, 1.6)).toBeLessThan(visibleRadiusDegrees(2.5, 30, 1.6));
    expect(visibleRadiusDegrees(1.4, 30, 1.6)).toBeLessThanOrEqual(Math.acos(1 / 1.4) * (180 / Math.PI));
    // A very wide view reaches the horizon.
    expect(visibleRadiusDegrees(1.1, 100, 3)).toBeCloseTo(Math.acos(1 / 1.1) * (180 / Math.PI), 6);
  });
});

describe('tile selection', () => {
  it('chooses nothing when zoomed out', () => {
    expect(chooseDayTiles(view({ distance: 3 }))).toEqual([]);
  });
  it('chooses the tiles around the centre when zoomed in, nearest first, within the limit', () => {
    const tiles = chooseDayTiles(view());
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_DAY_TILES);
    expect(tiles[0]).toEqual({ col: 4, row: 0 });
    expect(chooseDayTiles(view({ distance: 1.32, viewportPixels: 4000 }), 2)).toHaveLength(2);
  });
  it('falls back to the existing maps when the GPU cannot take a tile', () => {
    expect(chooseDayTiles(view({ maxTextureSize: 2048 }))).toEqual([]);
    expect(chooseDayTiles(view({ maxTextureSize: 4096 })).length).toBeGreaterThan(0);
  });
});

describe('download size', () => {
  it('rounds to whole decimal megabytes, never below one', () => {
    expect(roundedMegabytes(11_077_254)).toBe(11);
    expect(roundedMegabytes(11_500_000)).toBe(12);
    expect(roundedMegabytes(10)).toBe(1);
  });
});

describe('scene directions and texture regions', () => {
  it('inverts the scene mapping of latitude and longitude', () => {
    const rad = Math.PI / 180;
    for (const [lat, lng] of [
      [0, 0],
      [47.5, 19],
      [-33, -70],
      [10, 179],
    ]) {
      const c = Math.cos(lat * rad);
      const back = directionToLatLng(c * Math.cos(lng * rad), Math.sin(lat * rad), -c * Math.sin(lng * rad));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lng).toBeCloseTo(lng, 9);
    }
  });
  it('maps a patch onto its part of a texture, for bitmaps and ordinary images', () => {
    const whole = { x: 0, y: 0, width: 1, height: 1 };
    expect(textureRegion(whole, true)).toEqual({ repeat: [1, -1], offset: [0, 1] });
    expect(textureRegion(whole, false)).toEqual({ repeat: [1, 1], offset: [0, 0] });
    // The south-east quarter: the bottom half of the image, from the right-hand half.
    const quarter = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 };
    expect(textureRegion(quarter, true)).toEqual({ repeat: [0.5, -0.5], offset: [0.5, 1] });
    expect(textureRegion(quarter, false)).toEqual({ repeat: [0.5, 0.5], offset: [0.5, 0] });
  });
});

describe('closest camera distance', () => {
  const standard = 1.32;
  const atmosphere = 1.055;
  const closer = closestCameraDistance(standard, true);

  it('keeps the standard limit when the pack is not in use', () => {
    expect(closestCameraDistance(standard, false)).toBe(1.32);
  });
  it('shrinks the altitude by the ratio of the map widths', () => {
    expect(HIRES_DAY_PIXELS).toBe(21600);
    expect(BASE_MAP_PIXELS).toBe(8192);
    expect(closer).toBeCloseTo(1 + (0.32 * 8192) / 21600, 12);
    expect((closer - 1) / (standard - 1)).toBeCloseTo(8192 / 21600, 12);
    expect((standard - 1) / (closer - 1)).toBeCloseTo(2.6367, 4);
    expect(closer).toBeGreaterThan(1.12);
    expect(closer).toBeLessThan(1.13);
  });
  it('stays outside the atmosphere shell', () => {
    expect(closer).toBeGreaterThan(atmosphere);
  });
  it('keeps the same over-zoom on the full-resolution map as the 8K map has today', () => {
    const at8k = screenPixelsPerDegree(standard, 30, 1000) / BASE_PIXELS_PER_DEGREE;
    const atPack = screenPixelsPerDegree(closer, 30, 1000) / (HIRES_DAY_PIXELS / 360);
    expect(atPack).toBeCloseTo(at8k, 9);
  });
  it('still chooses a few tiles at the closer limit', () => {
    const close = view({ distance: closer });
    expect(wantsHiRes(close.distance, close.fovDegrees, close.viewportPixels)).toBe(true);
    const tiles = chooseDayTiles(close);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_DAY_TILES);
  });
});
