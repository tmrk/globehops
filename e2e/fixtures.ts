import { test as base, expect, type Page } from '@playwright/test';

type Fixtures = {
  localeChoice: string | null;
  expectedConsoleErrors: RegExp[];
  auditPage: (page: Page) => void;
  consoleAudit: void;
};

export const test = base.extend<Fixtures>({
  localeChoice: ['en', { option: true }],
  expectedConsoleErrors: [[], { option: true }],
  auditPage: async ({ context, expectedConsoleErrors }, provide) => {
    const errors: string[] = [];
    const expected: string[] = [];
    const seen = new WeakSet<Page>();
    const audit = (page: Page) => {
      if (seen.has(page)) return;
      seen.add(page);
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const value = message.text();
        if (expectedConsoleErrors.some((pattern) => pattern.test(value))) expected.push(value);
        else errors.push(`console: ${value}`);
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    };
    context.pages().forEach(audit);
    context.on('page', audit);
    await provide(audit);
    context.off('page', audit);
    expect(errors, 'No unexpected console errors or uncaught exceptions').toEqual([]);
    // Only the deliberately disabled-WebGL test allows errors, and it must observe them.
    for (const pattern of expectedConsoleErrors) {
      expect(
        expected.some((value) => pattern.test(value)),
        `Expected diagnostic: ${pattern}`,
      ).toBe(true);
    }
  },
  consoleAudit: [
    async ({ auditPage, context, localeChoice }, provide) => {
      void auditPage;
      // Keep existing English assertions independent of the host's country/time zone.
      if (localeChoice !== null)
        await context.addInitScript((choice) => {
          // addInitScript also runs in the initial, storage-inaccessible about:blank document.
          if (location.protocol === 'http:' || location.protocol === 'https:') {
            localStorage.setItem('globehops:locale', choice);
          }
        }, localeChoice);
      await provide();
    },
    { auto: true },
  ],
});

export { expect };

export const stopButtons = (page: Page) =>
  page.getByRole('list', { name: 'Journey stops' }).getByRole('button', { name: /\. Change airport$/ });

export async function expectRoute(page: Page, codes: string[]) {
  const stops = stopButtons(page);
  await expect(stops).toHaveCount(codes.length);
  for (const [i, code] of codes.entries()) await expect(stops.nth(i)).toHaveAccessibleName(new RegExp(`\\(${code}\\)`));
  await expect(page).toHaveURL(new RegExp(`/globehops/\\?route=${codes.join('-')}$`));
}

/**
 * Without a route, phones open on the globe and its clock with the planner one tap away; this opens it.
 * Elsewhere (desktop, or a sheet that is already open) it only waits for the planner.
 */
export async function openPlanner(page: Page) {
  const start = page.getByRole('button', { name: 'Show a flight', exact: true });
  const from = page.getByRole('button', { name: 'Departure airport: choose an airport' });
  await expect(start.or(from).first()).toBeVisible();
  if (await start.isVisible()) await start.click();
  await expect(from).toBeVisible();
}

/** The play launcher: the journey's player before it starts (beneath the globe, or atop the phone sheet). */
export const launcher = (page: Page) => page.getByRole('region', { name: 'Playback', exact: true });

/** Opens the globe's display menu (map layers, distance unit, globe time) unless it is open. */
export async function openDisplay(page: Page) {
  const button = page.getByRole('button', { name: 'Display options' });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  return page.getByRole('group', { name: 'Display options' });
}

/** Switches the journey panel to edit mode (reorder, remove, insert, reverse and clear). */
export async function startEditing(page: Page) {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveAttribute('aria-pressed', 'true');
}

/** The airport search field (layover menus are comboboxes too). */
export const airportField = (page: Page) => page.getByRole('combobox', { name: /airport$|^Stop \d+$/ });

export async function chooseAirport(page: Page, query: string, code: string) {
  await airportField(page).fill(query);
  await page
    .getByRole('listbox', { name: 'Airport suggestions' })
    .getByRole('option', { name: new RegExp(`^${code}\\b`) })
    .click();
}
