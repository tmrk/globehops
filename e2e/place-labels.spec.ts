import { devices, type Page, type TestInfo } from '@playwright/test';
import { test, expect, expectRoute, openDisplay } from './fixtures.ts';

async function expectNoLabelOverlap(page: Page) {
  const overlaps = await page.locator('.country-label:visible').evaluateAll((elements) => {
    const labels = elements.map((el) => ({ name: el.textContent, rect: el.getBoundingClientRect() }));
    const airports = [...document.querySelectorAll('.globe-marker')]
      .filter((el) => getComputedStyle(el).visibility !== 'hidden')
      .flatMap((el) => [...el.querySelectorAll('.globe-marker__label, .globe-marker__dot')])
      .map((el) => ({ name: el.textContent || 'airport dot', rect: el.getBoundingClientRect() }));
    const result: string[] = [];
    for (let i = 0; i < labels.length; i++) {
      const a = labels[i];
      for (const b of [...labels.slice(i + 1), ...airports]) {
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
  expect(overlaps).toEqual([]);
}

async function captureLocales(page: Page, info: TestInfo, view: string, names: string[]) {
  for (const [i, locale] of ['en', 'hu', 'sv'].entries()) {
    // The test captures the production renderer below; there is no shipped hook or public query parameter.
    await page.evaluate((locale) => {
      const renderer = (
        globalThis as typeof globalThis & {
          __placeLabelReview: { setLabelLocale(locale: string): void };
        }
      ).__placeLabelReview;
      renderer.setLabelLocale(locale);
    }, locale);
    await expect(page.locator('.country-label:visible').filter({ hasText: names[i] }).first()).toBeVisible();
    // Wait for the on-demand layout frame, including fresh locale-specific text measurements.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expectNoLabelOverlap(page);
    await page.screenshot({ path: info.outputPath(`places-${view}-${locale}.png`), animations: 'disabled' });
  }
}

async function reviewPlaceNames(page: Page, info: TestInfo) {
  await page.route('**/GlobeView-*.js', async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const body = original.replace(
      /(this\.countryLabels\.setVisible\(\w+\.showCountryLabels\))/,
      '$1,globalThis.__placeLabelReview=this',
    );
    expect(body, 'Capture the renderer only in this test response').not.toBe(original);
    await route.fulfill({ response, body });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-JFK');
  await expectRoute(page, ['CPH', 'JFK']);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await openDisplay(page);
  await page.getByRole('button', { name: 'Country names', exact: true }).click();
  await page.keyboard.press('Escape');
  const atlantic = page.locator('.country-label--ocean:visible').filter({ hasText: /North Atlantic/ });
  await expect(atlantic).toBeVisible();
  await expect(atlantic).toHaveCSS('font-style', 'italic');
  await captureLocales(page, info, 'atlantic', ['North Atlantic', 'Atlanti-óceán', 'Atlanten']);

  await page.goto('./?route=CPH-FCO');
  await expectRoute(page, ['CPH', 'FCO']);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await expect(page.locator('.country-label--country:visible').filter({ hasText: /Germany/ })).toBeVisible();
  await page.getByRole('application').press('+');
  await captureLocales(page, info, 'europe', ['Germany', 'Németország', 'Tyskland']);

  await page.goto('./?route=NRT-HNL');
  await expectRoute(page, ['NRT', 'HNL']);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await expect(page.locator('.country-label--ocean:visible').filter({ hasText: /North Pacific/ })).toBeVisible();
  await captureLocales(page, info, 'pacific', ['North Pacific', 'Csendes-óceán', 'Stilla havet']);
}

test('country and ocean names at default, Europe and Pacific desktop views', async ({ page }, info) => {
  await reviewPlaceNames(page, info);
});

test.describe('Pixel 7', () => {
  test.use({
    viewport: devices['Pixel 7'].viewport,
    deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  });
  test('country and ocean names at default, Europe and Pacific phone views', async ({ page }, info) => {
    await reviewPlaceNames(page, info);
  });
});
