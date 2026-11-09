import { useEffect, useMemo, useState } from 'react';
import { loadAirspace, type AirspaceDataset } from '../data/airspace.ts';
import { loadDiversionAirports, type DiversionDataset } from '../data/diversion.ts';
import { createRouter, type Router } from '../lib/router.ts';

interface Loaded<T> {
  data: T | null;
  failed: boolean;
}
// Never abort a shared download on an individual component's cleanup. Failures also settle once per page.
let airspacePromise: Promise<Loaded<AirspaceDataset>> | null = null;
let diversionPromise: Promise<Loaded<DiversionDataset>> | null = null;
const loaded = <T>(data: T): Loaded<T> => ({ data, failed: false });
const failed = (): Loaded<never> => ({ data: null, failed: true });
export interface Routing {
  router: Router | null;
  airspaceReviewed: string | null;
  failed: { airspace: boolean; diversion: boolean };
}
/** Each feature downloads its dataset only on first enable. App integration is deliberately separate. */
export function useRouting(airspaceEnabled: boolean, diversionEnabled: boolean): Routing {
  const [airspace, setAirspace] = useState<Loaded<AirspaceDataset> | null>(null);
  const [diversion, setDiversion] = useState<Loaded<DiversionDataset> | null>(null);
  useEffect(() => {
    if (!airspaceEnabled) return;
    let live = true;
    airspacePromise ??= import('../data/generated/airspace.json?url')
      .then(({ default: url }) => loadAirspace(url))
      .then(loaded, failed);
    airspacePromise.then((value) => {
      if (live) setAirspace(value);
    });
    return () => {
      live = false;
    };
  }, [airspaceEnabled]);
  useEffect(() => {
    if (!diversionEnabled) return;
    let live = true;
    diversionPromise ??= import('../data/generated/diversion-airports.json?url')
      .then(({ default: url }) => loadDiversionAirports(url))
      .then(loaded, failed);
    diversionPromise.then((value) => {
      if (live) setDiversion(value);
    });
    return () => {
      live = false;
    };
  }, [diversionEnabled]);
  const router = useMemo(() => {
    if ((airspaceEnabled && !airspace) || (diversionEnabled && !diversion)) return null;
    return createRouter({
      airspace: airspaceEnabled ? airspace?.data : null,
      diversion: diversionEnabled ? diversion?.data : null,
    });
  }, [airspaceEnabled, diversionEnabled, airspace, diversion]);
  return {
    router,
    airspaceReviewed: airspaceEnabled ? (airspace?.data?.reviewed ?? null) : null,
    failed: {
      airspace: airspaceEnabled && (airspace?.failed ?? false),
      diversion: diversionEnabled && (diversion?.failed ?? false),
    },
  };
}
