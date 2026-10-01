import { ensureActivePlan, expect, expectToast, test, signInAs } from './fixtures';

test('live classroom capture and family contribution retain source attribution across roles', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(900_000);
  const strategy = `Worked through an example together (synthetic run ${Date.now()})`;
  const adminContext = await browser.newContext({ baseURL });
  const teacherContext = await browser.newContext({ baseURL });
  const familyContext = await browser.newContext({ baseURL });
  const admin = await adminContext.newPage(), teacher = await teacherContext.newPage(), family = await familyContext.newPage();
  for (const page of [admin, teacher, family]) page.setDefaultTimeout(30_000);
  try {
    // A fresh seed must work with no admin setup: Class Pulse on, classroom prompt active.
    await signInAs(admin, 'admin');
    await admin.goto('/admin/prompts');
    const prompt = admin.getByRole('row').filter({ has: admin.getByText('classroom_draft.v4', { exact: true }) });
    await expect(prompt.getByText('active', { exact: true })).toBeVisible();
    await signInAs(teacher, 'teacher');
    // Today's session reopens automatically on a rerun against the same seed, so wait for the
    // page to settle on either the session bar or the open-class form before deciding.
    await expect(teacher.getByRole('button', { name: 'Open class', exact: true }).or(teacher.getByRole('button', { name: /^Session/ }))).toBeVisible();
    if (await teacher.getByRole('button', { name: 'Open class', exact: true }).isVisible()) {
      await teacher.getByLabel('Lesson topic').fill('Fractions');
      await teacher.getByRole('button', { name: 'Open class', exact: true }).click();
    }
    await teacher.getByRole('option', { name: /Avery Synthetic/ }).click();
    await teacher.getByRole('button', { name: 'Participation', exact: true }).click();
    const event = teacher.getByRole('listitem').filter({ hasText: 'Avery Synthetic' }).filter({ hasText: 'Contributed' }).first();
    await expect(event).toBeVisible();
    await event.getByRole('button', { name: /More actions/ }).click();
    await teacher.getByRole('menuitem', { name: 'Correct' }).click();
    await teacher.getByRole('dialog').getByRole('radio', { name: 'Asked a question' }).click();
    await teacher.getByLabel('Reason for correction').fill('Clarified the observable action');
    await teacher.getByRole('button', { name: 'Confirm correction', exact: true }).click();
    const corrected = teacher.getByRole('listitem').filter({ hasText: 'Avery Synthetic' }).filter({ hasText: 'Asked question' }).first();
    await expect(corrected).toBeVisible();
    await corrected.getByRole('button', { name: /Parent communication draft/ }).click();
    await expect(corrected.getByText('Family message', { exact: true })).toBeVisible();
    await teacher.getByRole('link', { name: 'Open drafts', exact: true }).click();
    await expect(teacher).toHaveURL(/\/teacher\/drafts$/);
    await teacher.getByRole('button', { name: /Family message/ }).first().click();
    await expect(teacher.getByRole('button', { name: 'Approve version 1' })).toBeVisible({ timeout: 180_000 });
    await teacher.getByRole('radio', { name: 'Family' }).click();
    await teacher.getByRole('button', { name: 'Approve version 1' }).click();
    await teacher.getByRole('button', { name: 'Share approved version in family portal' }).click();
    await expect(teacher.getByRole('button', { name: 'Remove from portal' })).toBeVisible();
    await signInAs(family, 'guardian');
    await expect(family.getByText('Family Pulse™')).toBeVisible();
    await family.getByRole('button', { name: 'Something that worked at home' }).click();
    const share = family.getByRole('dialog');
    await share.getByRole('combobox', { name: /^Teacher/ }).selectOption({ label: 'Dana Whitfield' });
    await share.getByLabel('Strategy', { exact: true }).fill(strategy);
    await share.getByRole('textbox', { name: 'Observed outcome', exact: true }).fill('Completed the next example independently');
    await share.getByRole('button', { name: 'Submit for teacher review' }).click();
    await expectToast(family, 'Submitted to your teacher. This is awaiting review.');
    await ensureActivePlan(teacher, /Avery Synthetic/);
    await teacher.goto('/teacher/students');
    await teacher.getByRole('radio', { name: /Avery Synthetic/ }).click();
    const contribution = teacher.getByTestId('contribution').filter({ hasText: strategy });
    await contribution.getByLabel('Your response').fill('Thank you. We can try an example in class.');
    await contribution.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('accepted');
    await contribution.getByRole('button', { name: 'Save educator response' }).click();
    await expect(contribution.getByText('Accepted', { exact: true })).toBeVisible();
    await teacher.getByText('Draft a support-plan revision from this history', { exact: true }).click();
    await teacher.getByRole('checkbox', { name: /Family report.*Home strategy/ }).first().check();
    await teacher.getByRole('combobox', { name: 'Strategy section', exact: true }).selectOption('parentGuardianSupport');
    await teacher.getByLabel('Proposed strategy', { exact: true }).fill('Offer one worked example before independent homework practice.');
    await teacher.getByLabel('Why this change is proposed', { exact: true }).fill('The family reported using a worked example. Review this proposed practice together.');
    await teacher.getByRole('button', { name: 'Prepare revision draft' }).click();
    await teacher.getByRole('link', { name: 'Review proposed plan revision' }).click();
    await expect(teacher.getByRole('heading', { name: 'Review draft plan' })).toBeVisible();
    await teacher.getByRole('button', { name: 'Accept remaining' }).click();
    await teacher.getByTestId('rationale').fill('Reviewed all sections and the attributed family report. Existing baseline measures are preserved.');
    await teacher.getByTestId('approve-plan').click();
    await expect(teacher).toHaveURL(/\/teacher\/cases\//);
    await family.reload();
    const submitted = family.getByTestId('contribution').filter({ hasText: strategy });
    await expect(submitted.getByText(/Thank you. We can try an example in class./)).toBeVisible();
    await expect(family.getByRole('heading', { name: 'Classroom Memory', exact: true })).toHaveCount(0);
    await expect(submitted.getByText(/This version informed approved support plan version \d+\./)).toBeVisible();
    await teacher.screenshot({ path: `e2e/screenshots/live-pulsera-${testInfo.project.name}.png`, fullPage: true });
  } finally {
    await Promise.all([adminContext.close(), teacherContext.close(), familyContext.close()]);
  }
});
