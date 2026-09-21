import { expect, expectToast, test } from './fixtures';

/** Phase 4 and the review cycle, on the seeded case: the motivating pattern and an open review. */
test.describe.configure({ mode: 'serial' });

test('the pattern card leads with evidence and can be confirmed into a strategy', async ({ page, signInAs }) => {
  await signInAs('teacher');
  await page.goto('/teacher/patterns');
  await page.getByRole('link', { name: /Context performance divergence/ }).first().click();
  await expect(page).toHaveURL(/\/teacher\/candidates\//);

  // Order is enforced visually: evidence, hypothesis, proposals.
  const steps = page.locator('text=/^[123] · (Evidence|Hypothesis|Proposals)$/');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('Evidence');
  await expect(steps.nth(1)).toContainText('Hypothesis');
  await expect(steps.nth(2)).toContainText('Proposals');
  await expect(page.getByText('Assignment grade', { exact: true })).toBeVisible();

  await page.getByTestId('start-review').click();
  await expect(page.getByTestId('decision-confirmed')).toBeVisible();
  await page.getByTestId('decision-confirmed').click();
  await page.getByTestId('seed-text').fill('Offer the next group task as an individual-then-share task; compare the group grade with the individual portion.');
  await page.getByTestId('record-decision').click();
  await expectToast(page, /Recorded: Confirmed/);
  await expect(page).toHaveURL(/\/teacher\/patterns$/);
  await expect(page.getByText('Decided (1)')).toBeVisible();
});

test('the family sees the confirmed pattern in plain language, never the candidate', async ({ page, signInAs }) => {
  await signInAs('guardian');
  await expect(page.getByRole('heading', { name: 'Patterns the teacher confirmed' })).toBeVisible();
  await expect(page.getByText('Context performance divergence')).toBeVisible();
  await expect(page.getByText(/hypothesis/i)).toHaveCount(0);
});

test('the review cycle shows the computed recommendation and requires a rationale to disagree', async ({ page, signInAs }) => {
  await signInAs('teacher');
  await page.goto('/teacher/reviews');
  await page.getByRole('link', { name: /Avery Synthetic/ }).first().click();
  await expect(page).toHaveURL(/\/teacher\/reviews\//);
  await expect(page.getByText(/Recommendation: /)).toBeVisible();
  const computed = page.locator('button[data-testid^="review-"]').filter({ hasText: 'computed' });
  await expect(computed).toHaveCount(1);
  const computedId = await computed.getAttribute('data-testid');
  // Disagree without a rationale → refused.
  const other = page.locator('button[data-testid^="review-"]').filter({ hasNot: page.getByText('computed') }).first();
  await other.click();
  await expect(page.getByText('Your decision differs from the computed recommendation')).toBeVisible();
  await page.getByTestId('record-review').click();
  await expect(page.getByText(/rationale is required/i)).toBeVisible();
  // Agree with the computed one → recorded.
  await page.getByTestId(computedId!).click();
  await page.getByTestId('review-rationale').fill('Agree with the computed recommendation (e2e).');
  await page.getByTestId('record-review').click();
  await expectToast(page, /Review decided/);
});
