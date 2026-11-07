import { mkdir } from 'node:fs/promises';
import { test, expect, openDisplay } from './fixtures.ts';

const reviewDir = 'test-results/review';

test('distance radios support a single tab stop and arrow, Home and End keys', async ({ page }) => {
  await page.goto('./?route=CPH-LHR');
  const display = await openDisplay(page);
  const km = display.getByRole('radio', { name: 'km', exact: true });
  const mi = display.getByRole('radio', { name: 'mi', exact: true });
  await expect(km).toHaveAttribute('tabindex', '0');
  await expect(mi).toHaveAttribute('tabindex', '-1');
  await km.focus();
  await km.press('ArrowRight');
  await expect(mi).toBeFocused();
  await expect(mi).toHaveAttribute('aria-checked', 'true');
  await expect(km).toHaveAttribute('tabindex', '-1');
  await mi.press('Home');
  await expect(km).toBeFocused();
  await expect(km).toHaveAttribute('aria-checked', 'true');
  await km.press('End');
  await expect(mi).toBeFocused();
  await mi.press('ArrowDown');
  await expect(km).toBeFocused();
  await expect(km).toHaveAttribute('aria-checked', 'true');
});

test('motion choice overrides the system in either direction and survives reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-LHR');
  await openDisplay(page);
  const toggle = page.getByRole('button', { name: 'Reduce motion', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await openDisplay(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
});

test('language menu is exclusive, closes on selection and restores focus', async ({ page }) => {
  await page.goto('./en/?route=CPH-LHR');
  await openDisplay(page);
  const language = page.getByRole('button', { name: 'Language: English', exact: true });
  await language.click();
  await expect(page.getByRole('button', { name: 'Display options', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('radiogroup', { name: 'Language', exact: true })).toBeVisible();
  const english = page.getByRole('radio', { name: 'English', exact: true });
  await english.focus();
  await english.press('End');
  await expect(page.getByRole('radio', { name: 'Svenska', exact: true })).toBeFocused();
  await page.getByRole('radio', { name: 'Svenska', exact: true }).press('Home');
  await expect(english).toBeFocused();
  await english.click();
  await expect(language).toBeFocused();
  await expect(language).toHaveAttribute('aria-expanded', 'false');
  await language.click();
  await page.keyboard.press('Escape');
  await expect(language).toBeFocused();
  await language.click();
  await page.getByRole('heading', { name: 'Your journey', exact: true }).click();
  await expect(language).toHaveAttribute('aria-expanded', 'false');
});

test('browser location draws a local dot, updates, hides behind Earth and clears when off', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 55.6761, longitude: 12.5683, accuracy: 100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=ARN-FCO');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await openDisplay(page);
  const toggle = page.getByRole('button', { name: 'My location', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const dot = page.locator('.globe-user-location');
  await expect(dot).toBeVisible();
  await page.keyboard.press('Escape');
  await mkdir(reviewDir, { recursive: true });
  await page.screenshot({ path: `${reviewDir}/location-${test.info().project.name}.png`, animations: 'disabled' });
  expect(new URL(page.url()).search).toBe('?route=ARN-FCO');
  const stored = await page.evaluate(() => ({ ...localStorage }));
  expect(stored['globehops:myLocation']).toBe('on');
  expect(JSON.stringify(stored)).not.toContain('55.6761');
  await context.setGeolocation({ latitude: -55.6761, longitude: -167.4317 });
  await expect(dot).toBeHidden();
  await context.setGeolocation({ latitude: 55.6761, longitude: 12.5683 });
  await expect(dot).toBeVisible();
  await openDisplay(page);
  await toggle.click();
  await expect(dot).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('globehops:myLocation'))).toBe('off');
});

test('denied browser location switches off and explains browser settings', async ({ context, page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Explicit browser permission denial uses Chromium CDP');
  await context.clearPermissions();
  const session = await context.newCDPSession(page);
  await session.send('Browser.setPermission', {
    permission: { name: 'geolocation' },
    setting: 'denied',
  });
  await page.goto('./?route=CPH-FCO');
  await openDisplay(page);
  const toggle = page.getByRole('button', { name: 'My location', exact: true });
  await toggle.click();
  await expect(page.getByRole('status')).toContainText('Location is blocked in your browser settings.');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('globehops:myLocation'))).toBe('off');
  await expect(page.locator('.globe-user-location')).toBeHidden();
  await session.detach();
});

test('unavailable location stops watching without forgetting the explicit on choice', async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        watchPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
          queueMicrotask(() => error({ code: 2, PERMISSION_DENIED: 1 } as GeolocationPositionError));
          return 42;
        },
        clearWatch: (id: number) => {
          document.documentElement.dataset.clearedLocationWatch = String(id);
        },
      },
    });
  });
  await page.goto('./?route=CPH-FCO');
  await openDisplay(page);
  const toggle = page.getByRole('button', { name: 'My location', exact: true });
  await toggle.click();
  await expect(page.getByRole('status')).toContainText('Your location isn’t available right now.');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-cleared-location-watch', '42');
  expect(await page.evaluate(() => localStorage.getItem('globehops:myLocation'))).toBe('on');
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
  [375, 667],
  [667, 375],
]) {
  test(`display and language menus fit ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./?route=CPH-LHR-JFK');
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    const display = await openDisplay(page);
    await expect(display).toBeVisible();
    const bounds = await display.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    await display.getByRole('button', { name: 'Reduce motion', exact: true }).scrollIntoViewIfNeeded();
    if (width === 390 || width === 1440) {
      await display.getByRole('button', { name: 'Country borders', exact: true }).scrollIntoViewIfNeeded();
      await mkdir(reviewDir, { recursive: true });
      await page.screenshot({ path: `${reviewDir}/display-${width}-${info.project.name}.png`, animations: 'disabled' });
    }
    await page.getByRole('button', { name: 'Language: English', exact: true }).click();
    await expect(display).toBeHidden();
    const language = page.getByRole('radiogroup', { name: 'Language', exact: true });
    await expect(language).toBeVisible();
    const languageBounds = await language.boundingBox();
    expect(languageBounds!.y + languageBounds!.height).toBeLessThanOrEqual(height);
    if (width === 390 || width === 1440) {
      await page.screenshot({
        path: `${reviewDir}/language-${width}-${info.project.name}.png`,
        animations: 'disabled',
      });
    }
  });
}
