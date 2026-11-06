import { useEffect, useEffectEvent, useState } from 'react';
import type { LatLng } from '../types.ts';

export interface GeolocationState {
  position: LatLng | null;
  accuracyM: number | null;
  status: 'off' | 'pending' | 'on' | 'denied' | 'unavailable';
}

const OFF: GeolocationState = { position: null, accuracyM: null, status: 'off' };

/** Coordinates live only in memory and the globe's decorative label layer. */
export function useGeolocation(
  enabled: boolean,
  onError: (status: 'denied' | 'unavailable') => void,
): GeolocationState {
  const reportError = useEffectEvent(onError);
  const [state, setState] = useState<GeolocationState>(OFF);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let hasFix = false;
    if (!('geolocation' in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!active) return;
        hasFix = true;
        setState({
          position: { lat: coords.latitude, lng: coords.longitude },
          accuracyM: coords.accuracy,
          status: 'on',
        });
      },
      (error) => {
        if (!active) return;
        if (error.code === error.PERMISSION_DENIED) {
          setState({ ...OFF, status: 'denied' });
          reportError('denied');
        } else if (!hasFix) {
          setState({ ...OFF, status: 'unavailable' });
          reportError('unavailable');
        }
      },
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 20000 },
    );
    return () => {
      active = false;
      navigator.geolocation.clearWatch(watch);
      setState(OFF);
    };
  }, [enabled]);
  if (!enabled) return OFF;
  return state.status === 'off' ? { ...OFF, status: 'pending' } : state;
}
