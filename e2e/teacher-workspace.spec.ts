import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/*
 * The teacher workspace from the Pulsera visual/UX spec, rendered in the isolated harness with the
 * real teacher shell and a synthetic, intercepted API. Each test asserts what the spec requires
 * and leaves a screenshot per viewport in e2e/screenshots/workspace/.
 */

async function expectAccessible(page: Page, where: string) {
  // Scan settled pixels: a control that has just become enabled is still fading in for ~150 ms.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('[data-sonner-toaster]').analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.flatMap((v) => v.nodes.map((n) => `${where}: ${v.id} ${n.target.join(' ')} ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 180)}`))).toEqual([]);
}
const settled = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
const shot = async (page: Page, name: string, project: string) => {
  await settled(page);
  await page.screenshot({ path: `e2e/screenshots/workspace/${name}-${project}.png`, fullPage: true });
  // Phones also get what the teacher actually sees: one screen, with the capture panel and tab bar in place.
  if (project === 'phone') await page.screenshot({ path: `e2e/screenshots/workspace/${name}-${project}-screen.png` });
};
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

const TZ = 'America/New_York';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const NAMES = ['Avery Fixture', 'Robin Example', 'Casey Sample', 'Jordan Test', 'Morgan Synthetic', 'Riley Placeholder', 'Quinn Demo', 'Sasha Mock', 'Taylor Stub', 'Jules Fixture', 'Mika Sample', 'Rowan Example'];

function world() {
  const now = new Date().toISOString();
  const sections = [
    { id: 'sec-sci', name: 'Grade 6 — Period 3 Science', courseName: 'Science 6', gradeLevel: '6', periodTag: 'period_3', room: '114', accent: 'teal', schoolId: 'school', archivedAt: null as string | null, updatedAt: '2026-10-01T12:00:00.000Z', teachers: [{ id: 't', name: 'Morgan Taylor' }], today: { status: 'in_progress', sessionId: 'c7a6c38a-5eb2-448b-b648-0f41bde1c3c1', observations: 7 } },
    { id: 'sec-ela', name: 'Grade 7 — Period 2 ELA', courseName: 'English Language Arts 7', gradeLevel: '7', periodTag: 'period_2', room: '204', accent: 'violet', schoolId: 'school', archivedAt: null as string | null, updatedAt: '2026-10-01T12:00:00.000Z', teachers: [{ id: 't', name: 'Morgan Taylor' }], today: { status: 'not_started', sessionId: null, observations: 0 } },
  ];
  const students = NAMES.map((displayName, i) => ({ id: `s${i}`, displayName, firstName: displayName.split(' ')[0]!, lastName: displayName.split(' ')[1]!, gradeLevel: i < 8 ? '6' : '7', sectionIds: [i < 8 ? 'sec-sci' : 'sec-ela', ...(i === 7 ? ['sec-ela'] : [])] }));
  const session = { id: 'c7a6c38a-5eb2-448b-b648-0f41bde1c3c1', date: today, topic: 'Ecosystems and food webs', objective: 'Trace energy through a food web', timezone: TZ, contextTags: ['period_3'], endedAt: null as string | null };
  const ev = (i: number, studentId: string, observation: object, status = 'confirmed') => ({ id: `e${i}`, revision: 1, status, studentId, observation, observedAt: new Date(Date.now() - (20 - i) * 60_000).toISOString(), confirmedAt: now, confirmedBy: 't', source: 'teacher_tap' });
  const events = [
    ev(1, 's0', { kind: 'participation', action: 'contributed', note: '' }),
    ev(2, 's0', { kind: 'praise', strength: 'Explained their reasoning clearly', note: '' }),
    ev(3, 's1', { kind: 'understanding', concept: 'Food webs', evidence: 'demonstrated', note: '' }),
    ev(4, 's2', { kind: 'understanding', concept: 'Food webs', evidence: 'needs_practice', note: '' }),
    ev(5, 's3', { kind: 'understanding', concept: 'Food webs', evidence: 'needs_practice', note: '' }),
    ev(6, 's4', { kind: 'check_in', observation: 'Asked for a quieter spot to work', note: '' }),
    ev(7, 's5', { kind: 'note', note: 'Finished the diagram early and helped a partner' }, 'pending'),
  ];
  const d = (id: string, kind: string, extra: object = {}) => ({ id, sessionId: session.id, sectionId: 'sec-sci', kind, revision: 1, sources: [{ eventId: 'e2', revision: 1 }], generationState: 'ready', reviewState: 'suggested', publicationState: 'unpublished', deferredUntil: null, error: null, promptVersionId: 'classroom.v3', runId: null, createdAt: now, expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(), title: null, students: [{ id: 's0', displayName: 'Avery Fixture' }], evidenceKinds: ['praise'], ...extra });
  const drafts = [
    d('d1', 'positive_note', { title: 'Clear reasoning in the food-web discussion' }),
    d('d2', 'parent_message', { title: 'A great day in science', reviewState: 'approved', publicationState: 'logged', approvedAudience: 'family' }),
    d('d3', 'do_now', { title: 'Who eats whom?', students: [], evidenceKinds: ['understanding'] }),
    d('d4', 'abc', { title: 'Observation during group work', students: [{ id: 's4', displayName: 'Morgan Synthetic' }], evidenceKinds: ['behavior'], reviewState: 'stale' }),
    d('d5', 'sst_report', { title: 'Evidence for the support team', students: [{ id: 's2', displayName: 'Casey Sample' }], evidenceKinds: ['understanding'] }),
  ];
  return { sections, students, session, events, drafts, calls: [] as Array<{ method: string; path: string; body: any }> };
}
type World = ReturnType<typeof world>;

async function mockApi(page: Page, w: World) {
  await page.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    if (method !== 'GET') w.calls.push({ method, path, body });
    const respond = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/pulse/sections') return respond(w.sections.map((s) => ({ ...s, archived: !!s.archivedAt, timezone: TZ, enabled: true })));
    if (path === '/api/classroom') return respond({ schools: [{ id: 'school', name: 'Synthetic Middle School' }], sections: w.sections, students: w.students, access: [{ id: 'a1', email: 'family@example.test', role: 'guardian', studentId: 's0', status: 'accepted', createdAt: new Date().toISOString(), acceptedAt: new Date().toISOString(), invitedByMe: true }] });
    const patch = /^\/api\/classroom\/sections\/([^/]+)$/.exec(path);
    if (patch && method === 'PATCH') { const s = w.sections.find((x) => x.id === patch[1])!; Object.assign(s, body, { updatedAt: new Date().toISOString() }); return respond({ ...s, period: s.periodTag }); }
    const archive = /^\/api\/classroom\/sections\/([^/]+)\/archive$/.exec(path);
    if (archive) { const s = w.sections.find((x) => x.id === archive[1])!; s.archivedAt = body.archived ? new Date().toISOString() : null; return respond(s); }
    const remove = /^\/api\/classroom\/sections\/([^/]+)\/students\/([^/]+)$/.exec(path);
    if (remove && method === 'DELETE') { const st = w.students.find((x) => x.id === remove[2])!; st.sectionIds = st.sectionIds.filter((x) => x !== remove[1]); return respond({ ok: true }); }
    if (path === '/api/classroom/sections' && method === 'POST') { const id = `sec-${w.sections.length}`; w.sections.push({ ...w.sections[1]!, ...body, id, today: { status: 'not_started', sessionId: null, observations: 0 } }); (body.students ?? []).forEach((p: { firstName: string; lastName: string }, i: number) => w.students.push({ id: `${id}-s${i}`, displayName: `${p.firstName} ${p.lastName}`, firstName: p.firstName, lastName: p.lastName, gradeLevel: body.gradeLevel, sectionIds: [id] })); return respond({ id, schoolId: 'school', students: body.students?.length ?? 0 }); }
    if (path === '/api/classroom/students' && method === 'POST') { w.students.push({ id: `new${w.students.length}`, displayName: `${body.firstName} ${body.lastName}`, firstName: body.firstName, lastName: body.lastName, gradeLevel: '6', sectionIds: [body.sectionId] }); return respond({ id: 'new', gradeLevel: '6' }); }
    if (path === '/api/pulse/seating') return respond({ version: 1, positions: w.students.filter((s) => s.sectionIds.includes('sec-sci')).map((s, i) => ({ studentId: s.id, row: Math.floor(i / 4), column: i % 4 })) });
    if (path === '/api/pulse/sessions' && method === 'GET') return respond(url.searchParams.get('sectionId') === 'sec-sci' ? [w.session] : []);
    if (path === `/api/pulse/sessions/${w.session.id}`) return respond({ session: w.session, seating: [], events: w.events });
    if (path === `/api/pulse/sessions/${w.session.id}/end`) { w.session.endedAt = body.ended ? new Date().toISOString() : null; return respond({ id: w.session.id, endedAt: w.session.endedAt }); }
    if (path === '/api/pulse/events' && method === 'POST') { w.events.push({ ...body, id: `e${w.events.length + 1}`, revision: 1, status: 'confirmed', confirmedAt: body.observedAt, confirmedBy: 't' }); return respond({ id: `e${w.events.length}`, revision: 1 }); }
    if (path === '/api/pulse/drafts' && method === 'GET') return respond(w.drafts);
    if (path === '/api/pulse/drafts' && method === 'POST') return respond({ id: 'requested' });
    const draft = /^\/api\/pulse\/drafts\/([^/]+)$/.exec(path);
    if (draft) {
      const row = w.drafts.find((x) => x.id === draft[1])!;
      return respond({ draft: row, revisions: [{ revision: 1, createdBy: 'ai', createdAt: row.createdAt, content: { kind: row.kind, title: row.title, message: 'Avery explained how energy moves from producers to consumers and helped the table reach a shared answer.', sourceNumbers: [1] } }], evidence: [{ number: 1, observation: { kind: 'praise', strength: 'Explained their reasoning clearly', note: '' } }], publications: [], sourceContext: [{ number: 1, studentId: 's0', firstName: 'Avery', lastName: 'Fixture', observedAt: row.createdAt, source: 'teacher_tap', confirmedBy: 't' }] });
    }
    if (path === '/api/pulse/vocabulary') return respond({ vocabulary: { praise: ['Explained their reasoning', 'Helped a classmate', 'Kept trying'], checkIn: ['Seemed tired', 'Asked for help'] }, defaults: { praise: [], checkIn: [] }, custom: false });
    if (path.startsWith('/api/pulse/voice/status')) return respond({ enabled: false, reason: 'Voice needs a recorded school approval first.' });
    if (path === '/api/pulse/contributions') return respond([{ id: 'c1', revision: 1, studentId: 's1', own: false, sourceRole: 'guardian', authorName: 'Robin’s family', status: 'pending', content: { kind: 'home_strategy', strategy: 'Practised explaining a diagram at dinner', outcome: 'Explained it without notes' }, response: null, respondedAt: null, createdAt: new Date().toISOString() }]);
    if (path.startsWith('/api/pulse/tomorrow/')) return respond({ settings: { enabled: true, time: '15:30', classWeekdays: [1, 2, 3, 4, 5], closureDates: [] }, timezone: TZ, lastResult: null, targetDate: null });
    if (path === '/auth/me' || path.startsWith('/auth/')) return respond({ authenticated: true, provisioned: true, posture: 'demonstration', modelEnabled: true, user: { id: 't', email: 'teacher@example.test', displayName: 'Morgan Taylor' }, roles: ['teacher'] });
    return respond([]);
  });
  await page.route('**/auth/me', (route) => route.fulfill({ json: { authenticated: true, provisioned: true, posture: 'demonstration', modelEnabled: true, user: { id: 't', email: 'teacher@example.test', displayName: 'Morgan Taylor' }, roles: ['teacher'] } }));
}

test('Class Pulse is the teacher home: class identity, session status, seating chart, one-tap capture', async ({ page }, info) => {
  const w = world();
  await mockApi(page, w);
  await page.goto('/e2e/pulse-ui.html?route=/teacher');
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), Morgan$/ })).toBeVisible();
  // With no class chosen yet, the earliest period opens; the top bar switches class.
  await expect(page.getByTestId('class-identity')).toContainText('English Language Arts 7');
  await expect(page.getByTestId('session-ready')).toContainText('Ready to teach');
  await page.getByTestId('class-selector').click();
  await page.getByRole('menuitem', { name: /Science 6/ }).click();
  await expect(page.getByTestId('class-identity')).toContainText('Science 6');
  await expect(page.getByTestId('class-identity')).toContainText('Room 114');
  await expect(page.getByTestId('class-selector')).toContainText('Science 6');
  await expect(page.getByTestId('session-live')).toContainText('Class in progress');
  await expect(page.getByTestId('topbar-drafts')).toHaveAccessibleName('4 drafts to review');
  await expect(page.getByTestId('draft-tray')).toContainText('4 drafts ready for review');
  await expect(page.getByTestId('draft-tray')).toContainText('1 needs review');
  await expect(page.getByTestId('tomorrow-preview')).toContainText('Who eats whom?');
  // Tiles are neutral and say when there is no data.
  await expect(page.getByTestId('seat-s6')).toContainText('No observations yet today');
  await page.getByTestId('seat-s6').click();
  await page.getByRole('button', { name: 'Participated', exact: true }).click();
  await expect.poll(() => w.calls.find((c) => c.path === '/api/pulse/events')?.body).toMatchObject({ studentId: 's6', observation: { kind: 'participation' }, source: 'teacher_tap', confirmed: true });
  await expectAccessible(page, 'class pulse');
  await shot(page, 'class-pulse', info.project.name);
  await noSideScroll(page);

  await page.getByTestId('ask-guide').click();
  const guide = page.getByRole('dialog', { name: /Pulsera Guide/ });
  await expect(guide.getByRole('button', { name: /Suggest an instructional adjustment/ })).toBeEnabled();
  await expect(guide.getByRole('button', { name: /Suggest a small group · Food webs/ })).toBeEnabled();
  await guide.getByRole('button', { name: /Suggest an instructional adjustment/ }).click();
  await expect.poll(() => w.calls.find((c) => c.path === '/api/pulse/drafts')?.body.kind).toBe('guide_adjust');
  await shot(page, 'guide', info.project.name);
  await page.keyboard.press('Escape');

  await page.getByTestId('end-class').click();
  await expect(page.getByTestId('session-complete')).toContainText('Session complete');
  await expect(page.getByRole('button', { name: 'Resume class' })).toBeVisible();
});

test('My Classes: edit a class in place, archive it, and add a class with students', async ({ page }, info) => {
  const w = world();
  await mockApi(page, w);
  await page.goto('/e2e/pulse-ui.html?route=/teacher/classes');
  await expect(page.getByRole('heading', { name: 'My Classes' })).toBeVisible();
  const card = page.getByTestId('class-card-sec-sci');
  await expect(card).toContainText('Science 6');
  await expect(card).toContainText('Period 3 · Room 114');
  await expect(card).toContainText('8 students');
  await expect(card).toContainText('Class in progress');
  await expectAccessible(page, 'my classes');
  await shot(page, 'classes', info.project.name);
  await noSideScroll(page);

  await page.getByTestId('class-menu-sec-sci').click();
  await expect(page.getByRole('menuitem')).toHaveText(['Edit Class', 'Manage Students', 'Seating Chart', 'Archive']);
  await page.getByRole('menuitem', { name: 'Edit Class' }).click();
  const save = page.getByTestId('save-class');
  await expect(page.getByTestId('section-name')).toHaveValue('Grade 6 — Period 3 Science');
  await expect(save).toBeDisabled();
  await page.getByTestId('section-name').fill('');
  await expect(page.getByText('Give the class a name')).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByTestId('section-name').fill('6 Science - Section 2');
  await page.getByTestId('class-room').fill('118');
  await expectAccessible(page, 'edit class');
  await shot(page, 'edit-class', info.project.name);
  await save.click();
  await expect(page.getByText('Class updated.')).toBeVisible();
  expect(w.calls.find((c) => c.method === 'PATCH')).toEqual({ method: 'PATCH', path: '/api/classroom/sections/sec-sci', body: { name: '6 Science - Section 2', room: '118', expectedUpdatedAt: '2026-10-01T12:00:00.000Z' } });
  await expect(card).toContainText('6 Science - Section 2 · Period 3 · Room 118');

  await page.getByTestId('class-menu-sec-ela').click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByTestId('confirm-archive').click();
  await expect(page.getByText('Class archived.')).toBeVisible();
  expect(w.calls.find((c) => c.path.endsWith('/archive'))?.body).toEqual({ archived: true });
  await expect(page.getByRole('button', { name: /Archived \(1\)/ })).toBeVisible();

  await page.getByTestId('add-class').click();
  await page.getByTestId('class-course').fill('Math 6');
  await page.getByTestId('section-name').fill('6 Math - Section 1');
  await page.getByTestId('section-grade').fill('6');
  await page.getByTestId('add-class-next').click();
  await page.getByTestId('new-student-first').fill('Lane');
  await page.getByTestId('new-student-last').fill('Fixture');
  await page.getByTestId('new-student-add').click();
  await expect(page.getByRole('list', { name: 'Students to add' })).toContainText('Lane Fixture');
  await shot(page, 'add-class-students', info.project.name);
  await page.getByTestId('add-class-next').click();
  await expect(page.getByRole('dialog')).toContainText('1 student');
  await page.getByTestId('add-class-create').click();
  await expect(page.getByText('Class created')).toBeVisible();
  expect(w.calls.find((c) => c.path === '/api/classroom/sections')?.body).toMatchObject({ name: '6 Math - Section 1', courseName: 'Math 6', gradeLevel: '6', periodTag: null, students: [{ firstName: 'Lane', lastName: 'Fixture' }] });
});

test('Manage Students adds and removes students without touching class details', async ({ page }, info) => {
  const w = world();
  await mockApi(page, w);
  await page.goto('/e2e/pulse-ui.html?route=/teacher/classes/sec-sci/students');
  await expect(page.getByRole('heading', { name: 'Manage Students' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Roster' }).getByRole('listitem')).toHaveCount(8);
  await page.getByRole('button', { name: 'More for Quinn Demo' }).click();
  await page.getByRole('menuitem', { name: 'Remove from this class' }).click();
  await expect(page.getByRole('dialog')).toContainText('observations, drafts, approvals and support records are kept');
  await page.getByTestId('confirm-remove').click();
  await expect(page.getByText('Quinn Demo removed from this class')).toBeVisible();
  expect(w.calls.find((c) => c.method === 'DELETE')?.path).toBe('/api/classroom/sections/sec-sci/students/s6');
  await expect(page.getByRole('list', { name: 'Roster' }).getByRole('listitem')).toHaveCount(7);
  await page.getByTestId('add-student').click();
  await page.getByTestId('student-first').fill('Lane');
  await page.getByTestId('student-last').fill('Fixture');
  await page.getByTestId('save-student').click();
  await expect(page.getByText('Lane Fixture added')).toBeVisible();
  expect(w.calls.find((c) => c.path === '/api/classroom/students')?.body).toMatchObject({ sectionId: 'sec-sci', firstName: 'Lane', lastName: 'Fixture' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Roster' }).getByRole('listitem')).toHaveCount(8);
  expect(w.calls.some((c) => c.method === 'PATCH')).toBe(false);
  await expectAccessible(page, 'manage students');
  await shot(page, 'manage-students', info.project.name);
  await noSideScroll(page);
});

test('Drafts, Families, Reports and Settings share the same calm language', async ({ page }, info) => {
  const w = world();
  await mockApi(page, w);
  await page.goto('/e2e/pulse-ui.html?route=/teacher/drafts');
  await expect(page.getByRole('heading', { name: '4 drafts need your review' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Draft categories' }).getByRole('tab')).toHaveText([/^All/, /^Documentation/, /^Instruction/, /^Family/, /^Tomorrow/, /^Intervention/]);
  await expectAccessible(page, 'drafts');
  await shot(page, 'drafts', info.project.name);
  await noSideScroll(page);
  await page.getByRole('button', { name: /^Review Positive note/ }).click();
  await expect(page.getByText('Why did Pulsera suggest this?')).toBeVisible();
  await expect(page.getByRole('button', { name: /Approve version 1/ })).toBeVisible();
  await shot(page, 'draft-review-panel', info.project.name);
  await page.keyboard.press('Escape');

  for (const [route, heading, name] of [['/teacher/families', 'Families', 'families'], ['/teacher/reports', 'Reports', 'reports'], ['/teacher/settings', 'Settings', 'settings']] as const) {
    await page.goto(`/e2e/pulse-ui.html?route=${route}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expectAccessible(page, name);
    await shot(page, name, info.project.name);
    await noSideScroll(page);
  }
});

test('dark mode keeps the same hierarchy and contrast', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough for the theme check');
  const w = world();
  await mockApi(page, w);
  await page.goto(`/e2e/pulse-ui.html?route=${encodeURIComponent('/teacher?class=sec-sci')}&theme=dark`);
  await expect(page.getByTestId('session-live')).toBeVisible();
  await expectAccessible(page, 'class pulse dark');
  await shot(page, 'class-pulse-dark', info.project.name);
});

test('install and update controls work in the desktop sidebar and mobile menu', async ({ page }, info) => {
  await mockApi(page, world());
  await page.goto('/e2e/pulse-ui.html?route=/teacher');
  await expect(page.getByTestId('class-identity')).toBeVisible();
  if (info.project.name !== 'desktop') await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Install Pulsera' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Install Pulsera' }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.route('**/version.json?*', (route) => route.fulfill({ json: { version: 'release-two' } }));
  await page.evaluate(async () => {
    const modulePath = '/apps/web/src/lib/pwa.ts';
    await (await import(modulePath)).checkForUpdates('release-one', false);
  });
  const area = info.project.name === 'desktop' ? page.locator('aside') : page.getByRole('dialog');
  await expect(area.getByRole('button', { name: 'Update available — Reload' })).toBeVisible();
  await noSideScroll(page);
  await shot(page, 'pwa-controls', info.project.name);
  if (info.project.name !== 'desktop') {
    await area.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('main').getByRole('button', { name: 'Update available — Reload' })).toBeVisible();
  }
});
