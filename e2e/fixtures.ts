import { test as base, expect, type Page } from '@playwright/test';

/** The app's path: the root locally, or the path of an external `E2E_BASE_URL` deployment. */
export const basePath = new URL(process.env.E2E_BASE_URL ?? 'http://localhost/').pathname;
/** Matches exactly the app address `rest` (a path below the base plus query), on any origin. */
export const atApp = (rest: string) =>
  new RegExp(`^[a-z]+://[^/]+${(basePath + rest).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

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
  await expect(page).toHaveURL(atApp(`?route=${codes.join('-')}`));
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

/** Cinematic playback shows a mini player; this brings back the full timeline (scrubber, menus, lanes). */
export async function showControls(page: Page) {
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
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

export type PlaceKind = 'country' | 'ocean' | 'sea';
export interface PlaceName {
  kind: PlaceKind;
  name: string;
  opacity: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The place names the globe drew in its last frame (they are drawn into the canvas, not the page). */
export async function placeNames(page: Page, ...kinds: PlaceKind[]): Promise<PlaceName[]> {
  const names = await page
    .locator('.globe-view')
    .evaluate((el) => (el as HTMLElement & { placeNames?: PlaceName[] }).placeNames ?? []);
  return kinds.length ? names.filter((name) => kinds.includes(name.kind)) : names;
}

/** Waits until a drawn place name of `kind` matches `name`. */
export async function expectPlaceName(page: Page, kind: PlaceKind, name: string | RegExp) {
  await expect
    .poll(async () =>
      (await placeNames(page, kind)).some((place) =>
        typeof name === 'string' ? place.name.includes(name) : name.test(place.name),
      ),
    )
    .toBe(true);
}

/** Drawn place names that overlap each other or a visible airport label or dot. */
export async function placeNameOverlaps(page: Page): Promise<string[]> {
  return page.locator('.globe-view').evaluate((globe) => {
    const origin = globe.getBoundingClientRect();
    const names = ((globe as HTMLElement & { placeNames?: PlaceName[] }).placeNames ?? []).map((place) => ({
      name: place.name,
      rect: {
        left: origin.left + place.x0,
        right: origin.left + place.x1,
        top: origin.top + place.y0,
        bottom: origin.top + place.y1,
      },
    }));
    const airports = [...document.querySelectorAll('.globe-marker')]
      .filter((el) => getComputedStyle(el).visibility !== 'hidden')
      .flatMap((el) => [...el.querySelectorAll('.globe-marker__label, .globe-marker__dot')])
      .map((el) => ({ name: el.textContent || 'airport dot', rect: el.getBoundingClientRect() }));
    const result: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const a = names[i];
      for (const b of [...names.slice(i + 1), ...airports]) {
        if (
          a.rect.left < b.rect.right &&
          a.rect.right > b.rect.left &&
          a.rect.top < b.rect.bottom &&
          a.rect.bottom > b.rect.top
        )
          result.push(`${a.name} / ${b.name}`);
      }
    }
    return result;
  });
}
