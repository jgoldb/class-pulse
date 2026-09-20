import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test } from './fixtures';

/**
 * The public path: landing → plan → simulated checkout → Clerk sign-up → workspace onboarding →
 * admin overview. Uses a fresh Clerk test address each run (`+clerk_test` addresses accept the
 * fixed verification code 424242 on development instances).
 */
test('landing page presents the product and both entry points', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Notice what a busy teacher would miss');
  await expect(page.getByRole('link', { name: /Start a workspace/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /I have an invitation/ })).toBeVisible();
});

test('plan → simulated checkout → sign-up → onboarding creates a workspace', async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto('/get-started');
  await expect(page.getByRole('heading', { name: 'Choose a plan' })).toBeVisible();
  await page.getByRole('button', { name: /^School/ }).click();
  await page.getByRole('button', { name: 'Continue to payment' }).click();

  await expect(page).toHaveURL(/\/checkout\/cs_sim_/);
  await expect(page.getByText('Simulated checkout')).toBeVisible();
  await page.getByTestId('cardholder').fill('E2E Administrator');
  await page.getByRole('button', { name: /^Pay / }).click();

  await expect(page).toHaveURL(/\/sign-up\?checkout=cs_sim_/);
  const email = `e2e-admin-${Date.now()}+clerk_test@example.com`;
  await page.locator('input[name="emailAddress"]').fill(email);
  await page.locator('input[name="password"]').fill(`E2E-pass-${Date.now()}!`);
  await page.locator('button[data-localization-key="formButtonPrimary"]').click();
  // Email verification on a development instance: test addresses accept 424242.
  const code = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  await expect(code).toBeVisible({ timeout: 20_000 });

  // In a real browser Clerk reaches this step with a full page load and no query string, which
  // is how a paying customer used to lose their checkout id. Reproduce that here — the testing
  // token otherwise hides it — so the flow has to survive the id being off the URL.
  await page.goto('/sign-up/verify-email-address');
  await expect(page).not.toHaveURL(/checkout=/);
  const codeAgain = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  await expect(codeAgain).toBeVisible({ timeout: 20_000 });
  await codeAgain.fill('424242');
  await expect(page).toHaveURL(/\/onboarding\?checkout=cs_sim_/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();

  await page.getByPlaceholder('Riverside Unified').fill('E2E District');
  await page.getByPlaceholder('Riverside Middle School').fill('E2E Middle School');
  await page.getByPlaceholder('Grade 6 — Period 3 Science').fill('Grade 6 — Period 1 Math');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/admin\?welcome=1/, { timeout: 30_000 });
  await expect(page.getByText('Your workspace is ready')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'E2E District' })).toBeVisible();
});

test('a signed-in person without an invitation sees the onboarding explanation, not data', async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto('/sign-up');
  const email = `e2e-orphan-${Date.now()}+clerk_test@example.com`;
  await page.locator('input[name="emailAddress"]').fill(email);
  await page.locator('input[name="password"]').fill(`E2E-pass-${Date.now()}!`);
  await page.locator('button[data-localization-key="formButtonPrimary"]').click();
  const code = page.locator('input[name="code"], input[autocomplete="one-time-code"]').first();
  await expect(code).toBeVisible({ timeout: 20_000 });
  await code.fill('424242');
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
  await expect(page.getByText("Your account isn't in a workspace yet")).toBeVisible();
  // Role surfaces bounce an unprovisioned account straight back to onboarding.
  await page.goto('/teacher');
  await expect(page).toHaveURL(/\/onboarding/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/onboarding/);

  // A checkout id that was never paid shows the form but buys nothing: the API is the guard.
  await page.goto('/onboarding?checkout=cs_sim_neverpaid');
  await page.getByPlaceholder('Riverside Unified').fill('Unpaid District');
  await page.getByPlaceholder('Riverside Middle School').fill('Unpaid School');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('Complete checkout before creating a workspace')).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding/);
});
