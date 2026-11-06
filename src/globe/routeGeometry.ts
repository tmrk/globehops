import type { GlobeRoute } from './GlobeRenderer.ts';

/** Keys identify endpoints; colour and muting must not restart reveals or move the camera. */
export function routeGeometrySignature(route: GlobeRoute): string {
  return JSON.stringify([route.markers.map((marker) => marker.key), route.legs.map((leg) => [leg.key, leg.lift ?? 1])]);
}
