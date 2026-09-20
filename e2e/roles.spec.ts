import { expect, expectToast, test } from './fixtures';

/** Every role surface, driven through the real UI with real Clerk sessions. */

test('student: goals, things that help, and a check-in that saves', async ({ page, signInAs }) => {
  await signInAs('student');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi Avery');
  await expect(page.getByText("Today's check-in")).toBeVisible();
  // Nothing a student must never see (docs/04 section 13) is on the page.
  for (const forbidden of ['Hypothes', 'Intake', 'candidate', 'Data quality', 'Teacher notes']) {
    await expect(page.getByText(new RegExp(forbidden, 'i'))).toHaveCount(0);
  }
  const goalButtons = page.locator('button', { hasText: /Talks|Leaves/ });
  if ((await goalButtons.count()) > 0) await goalButtons.first().click();
  await page.getByTestId('rating-3').click();
  await page.getByTestId('save-checkin').click();
  await expectToast(page, /Check-in saved/);
});

test('family: provenance, goals without raw baselines, data explanation, correction request', async ({ page, signInAs }) => {
  await signInAs('guardian');
  await expect(page.getByText('About this plan')).toBeVisible();
  await expect(page.getByText(/approved by/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What is collected, and why' })).toBeVisible();
  await expect(page.getByText(/Baseline ambiguous|Reported:/)).toHaveCount(0);
  await page.getByLabel('Subject').fill('Date of an entry looks wrong');
  await page.getByLabel('What should be corrected?').fill('The Sep 4 entry was a day my child was absent.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expectToast(page, /Request sent/);
  await expect(page.getByText('Date of an entry looks wrong')).toBeVisible();
});

test('teacher sees and resolves the family request', async ({ page, signInAs }) => {
  await signInAs('teacher');
  await page.goto('/teacher/requests');
  await expect(page.getByText('Date of an entry looks wrong')).toBeVisible();
  await page.getByPlaceholder('Your response (the family sees this)').first().fill('Thanks — corrected the date.');
  await page.getByRole('button', { name: 'Mark resolved' }).first().click();
  await expectToast(page, /Marked resolved/);
});

test('support professional: cross-case view and the support queue', async ({ page, signInAs }) => {
  await signInAs('support');
  await expect(page.getByRole('heading', { name: 'My students' })).toBeVisible();
  await expect(page.getByText('Cross-case view')).toBeVisible();
  await expect(page.getByText('Avery Synthetic')).toBeVisible();
  await page.goto('/support/patterns');
  await expect(page.getByRole('heading', { name: 'Support-team queue' })).toBeVisible();
});

test('second teacher is scoped to their own section only', async ({ page, signInAs }) => {
  await signInAs('teacher2');
  await expect(page.getByText('Avery Synthetic')).toHaveCount(0);
  await expect(page.getByText(/Oakley Example|Parker Mock/)).toBeVisible();
});

test('administrator: aggregates, catalog, equity, structure and invitations', async ({ page, signInAs }) => {
  await signInAs('admin');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo Unified District');
  await expect(page.getByText('Active cases')).toBeVisible();
  await expect(page.getByText('Avery Synthetic')).toHaveCount(0);

  await page.goto('/admin/catalog');
  await expect(page.getByText('Context performance divergence')).toBeVisible();
  await page.goto('/admin/equity');
  await expect(page.getByText('Equity monitoring')).toBeVisible();
  await expect(page.getByText('suppressed').first()).toBeVisible();

  await page.goto('/admin/structure');
  await page.getByTestId('section-name').fill(`E2E Section ${Date.now()}`);
  await page.getByTestId('add-section').click();
  await expectToast(page, /Section added/);

  await page.goto('/admin/people');
  await page.getByTestId('invite-email').fill(`e2e-teacher-${Date.now()}+clerk_test@example.com`);
  await page.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: /E2E Section/ }).first().click();
  await page.getByTestId('send-invite').click();
  await expectToast(page, /Invitation email sent/);
  await expect(page.getByText('pending').first()).toBeVisible();
});
