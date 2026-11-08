import { useSyncExternalStore } from 'react';
import { appUpdater } from '../pwa/updates.ts';

export function useAppUpdate() {
  return { ...useSyncExternalStore(appUpdater.subscribe, appUpdater.getSnapshot), ...appUpdater };
}
