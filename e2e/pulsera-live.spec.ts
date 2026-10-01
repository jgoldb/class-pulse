import { expect, test, signInAs } from './fixtures';

test.afterEach(async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/admin/structure');
  await page.getByLabel('Enable Class Pulse').uncheck();
  await page.getByRole('button', { name: 'Save classroom settings' }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
});

test('live classroom capture and family contribution retain source attribution across roles', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(900_000);
  const strategy = `Worked through an example together (synthetic run ${Date.now()})`;
  const adminContext = await browser.newContext({ baseURL });
  const teacherContext = await browser.newContext({ baseURL });
  const familyContext = await browser.newContext({ baseURL });
  const admin = await adminContext.newPage(), teacher = await teacherContext.newPage(), family = await familyContext.newPage();
  for (const page of [admin, teacher, family]) page.setDefaultTimeout(30_000);
  try {
    await signInAs(admin, 'admin');
    await admin.goto('/admin/structure');
    await admin.getByLabel('Enable Class Pulse').check();
    await admin.getByRole('button', { name: 'Save classroom settings' }).click();
    await expect(admin.getByText('Settings saved', { exact: true })).toBeVisible();
    await admin.goto('/admin/prompts');
    const prompt = admin.getByRole('row').filter({ has: admin.getByText('classroom_draft.v3', { exact: true }) });
    await expect(prompt).toBeVisible();
    if (await prompt.getByRole('button', { name: 'Promote', exact: true }).count()) {
      await prompt.getByRole('button', { name: 'Run evals', exact: true }).click();
      await expect(admin.getByText('Eval run: 15/15 cases passed', { exact: true })).toBeVisible({ timeout: 600_000 });
      await prompt.getByRole('button', { name: 'Promote', exact: true }).click();
      await expect(prompt.getByText('active', { exact: true })).toBeVisible();
    }
    await signInAs(teacher, 'teacher');
    await teacher.getByLabel('Lesson topic').fill('Fractions');
    await teacher.getByRole('button', { name: 'Open class', exact: true }).click();
    await teacher.getByRole('button', { name: /Avery Synthetic/ }).click();
    await teacher.getByRole('button', { name: 'Confirm participation', exact: true }).click();
    await expect(teacher.getByText('Contributed', { exact: true })).toBeVisible();
    await teacher.getByRole('button', { name: 'Correct', exact: true }).click();
    await teacher.getByRole('dialog').getByRole('combobox', { name: 'Action', exact: true }).selectOption('asked_question');
    await teacher.getByLabel('Reason for correction').fill('Clarified the observable action');
    await teacher.getByRole('button', { name: 'Confirm correction', exact: true }).click();
    await expect(teacher.getByText('Asked question', { exact: true })).toBeVisible();
    await teacher.getByLabel('Use this observation as draft evidence').check();
    await teacher.getByRole('combobox', { name: 'Draft type', exact: true }).selectOption('parent_message');
    await teacher.getByRole('button', { name: 'Prepare from selected evidence' }).click();
    await expect(teacher.getByText('Draft requested. Review its status and wording in Drafts.', { exact: true })).toBeVisible();
    await teacher.getByRole('link', { name: 'Open drafts', exact: true }).click();
    await expect(teacher).toHaveURL(/\/teacher\/drafts$/);
    await teacher.getByRole('button', { name: /Parent message/ }).first().click();
    await expect(teacher.getByRole('button', { name: 'Approve version 1' })).toBeVisible({ timeout: 180_000 });
    await teacher.getByRole('combobox', { name: 'Intended audience' }).selectOption('family');
    await teacher.getByRole('button', { name: 'Approve version 1' }).click();
    await teacher.getByRole('button', { name: 'Share approved version in family portal' }).click();
    await expect(teacher.getByRole('button', { name: 'Remove from portal' })).toBeVisible();
    await signInAs(family, 'guardian');
    await family.getByRole('combobox', { name: /^Child/ }).selectOption({ label: 'Avery Synthetic' });
    await family.getByRole('combobox', { name: /^Teacher/ }).first().selectOption({ label: 'Dana Whitfield' });
    await family.getByLabel('Contribution type').selectOption('home_strategy');
    await family.getByLabel('Strategy', { exact: true }).fill(strategy);
    await family.getByRole('textbox', { name: 'Observed outcome', exact: true }).fill('Completed the next example independently');
    await family.getByRole('button', { name: 'Submit for teacher review' }).click();
    await expect(family.getByText('Submitted to your teacher. This is awaiting review.', { exact: true })).toBeVisible();
    await teacher.goto('/teacher/students');
    await teacher.getByRole('combobox', { name: /^Learner/ }).selectOption({ label: 'Avery Synthetic' });
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
