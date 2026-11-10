import { fileURLToPath } from 'node:url';
import { test, expect, launcher, openPlanner, stopButtons } from './fixtures.ts';

const recorded = fileURLToPath(new URL('./data/recorded-lhr-jfk.gpx', import.meta.url));
const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Import a flight path' });

test('imports a recorded GPX track, plays it with its own times and shares it in the link', async ({ page }, info) => {
  await page.goto('./');
  await openPlanner(page);
  await page.getByRole('button', { name: /^Import a flight path/ }).click();
  await dialog(page).locator('input[type=file]').setInputFiles(recorded);
  const flights = dialog(page).getByRole('list', { name: 'Flights found' });
  await expect(flights).toContainText('LHR → JFK');
  await expect(flights).toContainText('Recorded path');
  await expect(flights).toContainText('114 points');
  await page.screenshot({ path: `test-results/import-preview-${info.project.name}.png`, animations: 'disabled' });
  await dialog(page).getByRole('button', { name: 'Show on the globe', exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  // The recording's own times become the flight's, and its path travels in the link.
  await expect(stopButtons(page)).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Journey stops' })).toContainText(/11:22\s*→\s*13:54/);
  await expect(page.getByRole('region', { name: 'Journey totals' })).toContainText(/Recorded path · Sample LHR-JFK/);
  await expect(page).toHaveURL(/[?&]route=LHR-JFK&trk1=1r/);
  await expect(launcher(page)).toContainText('LHR → JFK · 7h 32m');
  await page.screenshot({ path: `test-results/import-loaded-${info.project.name}.png`, animations: 'disabled' });

  // A shared link brings the same path back, and it plays.
  const shared = page.url();
  await page.goto(shared);
  await expect(page.getByRole('region', { name: 'Journey totals' })).toContainText('Recorded path');
  await launcher(page).getByRole('button', { name: 'Play journey', exact: true }).click();
  const bar = page.getByRole('region', { name: 'Timeline', exact: true });
  await expect(bar.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await expect(bar).toContainText('En route to New York JFK');
});

test('a pasted flight plan resolves beacons and coordinates, and compares with GlobeHops’ route', async ({ page }) => {
  await page.goto('./');
  await openPlanner(page);
  await page.getByRole('button', { name: /^Import a flight path/ }).click();
  await dialog(page)
    .getByLabel('Or paste a path or a route')
    .fill('EGLL/27R CPT3F CPT UL9 STU DCT 52N020W 53N030W 52N040W 50N050W DCT YQX DCT KJFK/31L');
  await dialog(page).getByRole('button', { name: 'Read', exact: true }).click();
  await expect(dialog(page).getByRole('list', { name: 'Flights found' })).toContainText('Planned path');
  await expect(dialog(page)).toContainText('Airways drawn as direct lines between their points: UL9.');
  await dialog(page).getByRole('button', { name: 'Show on the globe', exact: true }).click();
  await expect(page).toHaveURL(/[?&]route=LHR-JFK&trk1=1p/);
  await page.getByRole('button', { name: 'Compare with GlobeHops’ route', exact: true }).click();
  // Two journeys between the same airports: the plan, and GlobeHops' own route, on one clock.
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab').nth(1)).toContainText('GlobeHops route');
  await expect(page).toHaveURL(/b\.route=LHR-JFK/);
  await expect(page).not.toHaveURL(/b\.trk1=/);
  await expect(launcher(page).getByRole('button', { name: 'Play all 2 journeys', exact: true })).toBeVisible();
});
