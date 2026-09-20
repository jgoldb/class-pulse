import { mkdirSync } from 'node:fs';
import { expect, test, type AccountKey } from './fixtures';

/**
 * Visual sweep: every screen, every role, at desktop and phone widths. Screenshots land in
 * e2e/screenshots/<project>/ so a human (or Claude) can look at the product rather than infer it.
 */
const SCREENS: Array<{ name: string; as: AccountKey | null; path: string; expectText: string | RegExp }> = [
  { name: '00-landing', as: null, path: '/', expectText: 'Notice what a busy teacher' },
  { name: '01-get-started', as: null, path: '/get-started', expectText: 'Choose a plan' },
  { name: '02-sign-in', as: null, path: '/sign-in', expectText: /Sign in|Welcome back/ },
  { name: '10-teacher-today', as: 'teacher', path: '/teacher', expectText: /Good (morning|afternoon|evening)/ },
  { name: '11-teacher-cases', as: 'teacher', path: '/teacher/cases', expectText: 'Cases' },
  { name: '12-teacher-intake', as: 'teacher', path: '/teacher/intake', expectText: 'New intake' },
  { name: '13-teacher-patterns', as: 'teacher', path: '/teacher/patterns', expectText: 'Pattern queue' },
  { name: '14-teacher-reviews', as: 'teacher', path: '/teacher/reviews', expectText: 'Plan reviews' },
  { name: '20-student', as: 'student', path: '/student', expectText: 'Hi Avery' },
  { name: '30-family', as: 'guardian', path: '/family', expectText: 'About this plan' },
  { name: '40-support', as: 'support', path: '/support', expectText: 'My students' },
  { name: '50-admin-overview', as: 'admin', path: '/admin', expectText: 'Active cases' },
  { name: '51-admin-catalog', as: 'admin', path: '/admin/catalog', expectText: 'Pattern catalog' },
  { name: '52-admin-equity', as: 'admin', path: '/admin/equity', expectText: 'Equity monitoring' },
  { name: '53-admin-prompts', as: 'admin', path: '/admin/prompts', expectText: 'Prompts & evals' },
  { name: '54-admin-people', as: 'admin', path: '/admin/people', expectText: 'People & access' },
  { name: '55-admin-structure', as: 'admin', path: '/admin/structure', expectText: 'School structure' },
  { name: '56-admin-audit', as: 'admin', path: '/admin/audit', expectText: 'Audit log' },
];

test.describe.configure({ mode: 'serial' });

for (const s of SCREENS) {
  test(`screen ${s.name}`, async ({ page, signInAs }, info) => {
    if (s.as) await signInAs(s.as);
    await page.goto(s.path);
    await expect(page.getByText(s.expectText).first()).toBeVisible();
    await page.waitForTimeout(600); // let enter animations settle
    const dir = `e2e/screenshots/${info.project.name}`;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/${s.name}.png`, fullPage: true });
    if (s.as) await page.context().clearCookies();
  });
}

test('case detail, pattern card and review decision (teacher)', async ({ page, signInAs }, info) => {
  await signInAs('teacher');
  const dir = `e2e/screenshots/${info.project.name}`;
  mkdirSync(dir, { recursive: true });
  await page.goto('/teacher/cases');
  await page.getByText('Avery Synthetic').first().click();
  await expect(page.getByText(/Plan (Active|Under review)/)).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/15-teacher-case.png`, fullPage: true });
  for (const tab of ['Plan', 'Progress', 'Patterns', 'Data quality']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/15-teacher-case-${tab.toLowerCase().replace(' ', '-')}.png`, fullPage: true });
  }
  await page.getByRole('tab', { name: 'Patterns' }).click();
  const card = page.getByRole('link', { name: /Context performance divergence/ }).first();
  if (await card.isVisible()) {
    await card.click();
    await expect(page.getByText('1 · Evidence')).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/16-teacher-pattern-card.png`, fullPage: true });
  }
  await page.goto('/teacher/reviews');
  const review = page.getByRole('link', { name: /Avery Synthetic/ }).first();
  if (await review.isVisible()) {
    await review.click();
    await expect(page.getByText('Plan review')).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/17-teacher-review.png`, fullPage: true });
  }
  await page.goto('/teacher/cases');
  await page.getByText('Avery Synthetic').first().click();
  const qe = page.getByTestId('quick-entry');
  if (await qe.isVisible()) {
    await qe.click();
    await expect(page.getByText('to save')).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${dir}/18-teacher-quick-entry.png`, fullPage: true });
  }
});
