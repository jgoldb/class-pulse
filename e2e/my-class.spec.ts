import { mkdirSync } from 'node:fs';
import { expect, expectToast, test } from './fixtures';

/**
 * A teacher builds their own roster and opens the family dashboard, with no administrator in
 * the loop — the path a teacher who signed up on their own actually takes.
 */
test.describe.configure({ mode: 'serial' });

// Unique per run: `e2e:fast` reuses the seeded branch, so a fixed name would collide with itself.
const RUN = String(Date.now()).slice(-5);
const SECTION = `Grade 7 — Period 6 Humanities ${RUN}`;
const STUDENT = { first: 'Rowan', last: `Placeholder${RUN}` };
const PARENT = `parent.${RUN}+clerk_test@example.com`;

test('a teacher adds a section and a student without an administrator', async ({ page, signInAs }) => {
  await signInAs('teacher');
  await page.goto('/teacher/class');
  await expect(page.getByRole('heading', { name: 'My class' })).toBeVisible();

  await page.getByTestId('add-section').click();
  await page.getByTestId('section-name').fill(SECTION);
  await page.getByTestId('section-grade').fill('7');
  await page.getByRole('button', { name: 'Add section' }).click();
  await expectToast(page, 'Section added');
  await expect(page.getByText(SECTION)).toBeVisible();

  await page.getByRole('button', { name: 'Add a student' }).last().click();
  await page.getByTestId('student-first').fill(STUDENT.first);
  await page.getByTestId('student-last').fill(STUDENT.last);
  await page.getByTestId('save-student').click();
  await expectToast(page, `${STUDENT.first} ${STUDENT.last} added`);
  await expect(page.getByText(`${STUDENT.first} ${STUDENT.last}`, { exact: true })).toBeVisible();
  await expect(page.getByText('No family access').last()).toBeVisible();

  // The new student is immediately available for an intake, which is the point of adding them.
  await page.goto('/teacher/intake');
  await page.getByRole('combobox', { name: 'Student' }).first().click();
  await expect(page.getByRole('option', { name: `${STUDENT.first} ${STUDENT.last}` })).toBeVisible();
});

test('the teacher opens the family dashboard, and says in plain language what it shows', async ({ page, signInAs }, info) => {
  await signInAs('teacher');
  await page.goto('/teacher/class');
  await page.getByRole('button', { name: 'Family access' }).last().click();
  await expect(page.getByText(/neither costs a seat/i)).toBeVisible();
  await expect(page.getByText('Nobody at home has access yet')).toBeVisible();

  await page.getByTestId('access-email').fill(PARENT);
  await page.getByTestId('send-access').click();
  await expectToast(page, /Invitation sent|access is on now/);
  await expect(page.getByText(PARENT)).toBeVisible();
  await expect(page.getByText('Invited').first()).toBeVisible();

  const dir = `e2e/screenshots/${info.project.name}`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/16-teacher-family-access.png`, fullPage: true });

  // Revoking takes the access away again, still without an administrator.
  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await expectToast(page, 'Invitation revoked');
  await expect(page.getByText('Nobody at home has access yet')).toBeVisible();
});

test("one teacher's class does not leak into another's", async ({ page, signInAs }) => {
  await signInAs('teacher2');
  await page.goto('/teacher/class');
  await expect(page.getByRole('heading', { name: 'My class' })).toBeVisible();
  await expect(page.getByText(`${STUDENT.first} ${STUDENT.last}`, { exact: true })).toBeHidden();
  await expect(page.getByText(SECTION)).toBeHidden();
});

test('a family sees no classroom surface at all', async ({ page, signInAs }) => {
  await signInAs('guardian');
  await expect(page.getByRole('link', { name: 'My class' })).toBeHidden();
  await page.goto('/teacher/class');
  await expect(page).toHaveURL(/\/family/);
});
