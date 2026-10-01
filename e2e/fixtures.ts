import { test as base, expect, type Page } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';

/** Mirrors DEMO_ACCOUNTS in apps/api/src/seed.ts (kept separate so the seed's side effects never load into the test bundle). */
export const ACCOUNTS = {
  teacher: { email: 'teacher+clerk_test@example.com', name: 'Dana Whitfield', home: '/teacher' },
  teacher2: { email: 'teacher2+clerk_test@example.com', name: 'Luis Ortega', home: '/teacher' },
  support: { email: 'support+clerk_test@example.com', name: 'Priya Natarajan', home: '/support' },
  admin: { email: 'admin+clerk_test@example.com', name: 'Marcus Bell', home: '/admin' },
  student: { email: 'student+clerk_test@example.com', name: 'Avery Synthetic', home: '/student' },
  guardian: { email: 'guardian+clerk_test@example.com', name: 'Jordan Synthetic', home: '/family' },
} as const;
export type AccountKey = keyof typeof ACCOUNTS;
export const PASSWORD = process.env.SEED_PASSWORD || 'ClassPulse-demo-2026!';

/**
 * The Clerk instance verifies new devices, and every Playwright run is a new device: a correct
 * password leaves the attempt at `needs_client_trust`, wanting an email code. `clerk.signIn`
 * resolves anyway, with no session, so the next navigation bounces to /sign-in. Clerk's test
 * addresses (`+clerk_test`) always accept 424242, so finish the attempt here.
 */
async function trustThisDevice(page: Page) {
  const status = await page.evaluate(async () => {
    const w = window as unknown as { Clerk?: any };
    let si = w.Clerk?.client?.signIn;
    if (!si || si.status !== 'needs_client_trust') return si?.status ?? 'no-attempt';
    si = await si.prepareSecondFactor({ strategy: 'email_code' });
    si = await si.attemptSecondFactor({ strategy: 'email_code', code: '424242' });
    if (si.status === 'complete') await w.Clerk.setActive({ session: si.createdSessionId });
    return si.status;
  });
  if (status !== 'complete' && status !== 'no-attempt') {
    throw new Error(`Clerk sign-in did not complete: ${status}`);
  }
}

export async function signInAs(page: Page, key: AccountKey) {
  await setupClerkTestingToken({ page });
  await page.goto('/');
  await clerk.signIn({ page, signInParams: { strategy: 'password', identifier: ACCOUNTS[key].email, password: PASSWORD } });
  await trustThisDevice(page);
  await page.goto(ACCOUNTS[key].home);
  await expect(page).toHaveURL(new RegExp(`${ACCOUNTS[key].home}`));
}

export const test = base.extend<{ signInAs: (key: AccountKey) => Promise<void> }>({
  signInAs: async ({ page }, use) => {
    await use((key) => signInAs(page, key));
  },
});

export { expect };

/**
 * The seed leaves the demo student's review cycle due on purpose, which holds the plan in
 * `under_review`. Specs that need an active plan settle it here (decision: continue) instead of
 * relying on another spec having done so first.
 */
export async function ensureActivePlan(page: Page, student: RegExp) {
  await page.goto('/teacher/reviews');
  const review = page.getByRole('link', { name: student }).first();
  // The list loads asynchronously: give it time before concluding there is no review to settle.
  await review.waitFor({ timeout: 15_000 }).catch(() => undefined);
  if (!(await review.count())) return;
  await review.click();
  await expect(page).toHaveURL(/\/teacher\/reviews\//);
  // The decision panel renders after the review loads; only a decided review lacks it.
  await expect(page.getByRole('heading', { name: 'Plan review' })).toBeVisible();
  await page.getByTestId('record-review').waitFor({ timeout: 15_000 }).catch(() => undefined);
  if (!(await page.getByTestId('record-review').count())) return;
  await page.getByTestId('review-continue').click();
  await page.getByTestId('review-rationale').fill('Continuing the current plan so classroom input can inform a revision (e2e).');
  await page.getByTestId('record-review').click();
  await expectToast(page, /Review decided/);
}

/** Radix select helper: open the trigger and pick an option by visible text. */
export async function pickOption(page: Page, triggerLabel: string | RegExp, optionText: string | RegExp) {
  await page.getByRole('combobox', { name: triggerLabel }).first().click();
  await page.getByRole('option', { name: optionText }).first().click();
}

/** Wait for a toast containing text. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 });
}
