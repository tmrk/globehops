/**
 * Leg colours: a warm progression along the journey (amber → coral → rose → violet → blue → teal).
 * Consecutive legs differ subtly; the selected leg is emphasised by width/opacity, not hue.
 * All colours keep ≥ 3:1 contrast against the dark panel and read well over satellite imagery.
 */
export const LEG_PALETTE = [
  '#ffc24b',
  '#ff9b45',
  '#ff7559',
  '#f0607e',
  '#d064a6',
  '#a874d8',
  '#7f8bf0',
  '#5ea8f2',
  '#4cc3d6',
  '#56d3a6',
] as const;

export function legColor(index: number): string {
  return LEG_PALETTE[index % LEG_PALETTE.length];
}
