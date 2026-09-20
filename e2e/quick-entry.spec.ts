import { mkdirSync } from 'node:fs';
import { expect, expectToast, test } from './fixtures';

/**
 * The 15-second interaction, measured on a phone viewport (docs/06 Phase 3 exit criterion).
 * Runs in both projects; the mobile project uses a Pixel 7 emulation.
 */
test('quick entry: two taps and a save, timed', async ({ page, signInAs }, info) => {
  await signInAs('teacher');
  await page.goto('/teacher/cases');
  await page.getByText('Avery Synthetic').first().click();
  await page.getByTestId('quick-entry').click();
  await expect(page.getByText('to save')).toBeVisible();

  const t0 = Date.now();
  const plus = page.locator('[data-testid^="count-"]').first();
  await plus.click();
  await plus.click();
  await page.getByTestId('save-entry').click();
  await expectToast(page, /Saved 2 entries/);
  const elapsed = Date.now() - t0;
  console.log(`[quick-entry] ${info.project.name}: ${elapsed}ms from first tap to saved`);
  expect(elapsed).toBeLessThan(15_000);

  const dir = `e2e/screenshots/${info.project.name}`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/18-teacher-quick-entry-after-save.png`, fullPage: true });

  // Outside the timed run: the Save bar and the shell's mobile tab bar are both fixed to the
  // bottom of the viewport, so the primary action has to be the element at its own centre rather
  // than the navigation underneath it. One tap first — a disabled Save is pointer-events:none.
  await plus.click();
  const saveOwnsItsCentre = await page.getByTestId('save-entry').evaluate((btn) => {
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return el === btn || btn.contains(el);
  });
  expect(saveOwnsItsCentre).toBe(true);
});
