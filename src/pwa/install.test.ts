// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());
it('captures the install prompt before mounting, consumes it once and clears it on install', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const { appInstall, iosInstallHint } = await import('./install.ts');
  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(appInstall.getSnapshot().canInstall).toBe(true);
  const subscriber = vi.fn();
  const unsubscribe = appInstall.subscribe(subscriber);
  await appInstall.promptInstall();
  await appInstall.promptInstall();
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(appInstall.getSnapshot().canInstall).toBe(false);
  window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt }));
  window.dispatchEvent(new Event('appinstalled'));
  expect(appInstall.getSnapshot()).toEqual({ canInstall: false, iosHint: false });
  expect(subscriber).toHaveBeenCalled();
  unsubscribe();
  const iphone = 'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1';
  const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18.0 Safari/605.1.15';
  expect(iosInstallHint(iphone, 5, false, false)).toBe(true);
  expect(iosInstallHint(ipad, 5, false, false)).toBe(true);
  expect(iosInstallHint(ipad, 0, false, false)).toBe(false);
  expect(iosInstallHint(iphone, 5, true, true)).toBe(false);
  expect(iosInstallHint(iphone.replace('Version/18.0', 'CriOS/130'), 5, false, false)).toBe(false);
  expect(iosInstallHint('Android Chrome Safari/604.1', 5, false, false)).toBe(false);
});
