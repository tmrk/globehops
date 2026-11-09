import { test, expect, openDisplay } from './fixtures.ts';

// Helsinki–Tokyo crosses Russia, whose airspace has no published end to its closure for EU airlines,
// so the expectation holds whatever day the suite runs.
test('routes around restricted airspace by default; turning it off restores the great circle and persists', async ({
  page,
}) => {
  await page.goto('./?route=HEL-NRT');
  const flight = page.locator('.leg__main').first();
  const totals = page.getByRole('region', { name: 'Journey totals' });
  await expect(flight).toHaveAccessibleName(/routed around restricted airspace/);
  await expect(totals).toContainText(/Detours around restricted airspace: \+[\d,]+\s*km/);
  const routedKm = Number((await totals.locator('.stat__value').first().innerText()).replace(/\D/g, ''));
  expect(routedKm).toBeGreaterThan(9000);

  const display = await openDisplay(page);
  const toggle = display.getByRole('button', { name: 'Avoid restricted airspace' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(flight).toHaveAccessibleName(/7,830 km/);
  await expect(flight).not.toHaveAccessibleName(/restricted airspace/);
  await expect(totals).not.toContainText('restricted airspace');

  await page.reload();
  await expect(page.locator('.leg__main').first()).toHaveAccessibleName(/7,830 km/);
  await expect(page.locator('.leg__airspace')).toHaveCount(0);
});

test('leaves unaffected routes alone and explains flights that cannot avoid a zone', async ({ page }) => {
  await page.goto('./?route=LHR-JFK');
  await expect(page.locator('.leg__main').first()).toHaveAccessibleName(/5,540 km/);
  await expect(page.locator('.leg__airspace')).toHaveCount(0);

  // Beirut lies inside an advisory area valid until 16 Nov 2026; date the flight within it.
  await page.goto('./?route=LHR-BEY&dep1=2026-11-12T09:00');
  await expect(page.getByRole('region', { name: 'Journey totals' })).toContainText(
    'Restricted airspace can’t be avoided on this flight',
  );
  await page.locator('.leg__main').first().click();
  await expect(page.locator('.leg-schedule__airspace')).toContainText(
    'Starts or ends in restricted airspace over Lebanon',
  );
});
