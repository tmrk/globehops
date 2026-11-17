import { useSyncExternalStore } from 'react';
import { hiresImagery } from '../pwa/hiresImagery.ts';

export function useHiResImagery() {
  return { ...useSyncExternalStore(hiresImagery.subscribe, hiresImagery.getSnapshot), ...hiresImagery };
}
