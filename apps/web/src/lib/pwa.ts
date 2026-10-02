import { useSyncExternalStore } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let prompt: InstallPrompt | null = null;
const displayMode = window.matchMedia('(display-mode: standalone)');
let installed = displayMode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Capture the event before React/auth finishes loading, including when no install control is mounted.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  prompt = event as InstallPrompt;
  notify();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  prompt = null;
  notify();
});
displayMode.addEventListener('change', (event) => {
  installed = event.matches;
  notify();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useInstallState() {
  return useSyncExternalStore(subscribe, () => installed ? 'installed' : prompt ? 'ready' : 'manual');
}

export async function installApp() {
  const pending = prompt;
  if (!pending) return;
  prompt = null; // A browser install event can only be used once, even after dismissal.
  notify();
  await pending.prompt();
  await pending.userChoice;
}

const RELOAD_KEY = 'pulsera-reload-version';
const VERSION_PARAM = '__pulsera_version';
const POLL_INTERVAL = 5 * 60 * 1000;
type UpdateState = { status: 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'error'; version?: string };
let updateState: UpdateState = { status: 'disabled' };
const updateListeners = new Set<() => void>();
function setUpdateState(state: UpdateState) {
  updateState = state;
  updateListeners.forEach((listener) => listener());
}
export function useUpdateState() {
  return useSyncExternalStore((listener) => {
    updateListeners.add(listener);
    return () => { updateListeners.delete(listener); };
  }, () => updateState);
}

async function latestVersion(): Promise<string> {
  const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Release check unavailable');
  const { version } = await response.json() as { version?: unknown };
  if (typeof version !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(version)) throw new Error('Invalid release marker');
  return version;
}

let checking = false;
export async function checkForUpdates(currentVersion = import.meta.env.BUILD_VERSION as string, manual = true) {
  if (checking) return;
  checking = true;
  const previous = updateState;
  if (manual && previous.status !== 'available') setUpdateState({ status: 'checking' });
  try {
    const version = await latestVersion();
    // Retain an update notice during a rolling deploy if another server still serves this version.
    if (version !== currentVersion) setUpdateState({ status: 'available', version });
    else if (previous.status !== 'available') setUpdateState({ status: manual ? 'current' : 'idle' });
  } catch {
    if (previous.status !== 'available' && manual) setUpdateState({ status: 'error' });
  } finally { checking = false; }
}

export function reloadForUpdate() {
  if (!updateState.version) return;
  const url = new URL(location.href);
  url.searchParams.set(VERSION_PARAM, updateState.version);
  try { sessionStorage.setItem(RELOAD_KEY, updateState.version); } catch { /* URL guard remains. */ }
  location.replace(url.href);
}

/** Return a cache-busting navigation only once per release, even during a rolling deploy. */
export async function startupUpdateUrl(currentVersion: string): Promise<string | null> {
  try {
    const version = await latestVersion();
    const url = new URL(location.href);
    if (version === currentVersion) {
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* Storage may be disabled. */ }
      if (url.searchParams.has(VERSION_PARAM)) {
        url.searchParams.delete(VERSION_PARAM);
        history.replaceState(history.state, '', url);
      }
      return null;
    }
    if (url.searchParams.get(VERSION_PARAM) === version) return null;
    try {
      if (sessionStorage.getItem(RELOAD_KEY) === version) return null;
      sessionStorage.setItem(RELOAD_KEY, version);
    } catch { /* The URL parameter still prevents a reload loop without session storage. */ }
    url.searchParams.set(VERSION_PARAM, version);
    return url.href;
  } catch {
    // Offline, timeouts and a temporarily unavailable release marker must not block startup.
    return null;
  }
}

export async function initializePwa(): Promise<boolean> {
  const local = /^(localhost|.*\.localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
  if (!import.meta.env.PWA_ENABLED || local || location.protocol !== 'https:') {
    // Remove only Pulsera's earlier local registration/cache, leaving other workers untouched.
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        for (const registration of registrations) {
          const worker = registration.active ?? registration.waiting ?? registration.installing;
          if (worker?.scriptURL === new URL('/sw.js', location.origin).href) await registration.unregister();
        }
        if ('caches' in window) {
          await Promise.all((await caches.keys()).filter((key) => key.startsWith('pulsera-offline-')).map((key) => caches.delete(key)));
        }
      }).catch(() => {});
    }
    return false;
  }

  const next = await startupUpdateUrl(import.meta.env.BUILD_VERSION as string);
  if (next) {
    location.replace(next);
    return true;
  }
  setUpdateState({ status: 'idle' });
  // Background checks only notify. Reloading during an active lesson always requires a click.
  let lastCheck = Date.now();
  const poll = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now();
    void checkForUpdates(import.meta.env.BUILD_VERSION as string, false);
  };
  window.setInterval(poll, POLL_INTERVAL);
  document.addEventListener('visibilitychange', poll);
  window.addEventListener('online', poll);
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((error: unknown) => console.warn('Pulsera offline support could not start.', error));
  }
  return false;
}
