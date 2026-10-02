import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** WCAG 2 A/AA scan; serious and critical findings fail the walkthrough. */
async function expectAccessible(page: Page, where: string) {
  // Toasts are excluded: they are scanned mid fade-in, so axe measures partial opacity, not their colour.
  // Likewise wait for finite transitions (a button that just became enabled fades in over ~150 ms).
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[data-sonner-toaster]').analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.flatMap((v) => v.nodes.map((n) => `${where}: ${v.id} ${n.target.join(' ')} ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 180)}`))).toEqual([]);
}

test('draft evidence, editing, exact-version approval, portal sharing and export', async ({ page }, testInfo) => {
  const now = new Date().toISOString();
  const draft: any = { id: 'draft', sessionId: 'session', kind: 'parent_message', revision: 1, sources: [{ eventId: 'event', revision: 1 }], generationState: 'ready', reviewState: 'suggested', publicationState: 'unpublished', createdAt: now, expiresAt: new Date(Date.now() + 86400000).toISOString() };
  const revisions: any[] = [{ revision: 1, createdBy: 'ai', createdAt: now, content: { kind: 'parent_message', title: 'A classroom success', message: 'The learner explained a worked example.', sourceNumbers: [1] } }];
  const publications: any[] = [];
  const sourceContext = [{ number: 1, studentId: 'student', firstName: 'Robin', lastName: 'Example', observedAt: now, source: 'teacher_text', confirmedBy: 'teacher' }];
  await page.route('**/api/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const respond = (value: unknown) => route.fulfill({ json: value });
    if (path === '/api/pulse/drafts') return respond([draft]);
    if (path === '/api/pulse/drafts/draft') return respond({ draft, revisions, publications, sourceContext, evidence: [{ number: 1, observation: { kind: 'praise', strength: 'Explained a worked example', note: '' } }] });
    if (path.endsWith('/edit')) {
      const input = req.postDataJSON(); expect(input.expectedRevision).toBe(1);
      draft.revision = 2; revisions.push({ revision: 2, createdBy: 'teacher', createdAt: now, content: input.content }); return respond({ revision: 2 });
    }
    if (path.endsWith('/approve')) {
      const input = req.postDataJSON(); expect(input).toEqual({ expectedRevision: 2, audience: 'family' });
      draft.reviewState = 'approved'; draft.publicationState = 'logged'; publications.push({ revision: 2, approvedBy: 'teacher', approverName: 'Ms. Taylor', audience: 'family', approvedAt: now, portalShared: false, deliveryState: 'not_sent' }); return respond({ ok: true });
    }
    if (path.endsWith('/share')) { expect(req.postDataJSON()).toEqual({ expectedRevision: 2, shared: true }); publications[0].portalShared = true; return respond({ ok: true }); }
    if (path.endsWith('/export')) return respond({ content: revisions[1].content, publication: publications[0], sourceContext, templateStatus: null });
    return respond([]);
  });
  await page.goto('/e2e/pulse-ui.html?route=/teacher/drafts');
  await page.getByRole('button', { name: /^Review Family message/ }).click();
  await expect(page.getByText(/Source 1 · Praise · Robin Example/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit wording', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Today the learner explained a worked example to the class.');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect(page.getByRole('button', { name: 'Approve version 2' })).toBeVisible();
  await page.getByRole('radio', { name: 'Family' }).click();
  await page.getByRole('button', { name: 'Approve version 2' }).click();
  // Approval is a deliberate second step that names the version and audience.
  await expect(page.getByRole('group', { name: 'Confirm approval' })).toContainText('Approve version 2 for the family');
  await page.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Approved by Ms. Taylor. External delivery: not sent.')).toBeVisible();
  expect(publications[0].portalShared).toBe(false);
  await page.getByRole('button', { name: 'Share approved version in family portal' }).click();
  await expect(page.getByRole('button', { name: 'Remove from portal' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export approved version' }).click();
  expect((await downloaded).suggestedFilename()).toBe('pulsera-parent_message-v2.txt');
  await expect(page.getByRole('status').filter({ hasText: 'Approved version exported. No message was sent.' })).toBeVisible();
  await expectAccessible(page, 'draft review');
  await page.screenshot({ path: `e2e/screenshots/draft-review-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('family contribution, multiple-child selection, educator response, and correction', async ({ page }, testInfo) => {
  const people = ['Robin Example', 'Casey Sample'].map((displayName, index) => ({ id: `student-${index}`, displayName, sections: [{ id: 'section', name: 'Grade 6 · Science', teachers: [{ id: 'teacher', name: 'Ms. Taylor' }] }] }));
  let role = 'guardian';
  const contributions: any[] = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const respond = (value: unknown) => route.fulfill({ json: value });
    if (path === '/api/pulse/people') { role = url.searchParams.get('role')!; return respond(people); }
    if (path.startsWith('/api/pulse/people/')) return respond({ successes: [], updates: [], history: [], acceptedContributions: role === 'teacher' ? contributions.filter((c) => c.studentId === path.split('/').at(-1) && c.status === 'accepted').map((c) => ({ ...c, acceptedAt: c.respondedAt })) : [], strategies: [], caseKeys: [], memoryWindowDays: 120, coverageNote: 'Only current, confirmed observations are shown.' });
    if (path === '/api/pulse/contributions') {
      if (req.method() === 'GET') return respond(contributions.filter((c) => c.studentId === url.searchParams.get('studentId')).map((c) => ({ ...c, own: role === 'guardian' })));
      const input = req.postDataJSON();
      contributions.push({ id: 'contribution', revision: 1, studentId: input.studentId, content: input.content, status: 'pending', sourceRole: 'guardian', authorName: 'Family member', createdAt: new Date().toISOString(), response: null });
      return respond({ id: 'contribution', revision: 1 });
    }
    if (path.endsWith('/respond')) { const input = req.postDataJSON(); Object.assign(contributions[0], { status: input.decision, response: input.response, respondedAt: new Date().toISOString() }); return respond({ ok: true }); }
    if (path.endsWith('/correct')) { Object.assign(contributions[0], { content: req.postDataJSON().content, revision: 2, status: 'pending', response: null }); return respond({ id: 'contribution', revision: 2 }); }
    return respond([]);
  });
  await page.goto('/e2e/pulse-ui.html?route=/family');
  await page.getByRole('radio', { name: /Casey Sample/ }).click();
  await page.getByRole('button', { name: 'Something that worked at home' }).click();
  await page.getByLabel('Strategy', { exact: true }).fill('Worked through an example together');
  await page.getByRole('textbox', { name: 'Observed outcome', exact: true }).fill('Completed the next example independently');
  await page.getByRole('button', { name: 'Submit for teacher review' }).click();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  expect(contributions[0].studentId).toBe('student-1');
  await expectAccessible(page, 'family pulse');
  await page.screenshot({ path: `e2e/screenshots/family-pulse-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/e2e/pulse-ui.html?route=/teacher/students');
  const learner = page.getByRole('radio', { name: /Casey Sample/ });
  if (await learner.isVisible()) await learner.click(); else await page.getByRole('combobox', { name: 'Student', exact: true }).selectOption('student-1');
  await page.getByLabel('Your response').fill('Thank you. We can try a similar example in class.');
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('accepted');
  await page.getByRole('button', { name: 'Save educator response' }).click();
  await expect(page.getByText('Family perspective · accepted', { exact: true })).toBeVisible();
  await expectAccessible(page, 'students');
  await page.screenshot({ path: `e2e/screenshots/classroom-memory-${testInfo.project.name}.png`, fullPage: true });
  await page.goto('/e2e/pulse-ui.html?route=/family');
  await page.getByRole('radio', { name: /Casey Sample/ }).click();
  await expect(page.getByText('Thank you. We can try a similar example in class.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Correct contribution' }).click();
  await page.getByRole('textbox', { name: 'Observed outcome', exact: true }).fill('Asked for help on the next example');
  await page.getByRole('button', { name: 'Submit corrected version' }).click();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  expect(contributions[0].revision).toBe(2);
});

test('no-plan capture, failed-response retry, correction and draft navigation', async ({ page }, testInfo) => {
  const section = { id: 'section', schoolId: 'school', name: 'Grade 6 · Science', gradeLevel: '6', periodTag: 'period_1', timezone: 'America/New_York', enabled: true };
  const students = ['Robin Example', 'Casey Sample', 'Alex Demo', 'Jordan Test'].map((displayName, i) => ({ id: `student-${i}`, displayName, firstName: displayName.split(' ')[0], lastName: displayName.split(' ')[1], gradeLevel: '6', sectionIds: ['section'] }));
  const session = { id: 'c7a6c38a-5eb2-448b-b648-0f41bde1c3c1', date: '2026-09-30', topic: 'Fractions', objective: 'Compare fractions', timezone: 'America/New_York', contextTags: ['period_1'] };
  const events: any[] = [];
  const requests: string[] = [];
  const drafted: unknown[] = [];
  let opened = false, loseReply = true;
  await page.route('**/api/**', async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const respond = (value: unknown) => route.fulfill({ json: value });
    if (path === '/api/pulse/sections') return respond([section]);
    if (path === '/api/classroom') return respond({ schools: [], sections: [section], students, access: [] });
    if (path === '/api/pulse/seating') return respond({ version: 0, positions: [] });
    if (path === '/api/pulse/sessions' && req.method() === 'GET') return respond(opened ? [session] : []);
    if (path === '/api/pulse/sessions' && req.method() === 'POST') { opened = true; return respond({ id: session.id }); }
    if (path === `/api/pulse/sessions/${session.id}`) return respond({ session, seating: [], events });
    if (path === '/api/pulse/events') {
      const body = req.postDataJSON(); requests.push(body.requestId);
      if (!events.length) events.push({ ...body, id: '8c2fc7c5-2f4f-49f3-b23a-456fce9eac4a', revision: 1, status: 'confirmed', confirmedBy: 'teacher', confirmedAt: body.observedAt });
      if (loseReply) { loseReply = false; return route.abort('failed'); }
      return respond({ id: events[0].id, revision: 1 });
    }
    if (path.endsWith('/revise')) { const body = req.postDataJSON(); Object.assign(events[0], { studentId: body.studentId, observation: body.observation, revision: 2 }); return respond({ id: events[0].id, revision: 2 }); }
    if (path.endsWith('/withdraw')) { events[0].status = 'withdrawn'; return respond({ ok: true }); }
    if (path === '/api/pulse/drafts') { if (req.method() === 'POST') { const { kind, sources } = req.postDataJSON(); drafted.push({ kind, sources }); } return respond(req.method() === 'GET' ? [] : { id: 'draft' }); }
    if (path === '/api/cases') return respond([]);
    return respond([]);
  });
  await page.goto('/e2e/pulse-ui.html');
  await expect(page.getByTestId('class-identity')).toContainText('Grade 6 · Science');
  await expect(page.getByTestId('session-ready')).toContainText('Ready to teach');
  await page.getByLabel('Lesson topic').fill('Fractions');
  await page.getByRole('button', { name: 'Start class', exact: true }).click();
  const student = page.getByRole('option', { name: /Robin Example.*No observations yet/ });
  await student.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Participated', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByText('Contributed', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  expect(requests).toHaveLength(2); expect(requests[0]).toBe(requests[1]); expect(events).toHaveLength(1);
  await expect(page.getByRole('option', { name: /Robin Example.*1 participation/ })).toBeVisible();
  await page.getByRole('button', { name: /More actions for Robin Example/ }).click();
  await page.getByRole('menuitem', { name: 'Correct' }).click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Student', exact: true }).selectOption('student-1');
  await page.getByLabel('Reason for correction').fill('Corrected selection');
  await page.getByRole('button', { name: 'Confirm correction', exact: true }).click();
  await expect(page.getByText('version 2', { exact: false })).toBeVisible();
  expect(events[0].studentId).toBe('student-1');
  await page.getByRole('radio', { name: /List/ }).click();
  await expect(page.getByRole('heading', { name: 'Class list' })).toBeVisible();
  await expectAccessible(page, 'class pulse');
  await page.screenshot({ path: `e2e/screenshots/pulsera-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Positive note', exact: true }).click();
  expect(drafted).toEqual([{ kind: 'positive_note', sources: [{ eventId: events[0].id, revision: 2 }] }]);
  await page.getByRole('link', { name: 'Open Drafts', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'You’re all caught up', exact: true })).toBeVisible();
});

test('Tomorrow Ready bundle and My Pulse render accessibly with their data', async ({ page }, testInfo) => {
  const draft = (kind: string, title: string, extra: Record<string, unknown> = {}) => ({ id: `${kind}-id`, kind, revision: 1, generationState: 'ready', reviewState: 'suggested', publicationState: 'unpublished', title, students: [], ...extra });
  const bundle = {
    section: { id: 'section', name: 'Grade 6 · Science', timezone: 'America/New_York' }, today: '2026-10-01', targetDate: '2026-10-02', schedule: { enabled: true, time: '15:30', lastResult: null },
    session: { id: 'session', date: '2026-10-01', topic: 'Fractions', objective: 'Compare fractions', confirmedCount: 6, needsPractice: 2 },
    instructional: [draft('do_now', 'Area model match', { preview: { kind: 'do_now', title: 'Area model match', sourceNumbers: [1], objective: 'Show two fractions are equal', instructions: ['Sketch two models', 'Compare the shaded parts'], checkForUnderstanding: 'Explain one step', limitations: 'Draft' } }), draft('small_group', 'Practice group', { students: [{ id: 'a', displayName: 'Robin Example' }, { id: 'b', displayName: 'Casey Sample' }] })],
    family: { drafts: [], candidates: [{ studentId: 'a', displayName: 'Robin Example', sources: [{ eventId: 'e', revision: 1 }], draftId: null }] },
    reminders: [{ id: 't', revision: 1, title: 'Check in with the reading group', action: 'Ask how the new routine went', dueDate: '2026-10-02', status: 'open', due: true, sourceChanged: false }],
    interventionReviews: { tasks: [], packets: [] },
  };
  const people = [{ id: 'a', displayName: 'Robin Example', sections: [{ id: 'section', name: 'Grade 6 · Science', teachers: [{ id: 'teacher', name: 'Ms. Taylor' }] }] }];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/pulse/sections') return route.fulfill({ json: [{ id: 'section', name: 'Grade 6 · Science', enabled: true }] });
    if (path === '/api/pulse/tomorrow/section/bundle') return route.fulfill({ json: bundle });
    if (path === '/api/pulse/people') return route.fulfill({ json: people });
    if (path.startsWith('/api/pulse/people/')) return route.fulfill({ json: { successes: [{ id: 's', title: 'Strong reasoning', message: 'Explained a worked example to a partner.', educator: 'Ms. Taylor', approvedAt: new Date().toISOString() }], updates: [], history: [], acceptedContributions: [], strategies: [{ id: 'st', kind: 'replacement', content: { description: 'Use the step card when starting independent work' } }], caseKeys: [], collection: { wellbeing: true }, memoryWindowDays: 120, coverageNote: '' } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/e2e/pulse-ui.html?route=/teacher/tomorrow');
  await expect(page.getByRole('heading', { name: /Ready for Friday/ })).toBeVisible();
  await expect(page.getByText('Area model match').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Draft note/ })).toBeVisible();
  await expectAccessible(page, 'tomorrow');
  await page.screenshot({ path: `e2e/screenshots/tomorrow-${testInfo.project.name}.png`, fullPage: true });
  await page.goto('/e2e/pulse-ui.html?route=/student');
  await expect(page.getByText('Strong reasoning')).toBeVisible();
  await expect(page.getByRole('button', { name: /This helps me/ })).toBeVisible();
  await expectAccessible(page, 'my pulse');
  await page.screenshot({ path: `e2e/screenshots/my-pulse-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
