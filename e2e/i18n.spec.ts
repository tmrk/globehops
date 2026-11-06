import { test, expect } from './fixtures.ts';
import { hu } from '../src/i18n/messages/hu.ts';
import { sv } from '../src/i18n/messages/sv.ts';

test.use({ localeChoice: null });

test('Hungarian path loads translated chrome and switches to Swedish without reloading', async ({ page }) => {
  await page.goto('./hu/?route=CPH-LHR&dep1=2026-11-20T08:15&clock=utc&units=mi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
  await expect(page.getByRole('heading', { name: 'Az útvonalad', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Megosztás', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/az utad egy 3D-s földgömbön/);
  await page.evaluate(() => {
    document.documentElement.dataset.i18nSession = 'same-document';
  });
  const query = new URL(page.url()).search;
  await page.getByRole('button', { name: 'Megjelenítés', exact: true }).click();
  await page.getByRole('radio', { name: 'Svenska', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await expect(page).toHaveURL(new RegExp(`/globehops/sv/\\${query}$`));
  await expect(page.getByRole('heading', { name: 'Din resa', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dela', exact: true })).toBeVisible();
  expect(await page.locator('html').getAttribute('data-i18n-session')).toBe('same-document');
  expect(await page.evaluate(() => localStorage.getItem('globehops:locale'))).toBe('sv');
  expect(new URL(page.url()).search).toBe(query);
});

test('query alias canonicalizes to a locale path without storing an explicit choice', async ({ page }) => {
  await page.goto('./?lang=hu&route=CPH-LHR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
  await expect(page).toHaveURL(/\/globehops\/hu\/\?route=CPH-LHR$/);
  expect(await page.evaluate(() => localStorage.getItem('globehops:locale'))).toBeNull();
});

test('a path beats query and stored language; explicit English path works without a trailing slash', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => localStorage.setItem('globehops:locale', 'sv'));
  await page.goto('./hu/?lang=sv&route=CPH-LHR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
  await page.goto('./en?route=CPH-LHR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
});

test.describe('country proxy', () => {
  test.use({ timezoneId: 'Europe/Budapest' });
  test('root selects Hungarian before browser English and leaves the address neutral', async ({ page }) => {
    await page.goto('./?route=CPH-LHR');
    await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
    await expect(page.getByRole('heading', { name: 'Az útvonalad' })).toBeVisible();
    await expect(page).toHaveURL(/\/globehops\/\?route=CPH-LHR$/);
  });
  test('stored English beats the country proxy', async ({ page, context }) => {
    await context.addInitScript(() => localStorage.setItem('globehops:locale', 'en'));
    await page.goto('./?route=CPH-LHR');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Your journey' })).toBeVisible();
  });
});

test('Swedish country proxy selects Swedish', async ({ browser, auditPage, baseURL }) => {
  const context = await browser.newContext({ timezoneId: 'Europe/Stockholm', locale: 'hu-HU' });
  const page = await context.newPage();
  auditPage(page);
  await page.goto(`${baseURL}?route=CPH-LHR`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await context.close();
});

test('selector supports keyboard arrows and About language selection', async ({ page }) => {
  await page.goto('./hu/?route=');
  await expect(page).toHaveTitle('GlobeHops — az utad egy 3D-s földgömbön');
  await page.getByRole('button', { name: 'Megjelenítés', exact: true }).click();
  const magyar = page.getByRole('radio', { name: 'Magyar', exact: true });
  await magyar.focus();
  await magyar.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Svenska', exact: true })).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Om GlobeHops' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveURL(/\/globehops\/en\/$/);
  await expect(page.getByRole('dialog')).toContainText('How it works');
});

test('share links are language neutral while editing keeps the locale path', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined });
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async (value: string) => {
        sessionStorage.setItem('copied-link', value);
      },
    });
  });
  await page.goto('./sv/?route=CPH-LHR');
  await page.getByRole('button', { name: 'Dela', exact: true }).click();
  const shared = await page.evaluate(() => sessionStorage.getItem('copied-link'));
  expect(shared).toMatch(/\/globehops\/\?route=CPH-LHR$/);
  await expect(page).toHaveURL(/\/globehops\/sv\/\?route=CPH-LHR$/);
});

for (const [locale, messages] of [
  ['hu', hu],
  ['sv', sv],
] as const) {
  test(`${locale} translated route, menu, schedule, playback, About and picker screenshots`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`./${locale}/?route=CPH-LHR-JFK`);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await expect(page.getByRole('heading', { name: messages['panel.yourJourney'], exact: true })).toBeVisible();
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const action = page.locator('.summary__action');
      if (await action.isVisible()) {
        const button = await action.boundingBox();
        const panel = await page.getByRole('main').boundingBox();
        expect(button!.x + button!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
      }
      await page.screenshot({ path: testInfo.outputPath(`${locale}-${name}.png`), animations: 'disabled' });
    };
    await capture('route');
    await page.getByRole('button', { name: messages['maptools.displayOptions'], exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Magyar' })).toBeVisible();
    await capture('display');
    await page.keyboard.press('Escape');
    await page.locator('[data-leg="0"]').click();
    const editor = page.locator('.leg-schedule');
    await expect(editor).toBeVisible();
    await editor.getByLabel(messages['schedule.departureDate'], { exact: true }).fill('2026-11-20');
    await editor.getByLabel(messages['schedule.departureTime'], { exact: true }).fill('08:15');
    await expect(editor).toContainText(/nov/);
    await capture('schedule');
    await editor.getByRole('button', { name: messages['schedule.done'].trim(), exact: true }).click();
    await page.getByRole('button', { name: messages['panel.play'], exact: true }).click();
    const bar = page.locator('.time-bar');
    await expect(bar.getByRole('button', { name: messages['timebar.pausePlayback'] })).toBeVisible();
    await capture('playback');
    await bar.getByRole('button', { name: messages['timebar.closeTimeline'] }).click();
    await page.getByRole('button', { name: messages['panel.aboutGlobeHops'] }).click();
    await expect(page.getByRole('dialog')).toContainText(messages['about.method']);
    await capture('about');
    await page.getByRole('dialog').getByRole('button', { name: messages['common.close'], exact: true }).click();
    const expand = page.getByRole('button', { name: messages['panel.showJourneyDetails'], exact: true }).first();
    if (await expand.isVisible()) await expand.click();
    await page.locator('.stop__main').first().click();
    await page.getByRole('combobox', { name: messages['stops.departureAirport'], exact: true }).fill('Stockholm');
    const results = page.getByRole('listbox', { name: messages['picker.results'] });
    await expect(results.getByRole('option').first()).toBeVisible();
    await expect(results).toContainText(locale === 'hu' ? 'Svédország' : 'Sverige');
    const caption = page.locator('.picker__caption');
    if (await caption.isVisible()) {
      const bounds = await caption.boundingBox();
      const input = await page
        .getByRole('combobox', { name: messages['stops.departureAirport'], exact: true })
        .boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(input!.x);
    }
    await capture('picker');
    if (testInfo.project.name.startsWith('mobile')) {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.getByRole('button', { name: messages['picker.backToJourney'], exact: true }).click();
      await page.getByRole('button', { name: messages['maptools.displayOptions'], exact: true }).click();
      await capture('display-360');
      await page.keyboard.press('Escape');
      await page.locator('[data-leg="0"]').click();
      await capture('schedule-360');
    }
  });
}
