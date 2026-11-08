import { useSyncExternalStore } from 'react';
import { appInstall } from '../pwa/install.ts';

export function useAppInstall() {
  return {
    ...useSyncExternalStore(appInstall.subscribe, appInstall.getSnapshot),
    promptInstall: appInstall.promptInstall,
  };
}
