import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

test('deployment startup checks releases; polling notifies without navigating', async () => {
  const source = readFileSync('apps/web/src/lib/pwa.ts', 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', define: {
    'import.meta.env.PWA_ENABLED': 'true', 'import.meta.env.BUILD_VERSION': '"release-one"',
  } });
  const module = { exports: {} as any };
  let serverVersion = 'release-one';
  let clock = 0;
  let requests = 0;
  let registered = 0;
  let updated = 0;
  let unregistered = 0;
  let poll: () => void = () => {};
  const navigations: string[] = [];
  const document = { visibilityState: 'visible', addEventListener() {} };
  const location = { hostname: 'pulsera.example', protocol: 'https:', origin: 'https://pulsera.example', href: 'https://pulsera.example/teacher?class=1', replace: (url: string) => navigations.push(url) };
  const listeners = new Map<string, () => void>();
  const storage = new Map<string, string>();
  runInNewContext(code, {
    module, exports: module.exports, URL, AbortSignal, console, Date: { now: () => clock },
    require: () => ({ useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }),
    fetch: async () => { requests++; return { ok: true, json: async () => ({ version: serverVersion }) }; },
    location, document,
    history: { state: null, replaceState() {} },
    sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    navigator: { onLine: true, serviceWorker: {
      register: async () => { registered++; return { update: async () => { updated++; } }; },
      getRegistrations: async () => [{ active: { scriptURL: 'https://pulsera.example/sw.js' }, unregister: async () => { unregistered++; } }],
    } },
    window: {
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
      setInterval: (callback: () => void, ms: number) => { expect(ms).toBe(300000); poll = callback; },
    },
  });
  const api = module.exports;
  expect(await api.initializePwa()).toBe(false);
  await expect.poll(() => updated).toBe(1);
  expect(registered).toBe(1);
  expect(requests).toBe(1);
  serverVersion = 'release-two';
  clock += 300001;
  document.visibilityState = 'hidden';
  poll();
  expect(requests).toBe(1);
  document.visibilityState = 'visible';
  poll();
  await expect.poll(() => api.useUpdateState().status).toBe('available');
  expect(navigations).toEqual([]);
  api.reloadForUpdate();
  expect(navigations[0]).toContain('class=1&__pulsera_version=release-two');
  // Even an explicitly deployment-enabled build must not register when opened locally.
  location.hostname = 'localhost';
  expect(await api.initializePwa()).toBe(false);
  await expect.poll(() => unregistered).toBe(1);
  expect(registered).toBe(1);
});

test('release worker only caches the offline page and never intercepts data requests', async () => {
  const handlers = new Map<string, (event: any) => void>();
  const entries = new Map<string, Response>();
  let activated = false;
  const cache = {
    add: async (request: Request) => { entries.set(new URL(request.url).pathname, new Response('offline')); },
    match: async (path: string) => entries.get(path),
  };
  // Browser Request resolves relative URLs against the worker's origin; Node needs that explicitly.
  class WorkerRequest extends Request {
    constructor(input: string, init?: RequestInit) { super(new URL(input, 'https://pulsera.example'), init); }
  }
  runInNewContext(readFileSync('apps/web/service-worker.js', 'utf8'), {
    URL, Request: WorkerRequest, Response,
    fetch: async () => { throw new Error('offline'); },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    self: {
      location: { origin: 'https://pulsera.example' },
      clients: { claim: async () => {} },
      skipWaiting: async () => { activated = true; },
      addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler),
    },
  });
  let pending: Promise<unknown> = Promise.resolve();
  handlers.get('install')!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  expect(activated).toBe(true);
  expect([...entries.keys()]).toEqual(['/offline.html']);
  for (const path of ['/api/students', '/auth/me', '/health']) {
    let intercepted = false;
    handlers.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: `https://pulsera.example${path}` }, respondWith: () => { intercepted = true; } });
    expect(intercepted).toBe(false);
  }
  let response: Promise<Response> = Promise.resolve(new Response());
  handlers.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: 'https://pulsera.example/teacher/classes' }, respondWith: (promise: Promise<Response>) => { response = promise; } });
  expect(await (await response).text()).toBe('offline');
});
