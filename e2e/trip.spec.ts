import type { Page } from '@playwright/test';
import { test, expect, stopButtons, openDisplay, startEditing } from './fixtures.ts';

// Copenhagen to Nairobi via Amsterdam on 15 November, five days there, home via Paris on 20–21 November.
const nairobi =
  '?route=CPH-AMS-NBO&dep1=2026-11-15T07:00&arr2=2026-11-15T08:20&dep2=2026-11-15T10:20&arr3=2026-11-15T20:55' +
  '&2.route=NBO-CDG-CPH&2.dep1=2026-11-20T23:55&2.arr2=2026-11-21T06:50&2.dep2=2026-11-21T09:30&2.arr3=2026-11-21T11:25';
const bar = (page: Page) => page.getByRole('region', { name: 'Timeline', exact: true });
const overview = (page: Page) => page.getByRole('region', { name: 'Trip overview' });

test.beforeEach(async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
});

test('adds a return flight as a trip, with tabs, an explicit stay and a shareable link', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-AMS-NBO');
  // One-way journeys look as before: no tabs, only the quiet actions under the stops.
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add return flight' }).click();
  await expect(page.getByRole('heading', { name: 'Your trip' })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Trip journeys' }).getByRole('tab');
  await expect(tabs).toHaveText(['1Outbound', '2Return']);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  // The return goes from the destination home, with its own connections still to choose.
  await expect(stopButtons(page)).toHaveCount(2);
  await expect(stopButtons(page).nth(0)).toHaveAccessibleName(/\(NBO\)/);
  await expect(stopButtons(page).nth(1)).toHaveAccessibleName(/\(CPH\)/);
  // A trip is compared with other trips of the same journeys, never journey by journey with itself.
  await expect(page.getByRole('button', { name: 'Compare journeys' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compare trips' })).toBeVisible();
  await expect(overview(page)).toContainText('≈ 7 days in Nairobi');
  await expect(page).toHaveURL(/\?route=CPH-AMS-NBO&2\.route=NBO-CPH$/);
  // An untimed stay can be chosen like a layover; it travels in the link.
  await overview(page)
    .getByRole('combobox', { name: 'Stay in Nairobi' })
    .selectOption(String(3 * 1440));
  await expect(page).toHaveURL(/2\.stay=3d/);
  // Journeys can be named in edit mode.
  await startEditing(page);
  await page.getByRole('textbox', { name: 'Name of this journey' }).fill('Home');
  await expect(tabs.nth(1)).toHaveText('2Home');
  await expect(page).toHaveURL(/2\.label=Home/);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: `test-results/trip-return-${info.project.name}.png`, animations: 'disabled' });
  // Removing a journey leaves a one-way journey again.
  await page.getByRole('button', { name: 'Remove this journey' }).click();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page).toHaveURL(/\?route=CPH-AMS-NBO$/);
});

test('shows a five-day stay, never a layover, and plays the trip across it', async ({ page }, info) => {
  await page.goto(`./${nairobi}&t=2026-11-18T12:00Z`);
  await expect(overview(page)).toContainText('5 days in Nairobi');
  await expect(overview(page)).toContainText(/15\s–\s20 Nov/);
  // The stay belongs between journeys: the outbound keeps only its own connection.
  await expect(page.getByRole('list', { name: 'Journey stops' }).getByText(/layover/)).toHaveCount(1);
  await expect(bar(page)).toContainText('Staying in Nairobi');
  await expect(bar(page).locator('.time-bar__break-label')).toHaveText('5 days');
  await page.screenshot({ path: `test-results/trip-stay-${info.project.name}.png`, animations: 'disabled' });
  // Just after landing in Nairobi, playback lingers briefly, then skips the stay to the return's departure.
  await page.goto(`./${nairobi}&t=2026-11-15T18:10Z`);
  await expect(bar(page)).toContainText('Staying in Nairobi');
  await bar(page).getByRole('button', { name: 'Play trip' }).click();
  await expect(bar(page)).toContainText(/Return · /, { timeout: 30_000 });
  await expect(bar(page).locator('.time-bar__readout')).toContainText(/2[01] Nov/);
});

test('plays one journey of a trip on its own', async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`./${nairobi}`);
  await bar(page).getByRole('button', { name: 'Close timeline' }).click();
  await overview(page)
    .getByRole('button', { name: /^2 Return/ })
    .click();
  await overview(page).getByRole('button', { name: 'Play Return only' }).click();
  await expect(bar(page).getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await expect(bar(page)).toContainText(/Return · /);
  // The whole trip is one button away (on phones, playback lowers the sheet first).
  if (isMobile) await page.getByRole('button', { name: 'Show journey details' }).click();
  await expect(overview(page).getByRole('button', { name: 'Play trip' })).toBeVisible();
});

test('switches diversion-aware routing in the display menu and remembers it', async ({ page }) => {
  await page.goto('./?route=JNB-PER');
  const menu = await openDisplay(page);
  const toggle = menu.getByRole('button', { name: 'Diversion-aware routing' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // A southern Indian Ocean crossing keeps within reach of diversion airports.
  await expect(page.getByText(/Kept within reach of diversion airports: \+[\d,]+\skm/)).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText(/Kept within reach of diversion airports/)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('globehops:diversionRouting'))).toBe('off');
});
