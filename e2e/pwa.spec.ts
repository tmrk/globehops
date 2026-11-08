import { test, expect, airportField, stopButtons } from './fixtures.ts';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

async function controlled(page: Page) {
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function searchable(page: Page) {
  await stopButtons(page).first().click();
  await airportField(page).fill('Stockholm');
  await expect(page.getByRole('option', { name: /^ARN\b/ })).toBeVisible();
  await airportField(page).press('Escape');
  await airportField(page).press('Escape');
}

test('production PWA precaches all pages, lazy data and route links for offline use', async ({
  page,
  context,
}, info) => {
  const revisions: string[] = [];
  context.on('request', (request) => {
    if (new URL(request.url()).searchParams.has('__rev')) revisions.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-LHR-JFK');
  await controlled(page);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  expect(revisions.length).toBeGreaterThan(10);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await searchable(page);
  await page.goto('./?route=ARN-HEL&b.route=CPH-LHR&lang=en');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await expect(stopButtons(page).first()).toHaveAccessibleName(/\(ARN\)/);
  await page.screenshot({ path: info.outputPath('offline-edited-desktop.png') });
  await page.goto('./hu/?route=CPH-LHR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await page.goto('./sv/?route=ARN-HEL');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await page.goto('./en/?route=CPH-LHR');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await page.setViewportSize({ width: 390, height: 844 });
  await stopButtons(page).first().click();
  await airportField(page).fill('Stockholm');
  await expect(page.getByRole('option', { name: /^ARN\b/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('offline-picker-phone.png') });
});

test('a changed worker offers Update and reloads once into the new controller when interception is available', async ({
  page,
  context,
}, info) => {
  await page.goto('./?route=CPH-LHR');
  await controlled(page);
  let intercepted = false;
  await context.route('**/sw.js', async (route) => {
    intercepted = true;
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n/* PWA update probe */\n` });
  });
  const found = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    let found = false;
    registration.addEventListener('updatefound', () => {
      found = true;
    });
    await registration.update();
    return found;
  });
  if (!intercepted) {
    info.annotations.push({
      type: 'limitation',
      description:
        'Chromium service-worker main-script updates bypass context.route; updater lifecycle is covered with unit tests.',
    });
    test.skip(true, 'Chromium does not expose service-worker main-script update requests to context.route');
  }
  expect(found).toBe(true);
  const notice = page.locator('.toast-region');
  await expect(notice).toContainText('A new version of GlobeHops is ready');
  let reloads = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) reloads++;
  });
  await Promise.all([page.waitForEvent('load'), notice.getByRole('button', { name: 'Update', exact: true }).click()]);
  await controlled(page);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await expect(notice).not.toContainText('A new version of GlobeHops is ready');
  expect(reloads).toBe(1);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting === null)).toBe(
    true,
  );
});
