import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';

const scheduled =
  '?route=CPH-LHR-JFK&dep1=2026-11-20T08:15&arr2=2026-11-20T09:05&dep2=2026-11-20T11:00&arr3=2026-11-20T13:50&clock=utc&daynight=0';
const followButton = (page: Page) => page.getByRole('button', { name: 'Follow aircraft', exact: true });
const globe = (page: Page) => page.getByRole('application');
const bar = (page: Page) => page.getByRole('region', { name: 'Timeline', exact: true });
const distance = async (page: Page) => Number(await globe(page).getAttribute('data-camera-distance'));

async function seek(page: Page, isoTime: string) {
  const slider = bar(page).getByRole('slider');
  await slider.fill(String(Date.parse(isoTime)));
}

async function planeComposition(page: Page) {
  return globe(page).evaluate((el) => {
    const plane = el.querySelector<HTMLElement>('.globe-plane')!;
    const transform = new DOMMatrix(getComputedStyle(plane).transform);
    const x = transform.m41;
    const y = transform.m42;
    const panel = document.querySelector('.panel')!.getBoundingClientRect();
    const desktop = document.querySelector('.layout-desktop') !== null;
    const left = desktop ? panel.right : 0;
    const bottom = desktop ? el.clientHeight : panel.top;
    return {
      opacity: plane.style.opacity,
      x: Math.abs(x - (left + el.clientWidth) / 2) / (el.clientWidth - left),
      y: Math.abs(y - bottom / 2) / bottom,
    };
  });
}

test('Follow aircraft approaches smoothly, tracks playback and exits on globe drag', async ({
  page,
  isMobile,
  context,
}, info) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`./${scheduled}&t=2026-11-20T12:00Z`);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await expect(globe(page)).toHaveAttribute('data-camera-motion', 'settled');
  const overview = await distance(page);
  await followButton(page).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(globe(page)).toHaveAttribute('data-follow', 'on');
  await expect(page).toHaveURL(/follow=1/);
  await expect(globe(page)).toHaveAttribute('data-camera-motion', 'moving');
  await expect(globe(page)).toHaveAttribute('data-camera-motion', 'settled');
  expect(await distance(page)).toBeLessThan(overview - 0.5);
  await expect(page.locator('.globe-plane')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('follow-paused.png') });

  await bar(page).getByRole('button', { name: 'Play journey' }).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  const slider = bar(page).getByRole('slider');
  await expect
    .poll(async () => Number(await slider.inputValue()), { timeout: 30000 })
    .toBeGreaterThan(Date.parse('2026-11-20T12:15Z'));
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  const composition = await planeComposition(page);
  expect(composition.opacity).toBe('1');
  expect(composition.x).toBeLessThan(0.3);
  expect(composition.y).toBeLessThan(0.3);
  await page.screenshot({ path: info.outputPath('follow-cruise.png') });
  const samples = await page.evaluate(
    () =>
      new Promise<{ opacities: string[]; positions: string[]; writes: number }>((resolve) => {
        const plane = document.querySelector<HTMLElement>('.globe-plane')!;
        const original = history.replaceState;
        let writes = 0;
        history.replaceState = function (...args) {
          writes++;
          return original.apply(this, args);
        };
        const opacities: string[] = [];
        const positions: string[] = [];
        const tick = () => {
          opacities.push(plane.style.opacity);
          positions.push(plane.style.transform);
          if (opacities.length < 24) requestAnimationFrame(tick);
          else {
            history.replaceState = original;
            resolve({ opacities, positions, writes });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(samples.opacities.every((opacity) => opacity === '1')).toBe(true);
  expect(new Set(samples.positions).size).toBeGreaterThan(10);
  expect(samples.writes).toBe(0);
  await expect
    .poll(async () => Number(await slider.inputValue()), { timeout: 30000 })
    .toBeGreaterThan(Date.parse('2026-11-20T13:00Z'));
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('follow-cruise-later.png') });
  await bar(page).getByRole('button', { name: 'Pause playback' }).click();
  await expect(globe(page)).toHaveAttribute('data-camera-motion', 'settled');

  const canvas = page.locator('canvas.globe-canvas');
  const bounds = (await canvas.boundingBox())!;
  const start = { x: bounds.width * (isMobile ? 0.5 : 0.7), y: bounds.height * 0.3 };
  if (isMobile) {
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (const offset of [20, 40, 60, 90]) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x + offset, y: start.y + offset / 3 }],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 90, start.y + 30, { steps: 12 });
    await page.mouse.up();
  }
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(globe(page)).toHaveAttribute('data-follow', 'off');
  await expect(page).not.toHaveURL(/follow=/);
  expect(await page.evaluate(() => localStorage.getItem('globehops:followAircraft'))).toBe('off');
  if (isMobile) {
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(bar(page)).toBeInViewport();
    expect(await bar(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(followButton(page)).toBeInViewport();
    await page.screenshot({ path: info.outputPath('follow-360.png') });
  }
});

test('Follow aircraft reduced motion pages between positions and remembers links', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`./${scheduled}&t=2026-11-20T10:00Z&follow=1`);
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(globe(page)).toHaveAttribute('data-camera-motion', 'settled');
  await expect(page.locator('.globe-plane')).toHaveCSS('opacity', '1');
  const groundDistance = await distance(page);
  await seek(page, '2026-11-20T14:00Z');
  await expect.poll(() => distance(page)).toBeGreaterThan(groundDistance + 0.2);
  await expect(globe(page)).toHaveAttribute('data-camera-motion', 'settled');
  const composition = await planeComposition(page);
  expect(composition.opacity).toBe('1');
  expect(composition.x).toBeLessThan(0.25);
  expect(composition.y).toBeLessThan(0.25);
  await page.screenshot({ path: info.outputPath('follow-reduced.png') });
  await page.reload();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('globehops:lastJourney'))).not.toContain('follow=');
  await globe(page).press('ArrowRight');
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await followButton(page).click();
  await page.getByRole('button', { name: 'Re-centre on the route' }).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await followButton(page).press('Space');
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(bar(page).getByRole('button', { name: 'Play journey' })).toBeVisible();
});

test('Follow aircraft waits for an aircraft and exits on wheel or flight selection', async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('globehops:followAircraft', 'on'));
  let releaseAirports = () => {};
  const airportsReady = new Promise<void>((resolve) => {
    releaseAirports = resolve;
  });
  await page.route('**/airports-*.json', async (route) => {
    await airportsReady;
    await route.continue();
  });
  await page.goto('./?route=CPH-LHR-JFK&follow=1');
  await expect(globe(page)).toHaveAttribute('data-follow', 'on');
  releaseAirports();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(globe(page)).toHaveAttribute('data-follow', 'on');
  await expect(globe(page)).toHaveAttribute('data-camera-motion', 'settled');
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.globe-plane')).toHaveCSS('opacity', '1');
  await bar(page).getByRole('button', { name: 'Pause playback' }).click();
  await bar(page).getByRole('button', { name: 'Close timeline' }).click();
  await expect(globe(page)).toHaveAttribute('data-follow', 'on');
  await expect(globe(page)).toHaveAttribute('data-camera-motion', 'settled');
  if (isMobile) await page.getByRole('button', { name: 'Show journey details' }).first().click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await bar(page).getByRole('button', { name: 'Pause playback' }).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('canvas.globe-canvas').dispatchEvent('wheel', { deltaY: -100 });
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await followButton(page).click();
  if (isMobile) await page.getByRole('button', { name: 'Show journey details' }).first().click();
  await page.getByRole('button', { name: /^Flight 2,/ }).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
});
