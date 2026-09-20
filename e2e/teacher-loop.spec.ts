import { expect, expectToast, pickOption, test } from './fixtures';

/**
 * Phase 0–3 in one run through the real UI, the real API, the real model:
 * intake (with a PII catch at the keyboard) → draft → section-by-section approval → quick entry.
 */
test.describe.configure({ mode: 'serial' });

test('teacher landing shows what needs a decision and the roster', async ({ page, signInAs }) => {
  await signInAs('teacher');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening), Dana/);
  await expect(page.getByText('Active plans')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
  await expect(page.getByText('Avery Synthetic')).toBeVisible();
});

test('intake catches a student name at the keyboard, then generates and approves a plan', async ({ page, signInAs }) => {
  test.setTimeout(420_000);
  await signInAs('teacher');
  await page.goto('/teacher/intake');
  await pickOption(page, 'Student', /Casey Sample/);
  await expect(page.getByTestId('gradeLevel')).toHaveValue('6');

  // A classmate's name in the observation: flagged live, fixed with one tap.
  const behavior = page.getByTestId('observableBehavior');
  await behavior.fill('During independent work the student talks to Blake Fictional and sometimes leaves their seat without permission. Counted 4, 3, 5, 4, 6 times over five periods.');
  await expect(page.getByTestId('pii-warning')).toBeVisible();
  await expect(page.getByTestId('submit-intake')).toBeDisabled();
  await page.getByTestId('pii-fix').click();
  await expect(behavior).not.toHaveValue(/Blake/);
  await expect(page.getByTestId('pii-warning')).toBeHidden();

  await page.getByTestId('baselineInformation').fill('Leaving seat counted over five periods: 4, 3, 5, 4, 6.');
  await page.getByTestId('documentedPatterns').fill('More common during longer assignments and in the last 15 minutes of the period.');
  await page.getByTestId('strengthsInterests').fill('Enjoys technology, responds well to positive feedback, works well when assignments are divided into smaller parts.');
  await page.getByTestId('currentStrategies').fill('Verbal reminders to return to the assignment.');
  await page.getByTestId('desiredBehavior').fill('The student will remain in the assigned area and complete independent work.');
  await page.getByTestId('submit-intake').click();

  await expect(page).toHaveURL(/\/teacher\/drafts\//);
  await expect(page.getByRole('heading', { name: 'Review draft plan' })).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText('Passed guardrails')).toBeVisible();

  // Decide on every section, then approve with a reviewer note.
  await page.getByRole('button', { name: 'Accept remaining' }).click();
  await expect(page.getByText('16/16 decided')).toBeVisible();
  await page.getByTestId('rationale').fill('Reviewed every section in the e2e run.');
  await page.getByTestId('approve-plan').click();
  await expectToast(page, 'Plan approved');
  await expect(page).toHaveURL(/\/teacher\/cases\//);
  await expect(page.getByText('Plan Active')).toBeVisible();

  // Quick entry: two taps and save.
  await page.getByTestId('quick-entry').click();
  await expect(page).toHaveURL(/\/log$/);
  const plus = page.locator('[data-testid^="count-"]').first();
  await plus.click();
  await plus.click();
  await expect(page.getByText('2 to save')).toBeVisible();
  await page.getByTestId('save-entry').click();
  await expectToast(page, /Saved 2 entries/);
});

test('the case shows the approved plan, provenance and the new entries', async ({ page, signInAs }) => {
  await signInAs('teacher');
  await page.goto('/teacher/cases');
  await page.getByText('Casey Sample').first().click();
  await expect(page.getByText('Plan Active')).toBeVisible();
  await page.getByRole('tab', { name: 'Plan' }).click();
  await expect(page.getByText('Measurable Behavior Goals')).toBeVisible();
  await page.getByRole('tab', { name: 'Progress' }).click();
  await expect(page.locator('text=/n=\\d+/').first()).toBeVisible();
});
