import { test as base, expect, type Page } from '@playwright/test';

type Fixtures = {
  expectedConsoleErrors: RegExp[];
  auditPage: (page: Page) => void;
  consoleAudit: void;
};

export const test = base.extend<Fixtures>({
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
    async ({ auditPage }, provide) => {
      void auditPage;
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
