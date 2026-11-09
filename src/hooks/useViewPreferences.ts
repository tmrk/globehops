import { useCallback, useLayoutEffect, useState } from 'react';
import { effectiveReducedMotion } from '../lib/motion.ts';
import type { DistanceUnit } from '../types.ts';
import type { LinkDefaultKey, LinkView } from '../state/link.ts';
import {
  defaultDistanceUnit,
  explicitViewDefaults,
  linkViewDefaults,
  loadViewPreferences,
  resolveViewPreferences,
} from '../state/viewPreferences.ts';
import * as storage from '../state/storage.ts';
import { useMediaQuery } from './useMediaQuery.ts';
import { isNamedClock } from '../agent/contract.ts';

function browserDefaultUnit() {
  // Bootstrap sets the active document language before App mounts.
  return defaultDistanceUnit(document.documentElement.lang, navigator.language || '');
}

export function useViewPreferences() {
  const [values, setValues] = useState(() => loadViewPreferences(browserDefaultUnit()));
  const [linkLayers, setLinkLayers] = useState<Pick<LinkView, 'names' | 'borders' | 'airspace' | 'diversion'>>({});
  const [linkUnits, setLinkUnits] = useState<DistanceUnit | null>(null);
  const [explicitDefaults, setExplicitDefaults] = useState<LinkDefaultKey[]>([]);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const reducedMotion = effectiveReducedMotion(values.reduceMotionPref, systemReducedMotion);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduce' : 'full';
  }, [reducedMotion]);

  const setVisit = useCallback(
    (patch: Partial<typeof values>) => setValues((previous) => ({ ...previous, ...patch })),
    [],
  );
  const resetToLink = useCallback((view: LinkView, search: string) => {
    const explicit = linkViewDefaults(search);
    const resolved = resolveViewPreferences(browserDefaultUnit(), view, explicit);
    // Location and motion have no link representation and must keep their current visit state.
    setValues((previous) => ({
      ...resolved,
      myLocation: previous.myLocation,
      reduceMotionPref: previous.reduceMotionPref,
    }));
    setExplicitDefaults(explicit);
    setLinkLayers({ names: view.names, borders: view.borders, airspace: view.airspace, diversion: view.diversion });
    setLinkUnits(view.units);
  }, []);
  const patchView = (patch: Partial<LinkView>) => {
    setVisit({
      ...(patch.follow !== undefined ? { followAircraft: patch.follow } : {}),
      ...(patch.dayNight !== undefined ? { dayNight: patch.dayNight } : {}),
      ...(patch.clock !== undefined ? { clockZone: patch.clock } : {}),
      ...(patch.names !== undefined ? { showCountryNames: patch.names, showWaterNames: patch.names } : {}),
      ...(patch.borders !== undefined ? { showBorders: patch.borders } : {}),
      ...(patch.airspace !== undefined ? { avoidAirspace: patch.airspace } : {}),
      ...(patch.diversion !== undefined ? { diversionRouting: patch.diversion } : {}),
      ...(patch.units != null ? { unit: patch.units } : {}),
    });
    if (patch.names !== undefined) setLinkLayers((previous) => ({ ...previous, names: patch.names }));
    if (patch.borders !== undefined) setLinkLayers((previous) => ({ ...previous, borders: patch.borders }));
    if (patch.airspace !== undefined) setLinkLayers((previous) => ({ ...previous, airspace: patch.airspace }));
    if (patch.diversion !== undefined) setLinkLayers((previous) => ({ ...previous, diversion: patch.diversion }));
    if (patch.units != null) setLinkUnits(patch.units);
    setExplicitDefaults((previous) => [...new Set([...previous, ...explicitViewDefaults(patch)])]);
  };
  return {
    ...values,
    reducedMotion,
    linkLayers,
    linkUnits,
    explicitDefaults,
    resetToLink,
    patchView,
    setVisit,
    changeFollowAircraft(on: boolean) {
      setVisit({ followAircraft: on });
      storage.saveFollowAircraft(on);
    },
    changeUnit(unit: DistanceUnit) {
      setVisit({ unit });
      if (linkUnits !== null) setLinkUnits(unit);
      storage.saveUnit(unit);
    },
    changeClockZone(clockZone: string) {
      setVisit({ clockZone });
      if (isNamedClock(clockZone)) storage.saveClockZone(clockZone);
    },
    toggleCountryNames() {
      const next = !values.showCountryNames;
      setVisit({ showCountryNames: next });
      storage.saveCountryNames(next);
    },
    toggleWaterNames() {
      const next = !values.showWaterNames;
      setVisit({ showWaterNames: next });
      storage.saveWaterNames(next);
    },
    toggleBorders() {
      const next = !values.showBorders;
      setVisit({ showBorders: next });
      storage.saveBorders(next);
    },
    toggleDayNight() {
      const next = !values.dayNight;
      setVisit({ dayNight: next });
      storage.saveDayNight(next);
    },
    toggleAvoidAirspace() {
      const next = !values.avoidAirspace;
      setVisit({ avoidAirspace: next });
      if (linkLayers.airspace !== undefined) setLinkLayers((previous) => ({ ...previous, airspace: next }));
      storage.saveAvoidAirspace(next);
    },
    toggleDiversionRouting() {
      const next = !values.diversionRouting;
      setVisit({ diversionRouting: next });
      if (linkLayers.diversion !== undefined) setLinkLayers((previous) => ({ ...previous, diversion: next }));
      storage.saveDiversionRouting(next);
    },
    toggleMyLocation() {
      const next = !values.myLocation;
      setVisit({ myLocation: next });
      storage.saveMyLocation(next);
    },
    toggleReduceMotion() {
      const next = !reducedMotion;
      setVisit({ reduceMotionPref: next });
      storage.saveReduceMotion(next);
    },
    disableLocation(persist: boolean) {
      setVisit({ myLocation: false });
      if (persist) storage.saveMyLocation(false);
    },
  };
}
