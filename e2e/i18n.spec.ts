import { test, expect, atApp, expectPlaceName, placeNames } from './fixtures.ts';
import { hu } from '../src/i18n/messages/hu.ts';
import { sv } from '../src/i18n/messages/sv.ts';

test.use({ localeChoice: null });

test('Hungarian path loads translated chrome and switches to Swedish without reloading', async ({ page }) => {
  await page.goto('./hu/?route=CPH-LHR&dep1=2026-11-20T08:15&clock=utc&units=mi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
  await expect(page.getByRole('heading', { name: 'Az útvonalad', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Megosztás', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('CPH → LHR · GlobeHops');
  await page.evaluate(() => {
    document.documentElement.dataset.i18nSession = 'same-document';
  });
  // Paused schedules debounce their initial instant into the URL; compare the settled query.
  await expect(page).toHaveURL(/t=2026-11-20T07:15Z/);
  const query = new URL(page.url()).search;
  await page.getByRole('button', { name: 'Nyelv: Magyar', exact: true }).click();
  await page.getByRole('radio', { name: 'Svenska', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await expect(page).toHaveTitle('CPH → LHR · GlobeHops');
  await expect(page).toHaveURL(atApp(`sv/${query}`));
  await expect(page.getByRole('heading', { name: 'Din resa', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dela', exact: true })).toBeVisible();
  expect(await page.locator('html').getAttribute('data-i18n-session')).toBe('same-document');
  expect(await page.evaluate(() => localStorage.getItem('globehops:locale'))).toBe('sv');
  expect(new URL(page.url()).search).toBe(query);
});

test('query alias canonicalizes to a locale path without storing an explicit choice', async ({ page }) => {
  await page.goto('./?lang=hu&route=CPH-LHR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
  await expect(page).toHaveURL(atApp('hu/?route=CPH-LHR'));
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
    await expect(page).toHaveURL(atApp('?route=CPH-LHR'));
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
  await expect(page).toHaveTitle('GlobeHops – az utad egy 3D-s földgömbön');
  await page.getByRole('button', { name: 'Nyelv: Magyar', exact: true }).click();
  const magyar = page.getByRole('radio', { name: 'Magyar', exact: true });
  await magyar.focus();
  await magyar.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Svenska', exact: true })).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Om GlobeHops' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveURL(atApp('en/'));
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
  expect(shared).toMatch(atApp('?route=CPH-LHR'));
  await expect(page).toHaveURL(atApp('sv/?route=CPH-LHR'));
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
    await expect(page.getByRole('button', { name: messages['maptools.reduceMotion'], exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: messages['timebar.playJourney'], exact: true }).click();
    const bar = page.locator('.time-bar');
    await expect(bar.getByRole('button', { name: messages['timebar.pausePlayback'] })).toBeVisible();
    await capture('playback');
    // Playing is cinematic; the translated mini player brings the full timeline back.
    await bar.getByRole('button', { name: messages['timebar.showControls'], exact: true }).click();
    await capture('playback-controls');
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

test('city exonyms load after the UI and update suggestions, search and live descriptions', async ({ page }) => {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/city-names-*.json', async (route) => {
    await ready;
    await route.continue();
  });
  await page.goto('./hu/?route=BUD-VIE-CPH-ARN');
  await expect(page.locator('.stop__city')).toHaveText(['Budapest', 'Vienna', 'Copenhagen', 'Stockholm']);
  await expect(page.getByRole('button', { name: 'Megosztás', exact: true })).toBeEnabled();
  release();
  await expect(page.locator('.stop__city')).toHaveText(['Budapest', 'Bécs', 'Koppenhága', 'Stockholm']);
  await expect(page.locator('p[aria-live]').first()).toContainText('Bécs → Koppenhága');
  await expect(page.locator('.stop__main').nth(1)).toHaveAttribute('title', /Bécs/);
  await page.locator('.stop__main').first().click();
  const input = page.getByRole('combobox', { name: hu['stops.departureAirport'], exact: true });
  for (const [query, code] of [
    ['Bécs', 'VIE'],
    ['Koppenhága', 'CPH'],
    ['Varsó', 'WAW'],
  ]) {
    await input.fill(query);
    await expect(page.getByRole('option', { name: new RegExp(`^${code}\\b`) }).first()).toBeVisible();
  }
});

test.describe('welcome suggestion translations', () => {
  test.use({ timezoneId: 'Europe/Copenhagen' });
  test('English skips city data and selector updates cities and globe labels together', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/city-names-.*\.json/.test(request.url())) requests.push(request.url());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./en/?route=CPH-JFK');
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await expect(page.locator('.stop__city').first()).toHaveText('Copenhagen');
    expect(requests).toHaveLength(0);
    await page.getByRole('button', { name: 'Display options', exact: true }).click();
    await page.getByRole('button', { name: 'Oceans and seas', exact: true }).click();
    await expectPlaceName(page, 'ocean', 'North Atlantic');
    await page.getByRole('button', { name: 'Language: English', exact: true }).click();
    await page.getByRole('radio', { name: 'Magyar', exact: true }).click();
    await expect(page.locator('.stop__city').first()).toHaveText('Koppenhága');
    await expectPlaceName(page, 'ocean', 'Atlanti-óceán');
    await page.getByRole('button', { name: 'Nyelv: Magyar', exact: true }).click();
    await page.getByRole('radio', { name: 'Svenska', exact: true }).click();
    await expect(page.locator('.stop__city').first()).toHaveText('Köpenhamn');
    await expectPlaceName(page, 'ocean', 'Atlanten');
    expect(requests).toHaveLength(1);
    await page.keyboard.press('Escape');
    await page.goto('./hu/?route=');
    const start = page.getByRole('button', { name: 'Repülőút megjelenítése', exact: true });
    if (await start.isVisible()) await start.click();
    await expect(page.locator('.suggestions')).toContainText('Koppenhága → Sydney');
  });
});

for (const [locale, messages, cities, query] of [
  ['hu', hu, ['Budapest', 'Bécs', 'Koppenhága', 'Stockholm'], 'Bécs'],
  ['sv', sv, ['Budapest', 'Wien', 'Köpenhamn', 'Stockholm'], 'Köpenhamn'],
] as const) {
  test(`${locale} integrated place names, exonym picker and follow screenshots`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${locale}-integrated-${name}.png`), animations: 'disabled' });
    };
    await page.goto(`./${locale}/?route=BUD-VIE-CPH-ARN`);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await expect(page.locator('.stop__city')).toHaveText([...cities]);
    await capture('route');
    await page.getByRole('button', { name: messages['maptools.displayOptions'], exact: true }).click();
    await page.getByRole('button', { name: messages['maptools.countryNames'], exact: true }).click();
    await expect(page.getByRole('button', { name: messages['maptools.waterNames'], exact: true })).toBeVisible();
    await capture('display');
    await page.keyboard.press('Escape');
    await page.locator('.stop__main').first().click();
    await page.getByRole('combobox', { name: messages['stops.departureAirport'], exact: true }).fill(query);
    await expect(
      page.getByRole('option', { name: new RegExp(`^${locale === 'hu' ? 'VIE' : 'CPH'}\\b`) }).first(),
    ).toBeVisible();
    await capture('picker');
    await page.goto(`./${locale}/?route=BUD-VIE-CPH-ARN&dep1=2026-11-20T08:15&follow=1&t=2026-11-20T07:30Z`);
    const bar = page.locator('.time-bar');
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await expect(bar.getByRole('button', { name: messages['timebar.followAircraft'], exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await bar.getByRole('button', { name: messages['timebar.playJourney'], exact: true }).click();
    await expect(bar.getByRole('button', { name: messages['timebar.pausePlayback'], exact: true })).toBeVisible();
    await expect(bar.locator('.time-bar__title')).toContainText(locale === 'hu' ? 'Bécs' : 'Wien');
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    // Cinematic playback keeps the speed menu with the full timeline.
    await page.getByRole('button', { name: messages['timebar.showControls'], exact: true }).click();
    await bar.getByRole('combobox', { name: messages['timebar.playbackSpeed'], exact: true }).selectOption('3600');
    await expect(bar.locator('.time-bar__speed')).toContainText(locale === 'hu' ? '1 óra/mp' : '1 h/s');
    const readout = bar.locator('.time-bar__readout');
    expect(await readout.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(
      true,
    );
    await capture('follow');
    await page.goto(`./${locale}/?route=CPH-JFK&follow=0`);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await expectPlaceName(page, 'ocean', locale === 'hu' ? 'Atlanti-óceán' : 'Atlanten');
    await capture('ocean');
    await page.goto(`./${locale}/?route=FCO-ATH&follow=0`);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await expect.poll(async () => (await placeNames(page, 'sea')).length).toBeGreaterThan(0);
    await capture('sea');
  });
}
