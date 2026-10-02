import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const harness = 'http://127.0.0.1:5188/e2e/pulse-ui.html?route=/';

test('production manifest and local preview stay worker-free', async ({ page, context, request }) => {
  const manifestResponse = await request.get('/site.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ id: '/', scope: '/', start_url: '/', display: 'standalone' });
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry: { sizes: string }) => entry.sizes === `${size}x${size}`);
    const response = await request.get(icon.src);
    expect(response.headers()['content-type']).toContain('image/png');
    const bytes = await response.body();
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Teach naturally/ })).toBeVisible();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  const devtools = await context.newCDPSession(page);
  const { installabilityErrors } = await devtools.send('Page.getInstallabilityErrors');
  // Playwright's isolated contexts are incognito; that browser policy is not an app defect.
  expect(installabilityErrors.filter((error) => error.errorId !== 'in-incognito')).toEqual([]);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
});

test('startup detects releases, preserves the route and prevents reload loops', async ({ page }) => {
  await page.goto(harness);
  await page.route('**/version.json?*', (route) => route.fulfill({ json: { version: 'release-two' } }));
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/web/src/lib/pwa.ts';
    const { startupUpdateUrl } = await import(modulePath);
    const next = await startupUpdateUrl('release-one');
    const repeated = await startupUpdateUrl('release-one');
    return { next, repeated };
  });
  expect(result.next).toContain('route=%2F');
  expect(result.next).toContain('__pulsera_version=release-two');
  expect(result.repeated).toBeNull();
  await page.route('**/version.json?*', (route) => route.abort());
  expect(await page.evaluate(async () => {
    const modulePath = '/apps/web/src/lib/pwa.ts';
    return (await import(modulePath)).startupUpdateUrl('release-one');
  })).toBeNull();
});

test('manual and background checks announce updates without reloading', async ({ page }, info) => {
  await page.goto('http://127.0.0.1:5188/e2e/pulse-ui.html?route=/updates');
  const check = (manual: boolean) => page.evaluate(async (isManual) => {
    const modulePath = '/apps/web/src/lib/pwa.ts';
    await (await import(modulePath)).checkForUpdates('release-one', isManual);
  }, manual);
  await page.route('**/version.json?*', (route) => route.fulfill({ json: { version: 'release-one' } }));
  await check(true);
  await expect(page.getByRole('status')).toHaveText("You're up to date.");
  await page.route('**/version.json?*', (route) => route.abort());
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.getByRole('status')).toContainText("Couldn't check");
  await page.route('**/version.json?*', (route) => route.fulfill({ json: { version: 'release-two' } }));
  await check(false);
  await expect(page.getByRole('button', { name: 'Update available — Reload' })).toBeVisible();
  expect(page.url()).not.toContain('__pulsera_version');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations.filter((entry) => ['serious', 'critical'].includes(entry.impact!))).toEqual([]);
  await page.screenshot({ path: `e2e/screenshots/pwa/update-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Update available — Reload' }).click();
  await expect(page).toHaveURL(/__pulsera_version=release-two/);
});

test('install guidance is accessible and fits the screen', async ({ page }, info) => {
  await page.goto(harness);
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(info.project.name === 'phone' ? 'Add to Home screen' : 'Add to Dock');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(scan.violations.filter((entry) => ['serious', 'critical'].includes(entry.impact!))).toEqual([]);
  await page.screenshot({ path: `e2e/screenshots/pwa/install-${info.project.name}.png` });
});

test('native install prompt handles dismissal, another opportunity, and installation', async ({ page }) => {
  await page.goto(harness);
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  const dispatchPrompt = async () => page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: async () => { document.documentElement.dataset.installPromptCalled = 'yes'; },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
  });
  await dispatchPrompt();
  await page.getByRole('button', { name: 'Install on this device' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-install-prompt-called', 'yes');
  await expect(page.getByRole('button', { name: 'Install on this device' })).toHaveCount(0);
  await dispatchPrompt();
  await expect(page.getByRole('button', { name: 'Install on this device' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
});

test('iPhone guidance and installed mode', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'iPhone' }));
  await page.goto(harness);
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Open as Web App');
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await page.reload();
  await expect(page.getByRole('heading', { name: /Teach naturally/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
});
