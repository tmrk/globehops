/** An explicit choice overrides the system in either direction. */
export function effectiveReducedMotion(saved: boolean | null, system: boolean): boolean {
  return saved ?? system;
}
