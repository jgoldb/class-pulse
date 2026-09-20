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

export async function signInAs(page: Page, key: AccountKey) {
  await setupClerkTestingToken({ page });
  await page.goto('/');
  await clerk.signIn({ page, signInParams: { strategy: 'password', identifier: ACCOUNTS[key].email, password: PASSWORD } });
  await page.goto(ACCOUNTS[key].home);
  await expect(page).toHaveURL(new RegExp(`${ACCOUNTS[key].home}`));
}

export const test = base.extend<{ signInAs: (key: AccountKey) => Promise<void> }>({
  signInAs: async ({ page }, use) => {
    await use((key) => signInAs(page, key));
  },
});

export { expect };

/** Radix select helper: open the trigger and pick an option by visible text. */
export async function pickOption(page: Page, triggerLabel: string | RegExp, optionText: string | RegExp) {
  await page.getByRole('combobox', { name: triggerLabel }).first().click();
  await page.getByRole('option', { name: optionText }).first().click();
}

/** Wait for a toast containing text. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 });
}
