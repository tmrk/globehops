/**
 * Night-light mask from the NASA Black Marble colour composite.
 *
 * Black Marble shows lights as warm white–yellow and moonlit land, snow and ocean as dim blue
 * (blue roughly twice red). Subtracting a share of blue from red removes that background, including
 * the bright Antarctic and Greenland ice, while city cores (near white) and their warm fringes stay.
 */

/** Share of the blue channel subtracted from red. */
export const LIGHT_BLUE_WEIGHT = 0.55;
/** Residual subtracted after removing blue, to drop sensor noise over dark land. */
export const LIGHT_FLOOR = 2;
/** Red − blue difference that maps to full brightness; near-white city cores reach it. */
export const LIGHT_FULL = 110;

/** One light value (0…255) from an RGB pixel. */
export function lightValue(r: number, b: number): number {
  const v = (r - LIGHT_BLUE_WEIGHT * b - LIGHT_FLOOR) / LIGHT_FULL;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}

/** Converts interleaved RGB bytes into a single-channel light mask of the same pixel count. */
export function lightMask(rgb: Uint8Array): Uint8Array {
  if (rgb.length % 3 !== 0) throw new Error('Expected interleaved RGB data');
  const out = new Uint8Array(rgb.length / 3);
  for (let i = 0, j = 0; j < out.length; i += 3, j++) out[j] = lightValue(rgb[i], rgb[i + 2]);
  return out;
}
