import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, expectToast, test } from './fixtures';

/**
 * A teacher creates a class, edits it later, and manages its roster, with no administrator in the
 * loop — against the real API and database. Pulsera visual/UX spec §9: Add Class, Edit Class /
 * Section in place, Manage Students as a separate action, Archive rather than delete.
 */
test.describe.configure({ mode: 'serial' });

// Unique per run: `e2e:fast` reuses the seeded branch, so a fixed name would collide with itself.
const RUN = String(Date.now()).slice(-5);
const SECTION = `7 Humanities - Section ${RUN}`;
const RENAMED = `7 Humanities - Section ${RUN}B`;
const COURSE = `Humanities ${RUN}`;
const FIRST = { first: 'Rowan', last: `Placeholder${RUN}` };
const SECOND = { first: 'Lane', last: `Fixture${RUN}` };
const PARENT = `parent.${RUN}+clerk_test@example.com`;

const card = (page: Page) => page.locator('article').filter({ hasText: COURSE });
async function openMenu(page: Page, item: string) {
  await card(page).getByRole('button', { name: /^Actions for/ }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('a teacher adds a class with a student, then edits it in place', async ({ page, signInAs }, info) => {
  await signInAs('teacher');
  await page.goto('/teacher/classes');
  await expect(page.getByRole('heading', { name: 'My Classes' })).toBeVisible();

  await page.getByTestId('add-class').click();
  await page.getByTestId('class-course').fill(COURSE);
  await page.getByTestId('section-name').fill(SECTION);
  await page.getByTestId('section-grade').fill('7');
  await page.getByRole('combobox', { name: 'Period' }).click();
  await page.getByRole('option', { name: 'Period 6' }).click();
  await page.getByTestId('class-room').fill('204');
  await page.getByTestId('add-class-next').click();
  await page.getByTestId('new-student-first').fill(FIRST.first);
  await page.getByTestId('new-student-last').fill(FIRST.last);
  await page.getByTestId('new-student-add').click();
  await page.getByTestId('add-class-next').click();
  await expect(page.getByRole('dialog')).toContainText('1 student');
  await page.getByTestId('add-class-create').click();
  await expectToast(page, 'Class created');
  await expect(card(page)).toContainText(`${SECTION} · Period 6 · Room 204`);
  await expect(card(page)).toContainText('1 student');

  // Edit Class: pre-filled, Save disabled until something changes, updated in place.
  await openMenu(page, 'Edit Class');
  await expect(page.getByTestId('section-name')).toHaveValue(SECTION);
  await expect(page.getByTestId('save-class')).toBeDisabled();
  await page.getByTestId('section-name').fill(RENAMED);
  await page.getByTestId('class-room').fill('118');
  await page.getByTestId('save-class').click();
  await expectToast(page, 'Class updated.');
  await expect(card(page)).toContainText(`${RENAMED} · Period 6 · Room 118`);
  await expect(card(page)).toContainText('1 student');
  const dir = `e2e/screenshots/${info.project.name}`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/15-teacher-classes-edited.png`, fullPage: true });

  // The card opens Class Pulse for that class, under its new name.
  await card(page).getByRole('link', { name: COURSE }).click();
  await expect(page.getByTestId('class-identity')).toContainText(COURSE);
  await expect(page.getByTestId('class-identity')).toContainText(RENAMED);
});

test('Manage Students adds and removes students, separately from class details', async ({ page, signInAs }, info) => {
  await signInAs('teacher');
  await page.goto('/teacher/classes');
  await openMenu(page, 'Manage Students');
  await expect(page.getByRole('heading', { name: 'Manage Students' })).toBeVisible();
  await page.getByTestId('add-student').click();
  await page.getByTestId('student-first').fill(SECOND.first);
  await page.getByTestId('student-last').fill(SECOND.last);
  await page.getByTestId('save-student').click();
  await expectToast(page, `${SECOND.first} ${SECOND.last} added`);
  await page.keyboard.press('Escape');
  const roster = page.getByRole('list', { name: 'Roster' });
  await expect(roster.getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: `More for ${SECOND.first} ${SECOND.last}` }).click();
  await page.getByRole('menuitem', { name: 'Remove from this class' }).click();
  await expect(page.getByRole('dialog')).toContainText('are kept');
  await page.getByTestId('confirm-remove').click();
  await expectToast(page, `${SECOND.first} ${SECOND.last} removed from this class`);
  await expect(roster.getByRole('listitem')).toHaveCount(1);
  await expect(roster).toContainText(`${FIRST.first} ${FIRST.last}`);
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}/15-teacher-manage-students.png`, fullPage: true });
});

test('the teacher opens the family dashboard, and says in plain language what it shows', async ({ page, signInAs }, info) => {
  await signInAs('teacher');
  await page.goto('/teacher/classes');
  await openMenu(page, 'Manage Students');
  await page.getByRole('button', { name: 'Family access' }).first().click();
  await expect(page.getByText(/neither costs a seat/i)).toBeVisible();
  await expect(page.getByText('Nobody at home has access yet')).toBeVisible();

  await page.getByTestId('access-email').fill(PARENT);
  await page.getByTestId('send-access').click();
  await expectToast(page, /Invitation sent|access is on now/);
  await expect(page.getByText(PARENT, { exact: true })).toBeVisible();
  await expect(page.getByText('Invited').first()).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/${info.project.name}/16-teacher-family-access.png`, fullPage: true });

  // Revoking takes the access away again, still without an administrator.
  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await expectToast(page, 'Invitation revoked');
  await expect(page.getByText('Nobody at home has access yet')).toBeVisible();
});

test("one teacher's class does not leak into another's", async ({ page, signInAs }) => {
  await signInAs('teacher2');
  await page.goto('/teacher/classes');
  await expect(page.getByRole('heading', { name: 'My Classes' })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await page.goto('/teacher/students');
  await expect(page.getByText(`${FIRST.first} ${FIRST.last}`, { exact: true })).toBeHidden();
});

test('archiving keeps the class and its records, and takes it out of Class Pulse', async ({ page, signInAs }) => {
  await signInAs('teacher');
  await page.goto('/teacher/classes');
  await openMenu(page, 'Archive');
  await page.getByTestId('confirm-archive').click();
  await expectToast(page, 'Class archived.');
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('button', { name: /^Archived/ }).click();
  await expect(page.getByText(COURSE)).toBeVisible();
  await page.getByTestId('class-selector').click();
  await expect(page.getByRole('menuitem', { name: new RegExp(COURSE) })).toHaveCount(0);
});

test('a family sees no classroom surface at all', async ({ page, signInAs }) => {
  await signInAs('guardian');
  await expect(page.getByRole('link', { name: 'Classes' })).toBeHidden();
  await page.goto('/teacher/classes');
  await expect(page).toHaveURL(/\/family/);
});
