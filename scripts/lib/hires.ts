import { revision } from '../pwa.ts';
import {
  HIRES_GRIDS,
  hiresTileUrl,
  type HiResKind,
  type HiResManifest,
  type HiResTile,
} from '../../src/lib/hiresPack.ts';

export interface BuiltTile {
  kind: HiResKind;
  col: number;
  row: number;
  /** The encoded WebP file. */
  bytes: Uint8Array;
}

/** Pixel rectangle of one tile inside its full-resolution source. */
export function tileRect(kind: HiResKind, col: number, row: number) {
  const { tileWidth, tileHeight } = HIRES_GRIDS[kind];
  return { left: col * tileWidth, top: row * tileHeight, width: tileWidth, height: tileHeight };
}

/** Source size a kind's grid expects: the tiles must cover it exactly. */
export function sourceSize(kind: HiResKind): { width: number; height: number } {
  const { cols, rows, tileWidth, tileHeight } = HIRES_GRIDS[kind];
  return { width: cols * tileWidth, height: rows * tileHeight };
}

/**
 * The pack manifest for a set of encoded tiles. `bytes` is the sum of the tile files (the manifest is not
 * counted), each tile's revision hashes its own bytes, and `pack` hashes the sorted URL and revision list, so
 * rebuilding identical tiles gives an identical manifest.
 */
export function assembleHiresManifest(built: readonly BuiltTile[]): HiResManifest {
  const tiles: HiResTile[] = built
    .map(({ kind, col, row, bytes }) => ({
      url: hiresTileUrl(kind, col, row),
      kind,
      col,
      row,
      width: HIRES_GRIDS[kind].tileWidth,
      height: HIRES_GRIDS[kind].tileHeight,
      bytes: bytes.byteLength,
      revision: revision(bytes),
    }))
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return {
    pack: revision(tiles.map((tile) => `${tile.url}@${tile.revision}`).join('\n')),
    bytes: tiles.reduce((total, tile) => total + tile.bytes, 0),
    tiles,
  };
}
