import { useEffect, useState } from 'react';
import airspaceUrl from '../data/generated/airspace.json?url';
import { loadAirspace } from '../data/airspace.ts';
import { createAirspaceRouter, type AirspaceRouter } from '../lib/airspace.ts';

// One router per page: its rasterised zones and route cache outlive toggling.
let shared: Promise<AirspaceRouter> | null = null;

export interface AirspaceRouting {
  /** Null while loading, when off or when the data could not be loaded. */
  router: AirspaceRouter | null;
  /** True when avoidance is on but its data could not be loaded. */
  failed: boolean;
}

/** Loads the avoidance zones the first time avoidance is on. */
export function useAirspaceRouter(enabled: boolean): AirspaceRouting {
  const [router, setRouter] = useState<AirspaceRouter | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || router) return;
    let live = true;
    shared ??= loadAirspace(airspaceUrl).then(createAirspaceRouter);
    shared.then(
      (loaded) => {
        if (live) setRouter(loaded);
      },
      () => {
        shared = null;
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, router]);
  return { router: enabled ? router : null, failed: enabled && failed && !router };
}
