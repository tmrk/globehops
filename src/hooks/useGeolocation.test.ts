// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useGeolocation, type GeolocationState } from './useGeolocation.ts';

it('keeps a good fix after temporary errors, clears watches and ignores stale callbacks', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let success: PositionCallback = () => {};
  let failure: PositionErrorCallback = () => {};
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((onPosition: PositionCallback, onError: PositionErrorCallback) => {
    success = onPosition;
    failure = onError;
    return watchPosition.mock.calls.length;
  });
  vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch } });
  const onError = vi.fn();
  let state: GeolocationState = { position: null, accuracyM: null, status: 'off' };
  function Probe({ enabled }: { enabled: boolean }) {
    state = useGeolocation(enabled, onError);
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(() => root.render(createElement(Probe, { enabled: false })));
    expect(state.status).toBe('off');
    expect(watchPosition).not.toHaveBeenCalled();
    await act(() => root.render(createElement(Probe, { enabled: true })));
    expect(state.status).toBe('pending');
    expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: false,
      maximumAge: 300000,
      timeout: 20000,
    });
    const fix = {
      coords: { latitude: 55.67, longitude: 12.56, accuracy: 80 },
    } as GeolocationPosition;
    await act(() => success(fix));
    expect(state).toEqual({ status: 'on', position: { lat: 55.67, lng: 12.56 }, accuracyM: 80 });
    await act(() => failure({ code: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError));
    expect(state.status).toBe('on');
    expect(onError).not.toHaveBeenCalled();
    const staleSuccess = success;
    const staleFailure = failure;
    await act(() => root.render(createElement(Probe, { enabled: false })));
    expect(state.status).toBe('off');
    expect(state.position).toBeNull();
    expect(clearWatch).toHaveBeenCalledWith(1);
    await act(() => {
      staleSuccess(fix);
      staleFailure({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    });
    expect(state.status).toBe('off');
    expect(onError).not.toHaveBeenCalled();
    await act(() => root.render(createElement(Probe, { enabled: true })));
    expect(state.status).toBe('pending');
    await act(() => failure({ code: 2, PERMISSION_DENIED: 1 } as GeolocationPositionError));
    expect(state.status).toBe('unavailable');
    expect(onError).toHaveBeenCalledWith('unavailable');
    await act(() => root.unmount());
    expect(clearWatch).toHaveBeenCalledWith(2);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
