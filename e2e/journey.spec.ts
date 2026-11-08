import {
  test,
  expect,
  expectRoute,
  chooseAirport,
  stopButtons,
  airportField,
  openDisplay,
  startEditing,
} from './fixtures.ts';

test.use({ timezoneId: 'Europe/Copenhagen' });

test('first visit loads three long-haul examples from the home country', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('./');
  await expectRoute(page, ['CPH', 'SYD']);
  await expect(page.getByRole('heading', { name: /Example journey/ })).toBeVisible();
  const suggestions = page.getByRole('list', { name: /try one of these/i }).getByRole('button');
  await expect(suggestions).toHaveCount(3);
  await expect(suggestions.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Flight \d,/ })).toHaveCount(1);
  const totals = page.getByRole('region', { name: 'Journey totals' });
  // One flight needs no sublines: ≈ already marks the estimate.
  await expect(totals.locator('.stat__detail')).toHaveCount(0);
  await expect(totals).toContainText(/\d[\d,]*km/);
  await expect(totals).toContainText(/≈ (?:1[2-9]|2\d)h \d+m/);
  await expect(totals.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await suggestions.nth(1).click();
  await expectRoute(page, ['CPH', 'SIN']);
  // A chosen suggestion is the visitor's journey (reset, compare) while the list stays for switching.
  await expect(page.getByRole('heading', { name: 'Your journey', exact: true })).toBeVisible();
  await expect(suggestions.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(suggestions.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Reset journey', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare journeys' })).toBeVisible();
  await startEditing(page);
  await page.getByRole('button', { name: 'Reverse route', exact: true }).click();
  await expectRoute(page, ['SIN', 'CPH']);
  await expect(page.locator('.suggestions')).toHaveCount(0);
});

test.describe('western US welcome', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('first visit starts at LAX', async ({ page }) => {
    await page.goto('./');
    await expectRoute(page, ['LAX', 'SYD']);
    await expect(page.getByRole('heading', { name: /Example journey/ })).toBeVisible();
    const suggestions = page.getByRole('list', { name: 'Try one of these', exact: true }).getByRole('button');
    await expect(suggestions).toHaveCount(3);
    await expect(suggestions.first()).toHaveAttribute('aria-pressed', 'true');
    for (const button of await suggestions.all()) await expect(button).toContainText('Los Angeles →');
  });
});

test.describe('Budapest welcome layout', () => {
  test.use({ timezoneId: 'Europe/Budapest' });
  test('welcome keeps all three choices and Play visible beside the globe', async ({ page, isMobile }, testInfo) => {
    // Review the owner's reference phone size; desktop keeps the project's 1440 × 900 viewport.
    if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await expectRoute(page, ['BUD', 'SYD']);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await page.evaluate(() => document.fonts.ready);
    const suggestions = page.getByRole('list', { name: 'Try one of these', exact: true }).getByRole('button');
    await expect(suggestions).toHaveCount(3);
    for (const button of await suggestions.all()) {
      await expect(button).toBeInViewport({ ratio: 1 });
      const bounds = await button.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(isMobile ? 44 : 40);
    }
    await expect(
      page.getByRole('region', { name: 'Journey totals' }).getByRole('button', { name: 'Play', exact: true }),
    ).toBeInViewport();
    if (isMobile) {
      const panel = await page.locator('.panel').boundingBox();
      expect(panel!.y).toBeGreaterThan(page.viewportSize()!.height * 0.4);
    }
    await page.screenshot({ path: `test-results/welcome-${testInfo.project.name}.png`, animations: 'disabled' });
  });
});

test('first visit waits for the zone table before choosing its example', async ({ page }) => {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = () => {};
  const zoneRequested = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/timezones-*.json', async (route) => {
    requested();
    await ready;
    await route.continue();
  });
  await page.goto('./');
  await zoneRequested;
  await expect(page.getByRole('button', { name: 'Departure airport: choose an airport' })).toBeEnabled();
  await expect(stopButtons(page)).toHaveCount(0);
  expect(new URL(page.url()).search).toBe('');
  release();
  await expectRoute(page, ['CPH', 'SYD']);
});

for (const source of ['URL', 'invalid itinerary', 'remembered journey', 'legacy route'] as const) {
  test(`${source} loads without waiting for the zone table`, async ({ page }) => {
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/timezones-*.json', async (route) => {
      await ready;
      await route.continue();
    });
    if (source === 'remembered journey' || source === 'legacy route') {
      await page.addInitScript((kind) => {
        localStorage.setItem(
          kind === 'legacy route' ? 'globehops:lastRoute' : 'globehops:lastJourney',
          kind === 'legacy route' ? JSON.stringify(['CPH', 'JFK']) : '?route=CPH-JFK',
        );
      }, source);
    }
    const url = source === 'URL' ? './?route=CPH-JFK' : source === 'invalid itinerary' ? './?itinerary=invalid' : './';
    await page.goto(url);
    if (source === 'invalid itinerary') {
      await expectRoute(page, ['CPH', 'SYD']);
      await expect(page.getByRole('heading', { name: /Example journey/ })).toBeVisible();
    } else {
      await expectRoute(page, ['CPH', 'JFK']);
      await expect(page.getByRole('heading', { name: 'Your journey', exact: true })).toBeVisible();
    }
    release();
  });
}

test('failed zone loading still shows usable welcome suggestions', async ({ page }) => {
  await page.route('**/timezones-*.json', (route) => route.fulfill({ status: 200, body: '{}' }));
  await page.goto('./');
  await expectRoute(page, ['CPH', 'SYD']);
  await expect(page.getByRole('list', { name: 'Try one of these', exact: true }).getByRole('button')).toHaveCount(3);
});

test('desktop entry uses keyboard selection and advances to destination', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop inline picker; takeover is covered separately.');
  await page.goto('./?route=');
  // Canonicalisation happens only after data loading and route initialisation.
  await expect(page).toHaveURL(/\/globehops\/$/);
  await page.getByRole('button', { name: 'Departure airport: choose an airport' }).click();
  const from = page.getByRole('combobox', { name: 'Departure airport' });
  const options = page.getByRole('listbox', { name: 'Airport suggestions' }).getByRole('option');
  await from.fill('copenhagen');
  await expect(options.first()).toContainText('CPH');
  await from.press('ArrowDown');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await from.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Destination airport' })).toBeFocused();
  await chooseAirport(page, 'toronto', 'YYZ');
  await expectRoute(page, ['CPH', 'YYZ']);
  await expect(page.getByRole('button', { name: /^Flight 1, CPH to YYZ:/ })).toContainText(/\d[\d,]* km.*≈/);
});

test('autocomplete searches codes, city, aliases and diacritics and Escape clears then closes', async ({ page }) => {
  await page.goto('./?route=');
  // Canonicalisation happens only after data loading and route initialisation.
  await expect(page).toHaveURL(/\/globehops\/$/);
  await page.getByRole('button', { name: 'Departure airport: choose an airport' }).click();
  const input = airportField(page);
  const options = page.getByRole('listbox', { name: 'Airport suggestions' }).getByRole('option');
  for (const [query, code] of [
    ['JFK', 'JFK'],
    ['EGLL', 'LHR'],
    ['kastrup', 'CPH'],
    ['malmö', 'MMX'],
    ['malmo', 'MMX'],
  ]) {
    await input.fill(query);
    await expect(options.first()).toContainText(code);
  }
  await input.fill('London');
  for (const code of ['LHR', 'LGW', 'STN'])
    await expect(options.filter({ hasText: new RegExp(`^${code}`) })).toBeVisible();
  await input.fill('zzzznoairport');
  await expect(page.getByText('No airports match “zzzznoairport”', { exact: true }).first()).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('listbox')).toBeHidden();
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Departure airport: choose an airport' })).toBeVisible();
});

test('mobile takeover focuses input, keeps results in viewport, selects and cancels', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, 'Mobile takeover only exists below 760px.');
  await page.goto('./?route=');
  // Canonicalisation happens only after data loading and route initialisation.
  await expect(page).toHaveURL(/\/globehops\/$/);
  await page.getByRole('button', { name: 'Departure airport: choose an airport' }).tap();
  const dialog = page.getByRole('dialog', { name: 'Departure airport', exact: true });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('copenhagen');
  const options = dialog.getByRole('option');
  await expect(options.first()).toBeVisible();
  const visibleOptions = Math.min(3, await options.count());
  for (let i = 0; i < visibleOptions; i++) {
    await expect(async () => {
      const box = await options.nth(i).boundingBox();
      const viewport = await page.evaluate(() => ({
        x: visualViewport?.offsetLeft ?? 0,
        y: visualViewport?.offsetTop ?? 0,
        width: visualViewport?.width ?? innerWidth,
        height: visualViewport?.height ?? innerHeight,
      }));
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(viewport.x);
      expect(box!.y).toBeGreaterThanOrEqual(viewport.y);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
    }).toPass();
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-picker.png'), animations: 'disabled' });
  await options.first().tap();
  await expect(
    page.getByRole('dialog', { name: 'Destination airport', exact: true }).getByRole('combobox'),
  ).toBeFocused();
  await airportField(page).fill('toronto');
  await page.getByRole('option', { name: /^YYZ\b/ }).tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectRoute(page, ['CPH', 'YYZ']);
  await page.screenshot({ path: testInfo.outputPath('edited-mobile-journey.png'), animations: 'disabled' });
  await stopButtons(page).first().tap();
  await airportField(page).fill('JFK');
  await page.getByRole('button', { name: 'Back to journey' }).tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectRoute(page, ['CPH', 'YYZ']);
});

test('insert and remove a transfer, reverse, reset and choose a suggestion', async ({ page }) => {
  await page.goto('./?route=CPH-JFK');
  await expectRoute(page, ['CPH', 'JFK']);
  // Everyday rows stay uncluttered; edit mode reveals insert, remove, reorder and reverse.
  await expect(page.getByRole('button', { name: 'Remove Copenhagen', exact: true })).toHaveCount(0);
  await startEditing(page);
  await page.getByRole('button', { name: 'Add a stop after Copenhagen', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Stop 1' })).toBeFocused();
  await chooseAirport(page, 'LHR', 'LHR');
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
  await page.getByRole('button', { name: 'Remove London', exact: true }).click();
  await expectRoute(page, ['CPH', 'JFK']);
  await page.getByRole('button', { name: 'Reverse route', exact: true }).click();
  await expectRoute(page, ['JFK', 'CPH']);
  // Reset asks in place: Cancel takes focus and Escape backs out; only the explicit Reset starts over.
  const reset = page.getByRole('button', { name: 'Reset journey', exact: true });
  await reset.click();
  const confirmReset = page.getByRole('group', { name: /^Reset the journey\?/ });
  await expect(confirmReset.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(reset).toBeFocused();
  await expectRoute(page, ['JFK', 'CPH']);
  await reset.click();
  await confirmReset.getByRole('button', { name: 'Reset', exact: true }).click();
  // Resetting opens the inline departure picker on desktop; dismiss it before using suggestions.
  if (await airportField(page).count()) await airportField(page).press('Escape');
  await expect(stopButtons(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Departure airport: choose an airport' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Journey totals' })).toHaveCount(0);
  const suggestions = page.getByRole('list', { name: 'Or try one of these', exact: true }).getByRole('button');
  await expect(suggestions).toHaveCount(3);
  await suggestions.first().click();
  await expectRoute(page, ['CPH', 'SYD']);
  await expect(page.getByRole('heading', { name: 'Your journey', exact: true })).toBeVisible();
});

test('keyboard grips reorder in both directions', async ({ page }) => {
  await page.goto('./?route=CPH-LHR-JFK');
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
  await startEditing(page);
  const grip = page.getByRole('button', { name: 'Reorder London. Use up and down arrow keys to move' });
  await grip.focus();
  await grip.press('ArrowUp');
  await expectRoute(page, ['LHR', 'CPH', 'JFK']);
  await expect(grip).toBeFocused();
  await grip.press('ArrowDown');
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
});

test('miles persist across reload and URL routes override remembered routes', async ({ page }) => {
  await page.goto('./?route=CPH-YYZ');
  await expectRoute(page, ['CPH', 'YYZ']);
  const display = await openDisplay(page);
  await expect(display.getByRole('radio', { name: 'km', exact: true })).toHaveAttribute('aria-checked', 'true');
  await display
    .getByRole('radiogroup', { name: 'Distance unit' })
    .getByRole('radio', { name: 'mi', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Journey totals' })).toContainText(/\dmi/);
  await page.reload();
  await expectRoute(page, ['CPH', 'YYZ']);
  await openDisplay(page);
  await expect(page.getByRole('radio', { name: 'mi', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('region', { name: 'Journey totals' })).toContainText(/\dmi/);
  await page.goto('./');
  await expectRoute(page, ['CPH', 'YYZ']);
  await page.goto('./?route=LHR-JFK');
  await expectRoute(page, ['LHR', 'JFK']);
  await page.goto('./?route=');
  // Canonicalisation happens only after data loading and route initialisation.
  await expect(page).toHaveURL(/\/globehops\/$/);
  await expect(page.getByRole('button', { name: 'Departure airport: choose an airport' })).toBeVisible();
  await expect(stopButtons(page)).toHaveCount(0);
});

test('desktop Chromium share copies an exact URL which recreates the journey', async ({
  page,
  context,
  browser,
  browserName,
  isMobile,
  auditPage,
}) => {
  test.skip(
    browserName !== 'chromium' || isMobile,
    'Clipboard permissions require Chromium; mobile can use native sharing.',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./?route=CPH-LHR-JFK');
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('status').filter({ has: page.locator('.toast') })).toHaveText('Link copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(page.url());
  // This independent context does not inherit the shared explicit-English preference.
  const fresh = await browser.newContext({ locale: 'en-GB', timezoneId: 'UTC' });
  try {
    const other = await fresh.newPage();
    auditPage(other);
    await other.goto(copied);
    await expectRoute(other, ['CPH', 'LHR', 'JFK']);
  } finally {
    await fresh.close();
  }
});

test('missing codes show a toast and preserve valid airports; garbage remains editable', async ({ page }) => {
  await page.goto('./?route=CPH-XXX-JFK');
  await expect(page.locator('.toast')).toHaveText('Couldn’t find an airport with code “XXX”');
  await expectRoute(page, ['CPH', 'JFK']);
  await page.goto('./?route=%%%');
  await expect(page).toHaveURL(/\/globehops\/$/);
  await expect(page.getByRole('button', { name: 'Departure airport: choose an airport' })).toBeVisible();
  await expect(stopButtons(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Departure airport: choose an airport' }).click();
  await chooseAirport(page, 'CPH', 'CPH');
  await chooseAirport(page, 'JFK', 'JFK');
  await expectRoute(page, ['CPH', 'JFK']);
});

test('reload and browser back/forward restore routes', async ({ page }) => {
  await page.goto('./?route=CPH-LHR');
  await expectRoute(page, ['CPH', 'LHR']);
  await page.reload();
  await expectRoute(page, ['CPH', 'LHR']);
  await page.goto('./?route=SYD-LAX');
  await expectRoute(page, ['SYD', 'LAX']);
  await page.goBack();
  await expectRoute(page, ['CPH', 'LHR']);
  await page.goForward();
  await expectRoute(page, ['SYD', 'LAX']);
});

test('leg inspection updates selection and HUD, then restores the full route', async ({ page }) => {
  await page.goto('./?route=CPH-LHR-JFK');
  const second = page.getByRole('button', { name: /^Flight 2, LHR to JFK:/ });
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  const hud = page.getByRole('group', { name: 'Inspect flights one by one' });
  await expect(hud).toContainText('2/2');
  await hud.getByRole('button', { name: 'Previous flight' }).click();
  await expect(hud).toContainText('1/2');
  await hud.getByRole('button', { name: 'Next flight' }).click();
  await expect(hud).toContainText('2/2');
  await hud.getByRole('button', { name: 'Show the full route' }).click();
  await expect(second).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Show the full route' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Re-centre on the route' })).toBeVisible();
});

test('About credits open and Escape closes the dialog', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'About GlobeHops' }).click();
  const dialog = page.getByRole('dialog', { name: 'GlobeHops', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('NASA');
  await expect(dialog).toContainText('OurAirports');
  await expect(dialog).toContainText('Natural Earth');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'About GlobeHops' })).toBeFocused();
});

test('narrow airport dialog contains keyboard focus while editing', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-LHR');
  await stopButtons(page).first().click();
  const dialog = page.getByRole('dialog', { name: 'Departure airport', exact: true });
  const input = dialog.getByRole('combobox');
  const back = dialog.getByRole('button', { name: 'Back to journey', exact: true });
  await expect(input).toBeFocused();
  await input.press('Tab');
  await expect(back).toBeFocused();
  await back.press('Shift+Tab');
  await expect(input).toBeFocused();
  await input.fill('Stockholm');
  await expect(dialog.getByRole('option').first()).toContainText('ARN');
  await page.screenshot({ path: info.outputPath('narrow-keyboard-picker.png'), animations: 'disabled' });
  await input.press('Enter');
  await expect(stopButtons(page).first()).toHaveAccessibleName(/\(ARN\)/);
  await expect(dialog).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('narrow-edited-route.png'), animations: 'disabled' });
});

test('phone flight times get the sheet and search covers the screen above a keyboard', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=TPE-APP&leg=1');
  const schedule = page.locator('.leg-schedule');
  // The totals scroll with the list while a flight's times are open, so the whole editor shows.
  await expect(page.locator('.panel__scroll .summary')).toHaveCount(1);
  await expect(schedule).toBeInViewport({ ratio: 0.99 });
  for (const face of await schedule.locator('.dt-field__face').all())
    expect(await face.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('narrow-flight-times.png'), animations: 'disabled' });

  await stopButtons(page).first().click();
  // A shrunken visual viewport stands in for the on-screen keyboard: the picker follows it, while
  // the backdrop still covers the whole layout viewport so the journey cannot show through.
  await page.evaluate(() => document.documentElement.style.setProperty('--vv-height', '300px'));
  await expect(page.locator('.picker--takeover')).toHaveCSS('height', '300px');
  const backdrop = await page.locator('.takeover').boundingBox();
  expect(backdrop).toMatchObject({ x: 0, y: 0, width: 320 });
  expect(backdrop?.height).toBeGreaterThanOrEqual(640);
});

test('connections get a default layover that can be changed, totalled, shared and restored', async ({ page }) => {
  await page.goto('./?route=CPH-LHR-JFK');
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
  const totals = page.getByRole('region', { name: 'Journey totals' });
  const london = page.getByRole('combobox', { name: 'Layover in London' });
  await expect(london).toHaveValue('90');
  await expect(page.getByRole('combobox', { name: /^Layover in/ })).toHaveCount(1);
  // 1h 40m + 7h 00m flying, plus the default 1h 30m layover.
  await expect(totals).toContainText('8h 40m flying · 1h 30m layover');
  await expect(totals).toContainText('≈ 10h 10m');
  await london.selectOption('180');
  await expect(page).toHaveURL(/\/globehops\/\?route=CPH-LHR_180-JFK$/);
  await expect(totals).toContainText('≈ 11h 40m');
  await expect(totals).toContainText('3h 00m layover');
  // The layover belongs to its stop: reversing keeps it at London.
  await startEditing(page);
  await page.getByRole('button', { name: 'Reverse route', exact: true }).click();
  await expect(page).toHaveURL(/\/globehops\/\?route=JFK-LHR_180-CPH$/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Layover in London' })).toHaveValue('180');
  await page.getByRole('combobox', { name: 'Layover in London' }).selectOption('90');
  await expectRoute(page, ['JFK', 'LHR', 'CPH']);
  // Shared links may carry any whole-minute layover; it appears in the menu as is.
  await page.goto('./?route=LHR-DXB_100-SIN-SYD');
  await expect(page.getByRole('combobox', { name: 'Layover in Dubai' })).toHaveValue('100');
  await expect(page.getByRole('combobox', { name: 'Layover in Singapore' })).toHaveValue('90');
  await expect(totals).toContainText('3h 10m in layovers');
});

test('country borders are on by default and the choice is remembered', async ({ page }) => {
  const bordersLoaded = page.waitForResponse((response) => /borders-.*\.json$/.test(new URL(response.url()).pathname));
  await page.goto('./?route=CPH-LHR');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  expect((await bordersLoaded).status()).toBe(200);
  await openDisplay(page);
  const toggle = page.getByRole('button', { name: 'Country borders' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // Hidden borders are not even downloaded on the next visit.
  const requested: string[] = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  await page.reload();
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await openDisplay(page);
  await expect(page.getByRole('button', { name: 'Country borders' })).toHaveAttribute('aria-pressed', 'false');
  expect(requested.filter((path) => /borders-.*\.json$/.test(path))).toEqual([]);
  await page.getByRole('button', { name: 'Country borders' }).click();
  await expect(page.getByRole('button', { name: 'Country borders' })).toHaveAttribute('aria-pressed', 'true');
});

test('desktop search opens in place: rows keep their positions and suggestions float above them', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop inline picker; the mobile takeover covers the screen.');
  await page.goto('./?route=CPH-LHR-JFK');
  const destination = stopButtons(page).nth(2);
  await expect(destination).toBeVisible();
  const row = page.locator('[data-stop-row]').nth(1);
  const before = { row: await row.boundingBox(), next: await destination.boundingBox() };
  await stopButtons(page).nth(1).click();
  await expect(airportField(page)).toBeFocused();
  await expect(page.getByText(/City, airport or code/)).toBeVisible();
  await airportField(page).fill('par');
  const list = page.getByRole('listbox', { name: 'Airport suggestions' });
  await expect(list.getByRole('option').first()).toBeVisible();
  const after = await row.boundingBox();
  expect(after!.y).toBeCloseTo(before.row!.y, 0);
  expect(after!.height).toBeCloseTo(before.row!.height, 0);
  // The following stop has not moved even though eight suggestions are open.
  expect((await page.locator('[data-stop-row]').nth(2).boundingBox())!.y).toBeCloseTo(before.next!.y - 2, -1);
  const field = (await airportField(page).boundingBox())!;
  expect((await list.boundingBox())!.y).toBeGreaterThan(field.y + field.height);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
});

/** Dispatches a one-finger vertical swipe on an element (touch events carry only what the sheet reads). */
async function swipe(target: import('@playwright/test').Locator, dy: number) {
  await target.evaluate((element, distance) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y0 = box.top + box.height / 2;
    const fire = (type: string, y: number | null) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const touches = y === null ? [] : [{ clientX: x, clientY: y, identifier: 1, target: element }];
      Object.defineProperty(event, 'touches', { value: touches });
      element.dispatchEvent(event);
    };
    fire('touchstart', y0);
    for (let step = 1; step <= 8; step++) fire('touchmove', y0 + (distance * step) / 8);
    fire('touchend', null);
  }, dy);
}

test('mobile sheet is dismissed by dragging it down and restored by lifting the peek bar', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The bottom sheet exists on phones.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-LHR-JFK');
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
  const head = page.locator('.panel__head');
  // A short drag springs back.
  await swipe(head, 40);
  await expect(page.locator('.panel')).not.toHaveClass(/is-collapsed/);
  await expect(stopButtons(page)).toHaveCount(3);
  // A long drag down collapses the sheet to its peek bar, leaving the globe uncovered.
  await swipe(head, 260);
  const peek = page.locator('.peek');
  await expect(peek).toBeVisible();
  await expect(peek).toContainText('CPH → LHR → JFK');
  await expect(page.locator('.panel')).toHaveClass(/is-collapsed/);
  // Lifting the peek bar brings the journey back.
  await swipe(peek, -80);
  await expect(stopButtons(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Hide journey details' })).toBeVisible();
  // Content scrolled to the top also drags the sheet; the handle still toggles it for taps and keyboards.
  await swipe(page.locator('.panel__scroll'), 260);
  await expect(page.locator('.panel')).toHaveClass(/is-collapsed/);
  await page.getByRole('button', { name: 'Show journey details' }).first().click();
  await expect(stopButtons(page)).toHaveCount(3);
});
