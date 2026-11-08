import { isInstalledApp } from './updates.ts';

interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
}
interface InstallState {
  canInstall: boolean;
  iosHint: boolean;
}
let prompt: InstallPrompt | null = null;
let state: InstallState = { canInstall: false, iosHint: false };
const listeners = new Set<() => void>();
function update(next: InstallState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function iosInstallHint(
  userAgent: string,
  touchPoints: number,
  standalone: unknown,
  installed: boolean,
): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  const safari = /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|Android/.test(userAgent);
  return ios && safari && standalone === false && !installed;
}

if (typeof window !== 'undefined') {
  // iPadOS Safari reports a Mac user agent, but still exposes the Safari standalone property.
  state = {
    canInstall: false,
    iosHint: iosInstallHint(
      navigator.userAgent,
      navigator.maxTouchPoints,
      'standalone' in navigator ? navigator.standalone : undefined,
      isInstalledApp(),
    ),
  };
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    update({ canInstall: !isInstalledApp(), iosHint: false });
  });
  window.addEventListener('appinstalled', () => {
    prompt = null;
    update({ canInstall: false, iosHint: false });
  });
}

export const appInstall = {
  getSnapshot: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async promptInstall() {
    const event = prompt;
    prompt = null;
    update({ ...state, canInstall: false });
    try {
      await event?.prompt();
    } catch {
      // Installation can be declined or blocked without affecting the app.
    }
  },
};
