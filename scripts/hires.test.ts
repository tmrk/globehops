import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HIRES_GRIDS, hiresPositions, hiresTileUrl, isCompletePack, type HiResKind } from '../src/lib/hiresPack.ts';
import { assembleHiresManifest, sourceSize, tileRect, type BuiltTile } from './lib/hires.ts';
import { revision } from './pwa.ts';
import committed from '../src/data/generated/hires-pack.json' with { type: 'json' };

function fakeTiles(seed = ''): BuiltTile[] {
  return (['day', 'night'] as HiResKind[]).flatMap((kind) =>
    hiresPositions(kind).map(({ col, row }) => ({
      kind,
      col,
      row,
      bytes: new TextEncoder().encode(`${seed}${kind}${col}${row}`.repeat(col + row + 1)),
    })),
  );
}

describe('imagery pack grids', () => {
  it('cover the full sources exactly and stay under a 4096 px texture limit', () => {
    expect(sourceSize('day')).toEqual({ width: 21600, height: 10800 });
    expect(sourceSize('night')).toEqual({ width: 13500, height: 6750 });
    for (const grid of Object.values(HIRES_GRIDS)) {
      expect(Math.max(grid.tileWidth, grid.tileHeight)).toBeLessThanOrEqual(4096);
    }
    expect(HIRES_GRIDS.day).toMatchObject({ cols: 8, rows: 4, tileWidth: 2700, tileHeight: 2700 });
    expect(HIRES_GRIDS.night).toMatchObject({ cols: 4, rows: 2, tileWidth: 3375, tileHeight: 3375 });
  });
  it('cuts tiles that abut without overlap', () => {
    expect(tileRect('day', 0, 0)).toEqual({ left: 0, top: 0, width: 2700, height: 2700 });
    expect(tileRect('day', 7, 3)).toEqual({ left: 18900, top: 8100, width: 2700, height: 2700 });
    expect(tileRect('night', 3, 1)).toEqual({ left: 10125, top: 3375, width: 3375, height: 3375 });
  });
});

describe('imagery pack manifest', () => {
  it('totals exactly the tile files and describes every tile once', () => {
    const built = fakeTiles();
    const manifest = assembleHiresManifest(built);
    expect(manifest.tiles).toHaveLength(40);
    expect(manifest.bytes).toBe(built.reduce((total, tile) => total + tile.bytes.byteLength, 0));
    expect(isCompletePack(manifest)).toBe(true);
    const tile = manifest.tiles.find((item) => item.url === hiresTileUrl('night', 2, 1))!;
    expect(tile).toMatchObject({ kind: 'night', col: 2, row: 1, width: 3375, height: 3375 });
    expect(tile.revision).toBe(
      revision(built.find((item) => item.kind === 'night' && item.col === 2 && item.row === 1)!.bytes),
    );
  });
  it('is stable for a rebuild of the same tiles and changes when any tile changes', () => {
    const manifest = assembleHiresManifest(fakeTiles());
    expect(assembleHiresManifest(fakeTiles().reverse())).toEqual(manifest);
    const changed = fakeTiles();
    changed[5] = { ...changed[5], bytes: new Uint8Array([9, 9, 9]) };
    const other = assembleHiresManifest(changed);
    expect(other.pack).not.toBe(manifest.pack);
    expect(other.tiles.filter((tile, i) => tile.revision !== manifest.tiles[i].revision)).toHaveLength(1);
  });
  it('rejects an incomplete pack', () => {
    expect(isCompletePack(assembleHiresManifest(fakeTiles().slice(1)))).toBe(false);
  });
  it('matches the generated tile files in public/hires', () => {
    expect(isCompletePack(committed as never)).toBe(true);
    for (const tile of committed.tiles) {
      const bytes = readFileSync(new URL(`../public/${tile.url}`, import.meta.url));
      expect(bytes.byteLength, tile.url).toBe(tile.bytes);
      expect(revision(bytes), tile.url).toBe(tile.revision);
      expect(bytes.byteLength).toBeLessThan(25 * 1024 * 1024);
    }
    expect(committed.tiles.length).toBeLessThan(100);
    expect(
      assembleHiresManifest(
        committed.tiles.map((tile) => ({
          kind: tile.kind as HiResKind,
          col: tile.col,
          row: tile.row,
          bytes: readFileSync(new URL(`../public/${tile.url}`, import.meta.url)),
        })),
      ),
    ).toEqual(committed);
  });
});
