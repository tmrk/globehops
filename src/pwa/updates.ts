export interface AppBuild {
  version: string;
  commit: string;
  date: string;
}
export interface UpdateState {
  supported: boolean;
  offlineReady: boolean;
  status: 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'offline' | 'failed';
  available: AppBuild | null;
  checkedAt: number | null;
  dismissed: boolean;
}
export type UpdateWorker = Pick<ServiceWorker, 'state' | 'postMessage' | 'addEventListener'>;
export interface UpdateRegistration {
  active: UpdateWorker | null;
  waiting: UpdateWorker | null;
  installing: UpdateWorker | null;
  update(): Promise<unknown>;
  addEventListener: EventTarget['addEventListener'];
}
export interface UpdaterDependencies {
  serviceWorker?: {
    controller: UpdateWorker | null;
    register(url: string, options: RegistrationOptions): Promise<UpdateRegistration>;
    addEventListener: EventTarget['addEventListener'];
  };
  window: EventTarget;
  document: EventTarget & { readonly visibilityState: string };
  reload(): void;
  now(): number;
  online(): boolean;
  base: string;
  channel(): MessageChannel;
  installed(): boolean;
  persist?(): Promise<unknown>;
}

function workerBuild(worker: UpdateWorker, channel: MessageChannel): Promise<AppBuild | null> {
  return new Promise((resolve) => {
    const finish = (build: AppBuild | null) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(build);
    };
    const timeout = setTimeout(() => finish(null), 2000);
    channel.port1.onmessage = (event: MessageEvent<Partial<AppBuild> | null>) => {
      const value = event.data;
      finish(
        value && typeof value.version === 'string' && typeof value.commit === 'string' && typeof value.date === 'string'
          ? { version: value.version, commit: value.commit, date: value.date }
          : null,
      );
    };
    try {
      worker.postMessage({ type: 'build' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

export function createAppUpdater(deps: UpdaterDependencies) {
  let state: UpdateState = {
    supported: !!deps.serviceWorker,
    offlineReady: false,
    status: 'idle',
    available: null,
    checkedAt: null,
    dismissed: false,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<UpdateState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  let registration: UpdateRegistration | null = null;
  let started = false;
  let controlled = !!deps.serviceWorker?.controller;
  let reloaded = false;
  let checking = false;
  let lastCheck = -Infinity;
  const watched = new WeakSet<UpdateWorker>();

  const ready = async (worker: UpdateWorker) => {
    let available: AppBuild | null = null;
    try {
      available = await workerBuild(worker, deps.channel());
    } catch {
      // A blocked messaging API must still leave the update usable.
    }
    if (registration?.waiting === worker) set({ status: 'ready', available });
  };
  const watch = (worker: UpdateWorker | null) => {
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    const isUpdate = controlled;
    if (isUpdate) set({ status: 'downloading' });
    const changed = () => {
      if (worker.state === 'installed') {
        if (isUpdate) void ready(worker);
        else set({ offlineReady: true, status: 'current' });
      } else if (worker.state === 'redundant' && state.status === 'downloading') {
        set({ status: deps.online() ? 'failed' : 'offline' });
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  };
  const check = async () => {
    if (!registration || checking) return;
    checking = true;
    lastCheck = deps.now();
    if (state.status !== 'ready' && state.status !== 'downloading') set({ status: 'checking' });
    try {
      await registration.update();
      // update() can resolve just before `updatefound` fires; a new installing worker is a download.
      if (registration.installing) watch(registration.installing);
      else if (registration.waiting && controlled) await ready(registration.waiting);
      else if (state.status === 'checking') set({ status: 'current' });
      set({ checkedAt: deps.now() });
    } catch {
      if (state.status !== 'ready') set({ status: deps.online() ? 'failed' : 'offline', checkedAt: deps.now() });
    } finally {
      checking = false;
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      if (started || !deps.serviceWorker) return;
      started = true;
      deps.serviceWorker.addEventListener('controllerchange', () => {
        set({ offlineReady: !!deps.serviceWorker?.controller });
        if (controlled && !reloaded) {
          reloaded = true;
          deps.reload();
        }
        controlled = !!deps.serviceWorker?.controller;
      });
      deps.document.addEventListener('visibilitychange', () => {
        if (deps.document.visibilityState === 'visible' && deps.now() - lastCheck >= 60_000) void check();
      });
      deps.window.addEventListener('online', () => void check());
      if (deps.installed()) {
        try {
          void deps.persist?.().catch(() => {});
        } catch {
          // Persistence is best effort; refusal must not prevent registration.
        }
      }
      try {
        registration = await deps.serviceWorker.register(`${deps.base}sw.js`, {
          scope: deps.base,
          updateViaCache: 'none',
        });
        set({ offlineReady: !!(deps.serviceWorker.controller || registration.active) });
        registration.addEventListener('updatefound', () => watch(registration?.installing ?? null));
        watch(registration.installing);
        if (registration.waiting && controlled) void ready(registration.waiting);
        await check();
      } catch {
        set({ supported: false, status: 'failed' });
      }
    },
    check,
    apply() {
      try {
        registration?.waiting?.postMessage({ type: 'skip-waiting' });
      } catch {
        set({ status: 'failed' });
      }
    },
    dismiss() {
      set({ dismissed: true });
    },
  };
}

export function isInstalledApp(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}

function browserServiceWorker(): ServiceWorkerContainer | undefined {
  try {
    return import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : undefined;
  } catch {
    return undefined;
  }
}

export const appUpdater = createAppUpdater({
  serviceWorker: browserServiceWorker(),
  window: typeof window === 'undefined' ? new EventTarget() : window,
  document:
    typeof document === 'undefined' ? Object.assign(new EventTarget(), { visibilityState: 'hidden' }) : document,
  reload: () => location.reload(),
  now: () => Date.now(),
  online: () => navigator.onLine,
  base: import.meta.env.BASE_URL,
  channel: () => new MessageChannel(),
  installed: isInstalledApp,
  persist: () => navigator.storage?.persist?.() ?? Promise.resolve(false),
});
