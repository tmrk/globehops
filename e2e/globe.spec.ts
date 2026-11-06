import sharp from 'sharp';
import { test, expect, expectRoute, chooseAirport, openDisplay, startEditing } from './fixtures.ts';

test('WebGL canvas renders varied pixels and airport labels', { tag: '@smoke' }, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-LHR-JFK');
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  const canvas = page.locator('canvas.globe-canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate((element: HTMLCanvasElement) => !!element.getContext('webgl2'))).toBe(true);
  for (const code of ['CPH', 'LHR', 'JFK']) {
    await expect(page.locator('.globe-marker__label').filter({ hasText: new RegExp(`^${code}$`) })).toHaveCount(1);
  }
  const rendered = await canvas.screenshot({ animations: 'disabled' });
  const stats = await sharp(rendered).stats();
  expect(Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev))).toBeGreaterThan(10);
  // Read compositor screenshots, never drawImage(WebGLCanvas): its drawing buffer is not preserved.
  // A blank reference retains the same background and UI, proving that globe pixels contributed.
  await canvas.evaluate((element: HTMLCanvasElement) => {
    element.style.opacity = '0';
  });
  let blank: Buffer;
  try {
    blank = await canvas.screenshot({ animations: 'disabled' });
  } finally {
    await canvas.evaluate((element: HTMLCanvasElement) => {
      element.style.removeProperty('opacity');
    });
  }
  const a = await sharp(rendered).removeAlpha().raw().toBuffer();
  const b = await sharp(blank).removeAlpha().raw().toBuffer();
  expect(a.length).toBe(b.length);
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) changed++;
  }
  expect(changed, 'Rendered globe must differ from an empty canvas by thousands of pixels').toBeGreaterThan(1000);
  await testInfo.attach('globe-canvas', { body: rendered, contentType: 'image/png' });
  await page.screenshot({ path: testInfo.outputPath('journey.png'), fullPage: true, animations: 'disabled' });
});

test('far-side airport labels hide when framing a distant leg', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=SYD-LAX-LHR');
  await expectRoute(page, ['SYD', 'LAX', 'LHR']);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await expect(page.locator('.globe-marker__label')).toHaveText(['SYD', 'LAX', 'LHR']);
  await page.getByRole('button', { name: /^Flight 1, SYD to LAX:/ }).click();
  const london = page
    .locator('.globe-marker')
    .filter({ has: page.locator('.globe-marker__label', { hasText: /^LHR$/ }) });
  await expect(london).toHaveCSS('opacity', '0');
  await expect(london).toHaveCSS('visibility', 'hidden');
});

test.describe('WebGL unavailable', () => {
  // Three.js and App intentionally report renderer creation failure. All other errors still fail.
  test.use({ expectedConsoleErrors: [/^(?:THREE\.WebGLRenderer: |Error: )*Error creating WebGL context\.(?:\n|$)/] });
  test('shows the fallback and keeps route editing usable', async ({ context, page }) => {
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
        return Reflect.apply(original, this, [type, ...args]);
      } as typeof original;
    });
    await page.goto('./?route=');
    await expect(page.getByRole('note')).toContainText('The 3D globe couldn’t start');
    await page.getByRole('button', { name: 'Language: English', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'English', exact: true })).toBeVisible();
    await openDisplay(page);
    await expect(page.getByRole('button', { name: 'Reduce motion', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'My location', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Departure airport: choose an airport' }).click();
    await chooseAirport(page, 'CPH', 'CPH');
    await chooseAirport(page, 'YYZ', 'YYZ');
    await expectRoute(page, ['CPH', 'YYZ']);
    await expect(page.getByRole('region', { name: 'Journey totals' })).toContainText('≈');
  });
});

test('reduced motion renders routes and responds to changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-LHR-JFK');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await startEditing(page);
  await page.getByRole('button', { name: 'Reverse route', exact: true }).click();
  await expectRoute(page, ['JFK', 'LHR', 'CPH']);
  await expect(page.locator('.globe-marker__label')).toHaveText(['JFK', 'LHR', 'CPH']);
  await expect(page.getByRole('application')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Journey totals' })).toContainText('2 flights');
});

test(
  'production assets and every same-origin request respect the Pages base path',
  { tag: '@smoke' },
  async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const paths: string[] = [];
    const responses: { path: string; status: number }[] = [];
    const failures: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin) paths.push(url.pathname);
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === origin) responses.push({ path: url.pathname, status: response.status() });
    });
    page.on('requestfailed', (request) => failures.push(request.url()));
    // Await the upgraded texture as well as the preview, so late asset failures are included.
    const fullTexture = page.waitForResponse((response) =>
      /earth-(?:4k|8k)-.*\.webp$/.test(new URL(response.url()).pathname),
    );
    const borders = page.waitForResponse((response) => /borders-.*\.json$/.test(new URL(response.url()).pathname));
    await page.goto('./?route=CPH-LHR-JFK');
    await expectRoute(page, ['CPH', 'LHR', 'JFK']);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await (await fullTexture).finished();
    await (await borders).finished();
    expect(responses.some(({ path, status }) => /earth-.*\.webp$/.test(path) && status === 200)).toBe(true);
    expect(responses.some(({ path, status }) => /airports-.*\.json$/.test(path) && status === 200)).toBe(true);
    expect(responses.some(({ path, status }) => /borders-.*\.json$/.test(path) && status === 200)).toBe(true);
    expect(paths.filter((path) => !path.startsWith('/globehops/'))).toEqual([]);
    expect(responses.filter(({ status }) => status >= 400)).toEqual([]);
    expect(failures).toEqual([]);
  },
);

for (const width of [320, 390, 768, 1440]) {
  test(`layout fits ${width}px without horizontal overflow`, async ({ page, isMobile }, testInfo) => {
    // Playwright's mobile WebKit cannot change isMobile at runtime, but supports viewport resizing.
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./?route=CPH-LHR-JFK');
    await expectRoute(page, ['CPH', 'LHR', 'JFK']);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    }));
    expect(dimensions.width).toBe(width);
    expect(dimensions.scroll).toBeLessThanOrEqual(width);
    const panel = page.getByRole('main', { name: 'Journey planner' });
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    if (width < 760) expect(box!.y).toBeGreaterThan(page.viewportSize()!.height * 0.3);
    // One representative mobile and desktop capture per browser/device configuration.
    if (width === (isMobile ? 390 : 1440)) {
      await page.screenshot({
        path: testInfo.outputPath(`layout-${width}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  });
}

test('country names are optional, lazy, remembered and do not overlap', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/country-labels-.*\.json$/.test(new URL(request.url()).pathname)) requests.push(request.url());
  });
  await page.goto('./?route=CPH-LHR-JFK');
  await expectRoute(page, ['CPH', 'LHR', 'JFK']);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await openDisplay(page);
  const toggle = page.getByRole('button', { name: 'Country names', exact: true });
  const names = page.locator('.country-label--country:visible');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(names).toHaveCount(0);
  expect(requests).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => names.count()).toBeGreaterThan(0);
  await expect(names.filter({ hasText: /^(Greenland|Brazil)$/ }).first()).toBeVisible();
  expect(requests).toHaveLength(1);

  const expectNoOverlap = async () => {
    const overlaps = await names.evaluateAll((elements) => {
      const boxes = elements.map((el) => ({ name: el.textContent, rect: el.getBoundingClientRect() }));
      const airports = [...document.querySelectorAll('.globe-marker')]
        .filter((el) => getComputedStyle(el).visibility !== 'hidden')
        .flatMap((el) => [...el.querySelectorAll('.globe-marker__label, .globe-marker__dot')])
        .map((el) => ({ name: el.textContent || 'airport dot', rect: el.getBoundingClientRect() }));
      const result: string[] = [];
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        for (const b of [...boxes.slice(i + 1), ...airports]) {
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
  };
  await expectNoOverlap();
  await page.screenshot({ path: testInfo.outputPath('country-names.png'), animations: 'disabled' });
  await page.reload();
  await openDisplay(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => names.count()).toBeGreaterThan(0);
  await expectNoOverlap();
  // Zooming re-lays out visible labels without permitting text collisions.
  await page.getByRole('application').press('+');
  await expect.poll(() => names.count()).toBeGreaterThan(0);
  await expectNoOverlap();
  await toggle.click();
  await expect(names).toHaveCount(0);
  await page.reload();
  await openDisplay(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(names).toHaveCount(0);
});

test('invalid country-name data stays decorative and warns only once', async ({ page }) => {
  const warnings: string[] = [];
  let requests = 0;
  page.on('console', (message) => {
    if (message.type() === 'warning' && message.text().includes('Country names could not be loaded'))
      warnings.push(message.text());
  });
  await page.route('**/country-labels-*.json', async (route) => {
    requests++;
    await route.fulfill({ json: { format: 1, labels: [['Invalid']] } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-LHR-JFK');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await openDisplay(page);
  const toggle = page.getByRole('button', { name: 'Country names', exact: true });
  await toggle.click();
  await expect.poll(() => warnings.length).toBe(1);
  await expect(page.locator('.country-label:visible')).toHaveCount(0);
  await toggle.click();
  await toggle.click();
  await page.keyboard.press('Escape');
  await startEditing(page);
  await page.getByRole('button', { name: 'Reverse route', exact: true }).click();
  await expectRoute(page, ['JFK', 'LHR', 'CPH']);
  expect(requests).toBe(1);
  expect(warnings).toHaveLength(1);
});
