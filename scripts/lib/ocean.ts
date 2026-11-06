/**
 * Lighter oceans for the Blue Marble day texture.
 *
 * The bathymetry composite renders the deep ocean floor almost black (about RGB 2, 5, 20), so on
 * the globe the open ocean looked much the same by day as by night. Water pixels gain a blue lift
 * that is strongest where they are darkest and fades toward the bright continental shelves, so the
 * deep basins read as navy while every bathymetry gradation keeps its order. Land, ice and the
 * near-black inland lakes (which are not blue-dominant) stay unchanged.
 */

/** Colour added to the darkest water (scaled down as the pixel brightens). */
export const OCEAN_LIFT = [14, 38, 80] as const;
/** Falloff exponent on (1 − blue): higher keeps shelves and shallows closer to the source. */
export const OCEAN_LIFT_FALLOFF = 1.5;
/** Blue excess over max(red, green) where a pixel starts and finishes counting as water. */
export const WATER_BLUE_EXCESS = [4, 14] as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Water weight 0…1 from how strongly blue dominates the pixel. */
export function waterWeight(r: number, g: number, b: number): number {
  return smoothstep(WATER_BLUE_EXCESS[0], WATER_BLUE_EXCESS[1], b - Math.max(r, g));
}

/** One lifted RGB pixel. */
export function liftOceanPixel(r: number, g: number, b: number): [number, number, number] {
  const k = waterWeight(r, g, b) * (1 - b / 255) ** OCEAN_LIFT_FALLOFF;
  return [
    Math.min(255, Math.round(r + k * OCEAN_LIFT[0])),
    Math.min(255, Math.round(g + k * OCEAN_LIFT[1])),
    Math.min(255, Math.round(b + k * OCEAN_LIFT[2])),
  ];
}

/** Lifts the water in interleaved RGB bytes, returning a new buffer of the same size. */
export function liftOceans(rgb: Uint8Array): Uint8Array {
  if (rgb.length % 3 !== 0) throw new Error('Expected interleaved RGB data');
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    const [r, g, b] = liftOceanPixel(rgb[i], rgb[i + 1], rgb[i + 2]);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }
  return out;
}
