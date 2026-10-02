import type { Page } from '@playwright/test';
import { expect, test, type AccountKey } from './fixtures';

/**
 * Client-side navigation through the sidenav, as opposed to the screenshot sweep, which loads
 * every page fresh with `page.goto` and so never exercised the route transition. The transition
 * used to be an exit-then-enter cross-fade, and a page that mounted a `layoutId` element (the
 * segmented filter on Cases, the tabs on a case) while the previous page was still animating out
 * could leave the new page at opacity 0 until a reload. Playwright's `toBeVisible` treats an
 * opacity-0 element as visible, so this reads the computed opacity of the page wrapper as well.
 */
const WALKS: Array<{ as: AccountKey; home: string; links: Array<{ name: RegExp; expectText: string | RegExp }> }> = [
  {
    as: 'teacher',
    home: '/teacher',
    links: [
      // Class Pulse is the home page; case work (Cases, Patterns, Reviews, Family requests) is
      // reached from Support work.
      { name: /^Support work$/, expectText: /Good (morning|afternoon|evening)/ },
      { name: /^Cases/, expectText: 'One case per student' },
      { name: /^Classes$/, expectText: 'My Classes' },
      { name: /^Students$/, expectText: 'Strengths first' },
      { name: /^Drafts/, expectText: 'Pulsera prepares the paperwork' },
      { name: /^Tomorrow/, expectText: 'Tomorrow Ready' },
      { name: /^Families$/, expectText: 'Who is connected at home' },
      { name: /^Reports$/, expectText: 'Evidence packets drafted' },
      { name: /^Settings$/, expectText: 'Quick-pick wording' },
      { name: /^Support work$/, expectText: /Good (morning|afternoon|evening)/ },
      { name: /^Patterns/, expectText: 'Pattern queue' },
      { name: /^Support work$/, expectText: /Good (morning|afternoon|evening)/ },
      { name: /^Reviews/, expectText: 'Plan reviews' },
      { name: /^Support work$/, expectText: /Good (morning|afternoon|evening)/ },
      { name: /^Family requests/, expectText: 'Family requests' },
      { name: /^Class Pulse$/, expectText: /Seating chart/ },
      { name: /^Support work$/, expectText: /Good (morning|afternoon|evening)/ },
    ],
  },
  {
    as: 'admin',
    home: '/admin',
    links: [
      { name: /^Pattern catalog/, expectText: 'Pattern catalog' },
      { name: /^Equity/, expectText: 'Equity monitoring' },
      { name: /^Prompts & evals/, expectText: 'Prompts & evals' },
      { name: /^People & access/, expectText: 'People & access' },
      { name: /^School structure/, expectText: 'School structure' },
      { name: /^Audit log/, expectText: 'Audit log' },
      { name: /^Overview/, expectText: 'Active cases' },
    ],
  },
];

const pageOpacity = (page: Page) =>
  page.evaluate(() => {
    const wrapper = document.querySelector('main > div:last-child');
    return wrapper ? getComputedStyle(wrapper).opacity : 'no wrapper';
  });

for (const walk of WALKS) {
  test(`sidenav renders every page (${walk.as})`, async ({ page, signInAs }) => {
    await signInAs(walk.as);
    await expect(page.getByRole('navigation').first()).toBeVisible();
    for (const link of walk.links) {
      await page.getByRole('link', { name: link.name }).first().click();
      await expect(page.getByText(link.expectText).first()).toBeVisible();
      await expect.poll(() => pageOpacity(page), { message: `page wrapper after clicking ${link.name}` }).toBe('1');
    }
  });
}
