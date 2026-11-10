import sharp from 'sharp';
import { launcher, showControls, openPlanner, test, expect, openDisplay } from './fixtures.ts';
import type { Page } from '@playwright/test';

const scheduled =
  '?route=CPH-LHR-JFK&dep1=2026-11-20T08:15&arr2=2026-11-20T09:05&dep2=2026-11-20T11:00&arr3=2026-11-20T13:50';
const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline', exact: true });
const flight = (page: Page, number: number) => page.getByRole('button', { name: new RegExp(`^Flight ${number},`) });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('timeline shortcuts preserve native button and select keyboard actions', async ({ page }) => {
  await page.goto(`./${scheduled}&t=2026-11-20T07:15Z&clock=utc`);
  const bar = timeline(page);
  const next = bar.getByRole('button', { name: 'Next flight', exact: true });
  await next.focus();
  await next.press('Space');
  await expect(bar).toContainText('En route to New York JFK');
  await expect(bar.getByRole('button', { name: 'Play journey', exact: true })).toBeVisible();
  const previous = bar.getByRole('button', { name: 'Previous flight', exact: true });
  await previous.focus();
  await previous.press('Space');
  await expect(bar).toContainText('En route to London Heathrow');
  await bar.getByRole('combobox', { name: 'Clock time zone', exact: true }).press('k');
  await expect(bar.getByRole('button', { name: 'Play journey', exact: true })).toBeVisible();
  const slider = bar.getByRole('slider', { name: 'Journey time', exact: true });
  await slider.press('k');
  await expect(bar.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await slider.press('Space');
  await expect(bar.getByRole('button', { name: 'Play journey', exact: true })).toBeVisible();
  await bar.getByRole('button', { name: 'Close timeline', exact: true }).press('Space');
  await expect(bar).toHaveCount(0);
});

test('undated route keeps exact estimates and progressively discloses local schedule inputs', async ({
  page,
}, testInfo) => {
  await page.goto('./?route=CPH-LHR-JFK');
  const totals = page.getByRole('region', { name: 'Journey totals' });
  await expect(totals).toContainText('8h 40m flying · 1h 30m layover');
  await expect(totals).toContainText('≈ 10h 10m');
  await expect(timeline(page)).toHaveCount(0);
  await expect(page.getByLabel('Departure date', { exact: true })).toHaveCount(0);
  await flight(page, 1).click();
  const editor = page.getByRole('region', { name: 'Flight 1 times' });
  await expect(editor.getByLabel('Departure date', { exact: true })).toBeEnabled();
  await editor.getByLabel('Departure date', { exact: true }).fill('2026-11-20');
  await expect(editor).toContainText('Add a time');
  await editor.getByLabel('Departure time', { exact: true }).fill('08:15');
  await expect(page).toHaveURL(/dep1=2026-11-20T08:15/);
  await expect(flight(page, 1)).toContainText('08:15');
  await expect(flight(page, 1)).toContainText('→');
  await expect(totals).toContainText('Journey time');
  await expect(editor).toContainText(/estimated/i);
  await editor.getByLabel('Arrival time', { exact: true }).fill('09:05');
  await expect(editor.getByLabel('Arrival date', { exact: true })).toHaveValue('2026-11-20');
  await expect(page).toHaveURL(/arr2=2026-11-20T09:05/);
  await expect(editor).toContainText('Scheduled 1h 50m');
  await page.screenshot({ path: testInfo.outputPath('leg-schedule.png'), animations: 'disabled' });
  await flight(page, 1).click();
  await expect(editor).toHaveCount(0);
});

test('each flight offers its times in place, with airport zones and estimates for empty fields', async ({ page }) => {
  await page.goto('./?route=CPH-LHR-JFK');
  await expect(flight(page, 1)).toContainText('Add times');
  await expect(flight(page, 2)).toContainText('Add times');
  await flight(page, 2).click();
  const editor = page.getByRole('region', { name: 'Flight 2 times' });
  await expect(editor.getByRole('group', { name: 'Departure, local time' })).toContainText('LHR London');
  await expect(editor.getByRole('group', { name: 'Arrival, local time' })).toContainText(/EST · UTC−5|UTC−5/);
  await expect(editor).toContainText('Add date');
  await editor.getByLabel('Departure date', { exact: true }).fill('2026-11-20');
  await editor.getByLabel('Departure time', { exact: true }).fill('11:00');
  // The arrival is estimated from the departure in New York's local time and offered for editing.
  // 11:00 GMT plus the 7h 00m estimate is 18:00 GMT, 13:00 in New York.
  await expect(editor.getByLabel('Arrival time', { exact: true })).toHaveValue('13:00');
  await expect(editor.getByLabel('Arrival date', { exact: true })).toHaveValue('2026-11-20');
  await expect(editor.getByRole('group', { name: 'Arrival, local time' })).toContainText('≈Fri 20 Nov 2026');
  await expect(editor.locator('.when__note')).toHaveText('Estimated');
  await expect(flight(page, 2)).toContainText('11:00');
  await expect(flight(page, 1)).toContainText('→');
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(editor).toHaveCount(0);
  await expect(flight(page, 2)).toBeFocused();
});

test('the aircraft stays visible on every frame of a flight while playing', async ({ page }) => {
  await page.goto(`./${scheduled}&t=2026-11-20T07:20Z&clock=utc`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const bar = timeline(page);
  await expect(bar).toContainText('En route to London Heathrow');
  await bar.getByRole('combobox', { name: 'Playback speed' }).selectOption('1800');
  await bar.getByRole('button', { name: 'Play journey' }).click();
  const samples = await page.evaluate(
    () =>
      new Promise<{ opacity: string; transform: string }[]>((resolve) => {
        const plane = document.querySelector<HTMLElement>('.globe-plane')!;
        const out: { opacity: string; transform: string }[] = [];
        const tick = () => {
          out.push({ opacity: plane.style.opacity, transform: plane.style.transform });
          if (out.length < 40) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  await bar.getByRole('button', { name: 'Pause playback' }).click();
  expect(samples.filter((s) => s.opacity !== '1')).toEqual([]);
  expect(new Set(samples.map((s) => s.transform)).size).toBeGreaterThan(10);
});

test('scheduled playback advances, pauses, scrubs all phases, changes speed and seeks flights', async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto(`./${scheduled}&t=2026-11-20T07:15Z&clock=utc`);
  const bar = timeline(page);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('En route to London Heathrow');
  await expect(bar.getByRole('button', { name: 'Play journey' })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Layover in London' })).toHaveCount(0);
  await expect(page.locator('.layover')).toContainText('1h 55m layover');
  const slider = bar.getByRole('slider', { name: 'Journey time' });
  const initial = await slider.inputValue();
  const initialClock = await bar.locator('.time-bar__clock').innerText();
  await bar.getByRole('button', { name: 'Play journey' }).click();
  if (isMobile) await expect(page.getByRole('button', { name: 'Show journey details' }).first()).toBeVisible();
  // Playing is cinematic: a mini player until the controls are asked for.
  await expect(bar.getByRole('slider')).toHaveCount(0);
  await showControls(page);
  await expect.poll(() => slider.inputValue()).not.toBe(initial);
  await expect.poll(() => bar.locator('.time-bar__clock').innerText()).not.toBe(initialClock);
  await expect(page.locator('.globe-plane')).toHaveCSS('opacity', '1');
  await bar.getByRole('button', { name: 'Pause playback' }).click();
  const paused = await slider.inputValue();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => (++frames === 8 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
  expect(await slider.inputValue()).toBe(paused);
  await bar.getByRole('combobox', { name: 'Playback speed' }).selectOption('3600');
  await expect(page).toHaveURL(/speed=3600/);
  await slider.focus();
  await slider.press('Home');
  await expect(bar).toContainText('Ready to depart Copenhagen');
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', /Departs in/);
  await slider.press('End');
  await expect(bar).toContainText('Arrived at New York JFK');
  await bar.getByRole('button', { name: 'Previous flight' }).click();
  await expect(bar).toContainText('En route to New York JFK');
  await slider.focus();
  await slider.press('ArrowLeft');
  await expect(bar).toContainText('Connecting at London Heathrow');
  await bar.getByRole('button', { name: 'Previous flight' }).click();
  await expect(bar).toContainText('En route to London Heathrow');
  await bar.getByRole('button', { name: 'Next flight' }).click();
  await expect(bar).toContainText('En route to New York JFK');
  if (isMobile) await page.getByRole('button', { name: 'Show journey details' }).first().click();
  await flight(page, 1).click();
  await expect(bar).toContainText('En route to London Heathrow');
  await flight(page, 1).click();
  if (isMobile) await page.getByRole('button', { name: 'Hide journey details' }).click();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await page.screenshot({
    path: testInfo.outputPath(isMobile ? 'time-mobile.png' : 'time-desktop.png'),
    animations: 'disabled',
  });
  await bar.getByRole('button', { name: 'Close timeline' }).click();
  await expect(bar).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]t=/);
});

test('shared schedule restores paused instant and itinerary JSON canonicalises', async ({ page }) => {
  await page.goto(`./${scheduled}&t=2026-11-20T10:00Z&clock=utc`);
  await expect(timeline(page)).toContainText('Connecting at London Heathrow');
  // Docked on phones, the readout leaves out the weekday to stay on one line.
  await expect(timeline(page)).toContainText(/(?:Fri )?20 Nov, 10:00 UTC/);
  await expect(timeline(page).getByRole('button', { name: 'Play journey' })).toBeVisible();
  await page.reload();
  await expect(timeline(page)).toContainText('Connecting at London Heathrow');
  const document = {
    version: 1,
    stops: [
      { airport: 'CPH', departure: '2026-11-20T08:15' },
      { airport: 'LHR', arrival: '2026-11-20T09:05', departure: '2026-11-20T11:00' },
      { airport: 'JFK', arrival: '2026-11-20T13:50' },
    ],
    view: { time: '2026-11-20T10:00Z', clock: 'utc', play: true },
  };
  await page.goto(`./?itinerary=${Buffer.from(JSON.stringify(document)).toString('base64url')}`);
  await expect(page).toHaveURL(/route=CPH-LHR-JFK&dep1=/);
  await expect(page).not.toHaveURL(/itinerary=|play=/);
  await expect(timeline(page)).toContainText('Connecting at London Heathrow');
  await expect(timeline(page).getByRole('button', { name: 'Play journey' })).toBeVisible();
  await page.goto(`./${scheduled}&t=2026-11-20T05:15Z&clock=utc`);
  await expect(timeline(page)).toContainText('Ready to depart Copenhagen');
  await expect(timeline(page)).toContainText('Departs in 2h 00m');
  await expect(timeline(page).getByRole('slider')).toHaveValue(String(Date.parse('2026-11-20T05:15Z')));
  await page.goto(`./${scheduled}&t=2026-11-20T20:00Z&clock=utc`);
  await expect(timeline(page)).toContainText('Arrived at New York JFK');
  await expect(timeline(page).getByRole('slider')).toHaveValue(String(Date.parse('2026-11-20T20:00Z')));
  await timeline(page).getByRole('button', { name: 'Play journey' }).click();
  await expect(timeline(page)).toContainText('En route to London Heathrow');
});

test('repeated local hour offers offsets and nonexistent hour prevents playback', async ({ page }) => {
  await page.goto('./?route=JFK-LHR&dep1=2026-11-01T01:30');
  await flight(page, 1).click();
  const editor = page.getByRole('region', { name: 'Flight 1 times' });
  await expect(editor.getByRole('button', { name: /01:30.*UTC−4/ })).toBeVisible();
  await editor.getByRole('button', { name: /01:30.*UTC−5/ }).click();
  await expect(page).toHaveURL(/dep1=2026-11-01T01:30-05:00/);
  await page.goto('./?route=JFK-LHR&dep1=2026-03-08T02:30');
  await flight(page, 1).click();
  await expect(page.getByRole('region', { name: 'Flight 1 times' })).toContainText(/doesn.t exist/);
  await expect(timeline(page).getByRole('button', { name: 'Play journey' })).toBeDisabled();
  await expect(timeline(page)).toContainText("Fix flight 1's times to play");
});

test('day and night aligns with airport positions at opposite UTC instants and after orbiting', async ({
  page,
  isMobile,
}) => {
  // Four WebGL loads and composited captures can exceed a minute with software rendering.
  test.setTimeout(120_000);
  async function sample(time: string, orbit = false) {
    await page.goto(`./?route=JFK-DXB&t=${time}`);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await expect(timeline(page)).toBeVisible();
    await expect(timeline(page).getByRole('slider')).toHaveValue(String(Date.parse(time.split('&')[0])));
    await page.locator('.globe-labels').evaluate((el) => {
      (el as HTMLElement).style.opacity = '0';
    });
    const measure = async () => {
      const positions = await page.locator('.globe-marker').evaluateAll((nodes) =>
        nodes.map((node) => {
          const transform = new DOMMatrix(getComputedStyle(node).transform);
          return { code: node.querySelector('.globe-marker__label')?.textContent, x: transform.m41, y: transform.m42 };
        }),
      );
      const pixels = await page
        .locator('canvas.globe-canvas')
        .screenshot({ animations: 'disabled', style: '.hud-wrap { opacity: 0 !important; }' });
      const { data, info } = await sharp(pixels).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const scale = info.width / (await page.locator('canvas.globe-canvas').boundingBox())!.width;
      const lumas = positions.map((position) => {
        const values: number[] = [];
        for (let dy = -16; dy <= 16; dy++)
          for (let dx = -16; dx <= 16; dx++) {
            if (Math.hypot(dx, dy) < 7 || Math.hypot(dx, dy) > 16) continue;
            const x = Math.round((position.x + dx) * scale),
              y = Math.round((position.y + dy) * scale);
            const i = (y * info.width + x) * 3;
            values.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
          }
        values.sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)];
      });
      return {
        jfk: lumas[positions.findIndex((p) => p.code === 'JFK')],
        dxb: lumas[positions.findIndex((p) => p.code === 'DXB')],
      };
    };
    if (orbit) {
      // Sunlight is paused. Only the camera changes, so the view-space sun uniform must still update.
      const marker = page.locator('.globe-marker').first();
      const before = await marker.evaluate((el) => getComputedStyle(el).transform);
      const canvas = (await page.locator('canvas.globe-canvas').boundingBox())!;
      const x = canvas.x + canvas.width * 0.7;
      const y = canvas.y + canvas.height * 0.45;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 10, y - 30, { steps: 12 });
      await page.mouse.up();
      await expect.poll(() => marker.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
      await expect(timeline(page).getByRole('slider')).toHaveValue(String(Date.parse(time)));
    }
    // Poll the composited frame directly; a separate first capture doubles screenshot work.
    let result = { jfk: 0, dxb: 0 };
    await expect
      .poll(
        async () => {
          result = await measure();
          return time.includes('daynight=0')
            ? Math.min(result.jfk, result.dxb)
            : time.includes('18:00')
              ? result.jfk - result.dxb
              : result.dxb - result.jfk;
        },
        { message: 'Sunlit airport must be visibly brighter in the composited canvas' },
      )
      .toBeGreaterThan(time.includes('daynight=0') ? 45 : 20);
    return result;
  }

  const evening = await sample('2026-03-20T18:00Z');
  expect(evening.jfk - evening.dxb).toBeGreaterThan(20);
  if (!isMobile) {
    const orbited = await sample('2026-03-20T18:00Z', true);
    expect(orbited.jfk - orbited.dxb).toBeGreaterThan(20);
  }
  const morning = await sample('2026-03-21T06:00Z');
  expect(morning.dxb - morning.jfk).toBeGreaterThan(20);
  await openDisplay(page);
  await page.getByRole('button', { name: 'Day and night', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Day and night', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // Reload the same camera/time with the explicit off view, then compare both bright surfaces.
  const off = await sample('2026-03-21T06:00Z&daynight=0');
  expect(off.jfk).toBeGreaterThan(morning.jfk + 20);
  expect(off.dxb).toBeGreaterThan(45);
  expect(Math.abs(off.jfk - off.dxb)).toBeLessThan(65);
});

test('mobile timeline docks into the sheet, supports touch and stays usable at narrow and landscape sizes', async ({
  page,
  isMobile,
  browserName,
  context,
}, testInfo) => {
  test.skip(!isMobile, 'Touch layout on Pixel and iPhone.');
  await page.goto(`./${scheduled}&t=2026-11-20T07:15Z`);
  const sheet = page.getByRole('main', { name: 'Journey planner' });
  // One bottom surface: the timeline is the top of the journey sheet; the map tools stay below the top bar.
  await expect(sheet.getByRole('region', { name: 'Timeline', exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator('.map-tools').boundingBox())!.y).toBeGreaterThan(60);
  await timeline(page).getByRole('button', { name: 'Play journey' }).click();
  await expect(page.locator('.panel')).toHaveClass(/is-collapsed/);
  await timeline(page).getByRole('button', { name: 'Pause playback' }).click();
  // Collapsed, the sheet is only its handle and the timeline, flush with the bottom of the screen.
  await expect
    .poll(async () => {
      const b = (await timeline(page).boundingBox())!;
      const s = (await sheet.boundingBox())!;
      return Math.round(s.y + s.height - b.y - b.height);
    })
    .toBeLessThanOrEqual(1);
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(box.y + box.height)).toBe(viewport.height);
  expect(box.height).toBeLessThan(viewport.height * 0.35);
  const slider = timeline(page).getByRole('slider');
  const bounds = (await slider.boundingBox())!;
  const previous = await slider.inputValue();
  await page.touchscreen.tap(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2);
  await expect.poll(() => slider.inputValue()).not.toBe(previous);
  if (browserName === 'chromium') {
    const touchBefore = Number(await slider.inputValue());
    const session = await context.newCDPSession(page);
    const point = { x: bounds.x + bounds.width * 0.7, y: bounds.y + bounds.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    for (const fraction of [0.6, 0.5, 0.4, 0.3])
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...point, x: bounds.x + bounds.width * fraction }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
    await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(touchBefore);
  }
  await page.screenshot({ path: testInfo.outputPath('time-mobile.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(timeline(page)).toBeInViewport();
  expect(await timeline(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('time-320.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(timeline(page)).toBeInViewport();
  await expect(timeline(page).getByRole('button', { name: 'Play journey' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('time-landscape.png'), animations: 'disabled' });
});

test('remembered schedules omit transient time and view units; explicit empty route stays empty', async ({ page }) => {
  await page.goto(`./${scheduled}&t=2026-11-20T10:00Z&units=mi&clock=utc&speed=3600`);
  await expect(timeline(page)).toContainText('Connecting at London Heathrow');
  const saved = await page.evaluate(() => localStorage.getItem('globehops:lastJourney'));
  expect(saved).toContain('dep1=2026-11-20T08:15');
  expect(saved).not.toMatch(/[?&](t|play|units)=/);
  await page.goto('./');
  await expect(timeline(page)).toContainText('En route to London Heathrow');
  await expect(page).toHaveURL(/dep1=2026-11-20T08:15/);
  await openDisplay(page);
  await expect(page.getByRole('radio', { name: 'km', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => {
    history.pushState(null, '', '?route=CPH-LHR&units=mi');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('radio', { name: 'mi', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => {
    history.pushState(null, '', '?route=CPH-LHR');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('radio', { name: 'km', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.goto('./?route=');
  await expect(page).toHaveURL(/\/globehops\/$/);
  await expect(timeline(page)).toHaveCount(0);
  await openPlanner(page);
});

test('the time dial shows the globe at any moment without a route, and Live returns to now', async ({ page }) => {
  await page.goto('./?route=');
  const dial = page.getByRole('region', { name: 'Globe time', exact: true });
  const live = dial.getByRole('button', { name: 'Live', exact: true });
  const tape = dial.getByRole('slider', { name: 'Globe time', exact: true });
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/[?&]t=/);
  await dial.getByRole('combobox', { name: 'Clock time zone' }).selectOption('utc');
  await dial.getByLabel('Globe date', { exact: true }).fill('2026-03-20');
  await expect(live).toHaveAttribute('aria-pressed', 'false');
  await expect(tape).toHaveAttribute('aria-valuetext', /^Fri 20 Mar, \d\d:\d\d UTC$/);
  // Chosen moments are shareable once scrubbing pauses.
  await expect(page).toHaveURL(/[?&]t=2026-03-20T/);
  const before = Number(await tape.getAttribute('aria-valuenow'));
  await tape.press('ArrowRight');
  await expect(tape).toHaveAttribute('aria-valuenow', String(before + 15 * 60_000));
  await tape.press('PageDown');
  await expect(tape).toHaveAttribute('aria-valuetext', /^Thu 19 Mar, /);
  await tape.press('Home');
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/[?&]t=/);
  await expect(timeline(page)).toHaveCount(0);
  await (await openDisplay(page)).getByRole('button', { name: 'Day and night', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.goto('./');
  await openDisplay(page);
  await expect(page.getByRole('button', { name: 'Day and night', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('Find the Moon turns the globe until the Moon stands above it, named with place names, while the sky is shown', async ({
  page,
}) => {
  await page.goto('./?route=&t=2026-11-24T00:00Z');
  const display = await openDisplay(page);
  await display.getByRole('button', { name: 'Find the Moon', exact: true }).click();
  await expect(display).toBeHidden();
  // The Sun's and Moon's names are place names: they show only with Country names on.
  const label = page.locator('.globe-sky-label').filter({ hasText: 'Moon' });
  await expect(page.getByRole('application')).toHaveAttribute('data-camera-motion', 'settled');
  await expect(label).toHaveCSS('opacity', '0');
  await (await openDisplay(page)).getByRole('button', { name: 'Country names', exact: true }).click();
  await expect(label).toHaveCSS('opacity', '1');
  await (await openDisplay(page)).getByRole('button', { name: 'Day and night', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Find the Moon', exact: true })).toHaveCount(0);
  await expect(label).toHaveCSS('opacity', '0');
});

test('Live tracks a flight under way in real time, follows the aircraft and shares as live', async ({ page }) => {
  // London local time two hours ago: the estimated London–New York flight is under way.
  const departure = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/London',
    dateStyle: 'short',
    timeStyle: 'short',
  })
    .format(Date.now() - 2 * 3_600_000)
    .replace(' ', 'T');
  await page.goto(`./?route=LHR-JFK&dep1=${departure}`);
  const bar = timeline(page);
  const live = bar.getByRole('button', { name: 'Live', exact: true });
  await expect(live).toHaveAttribute('aria-pressed', 'false');
  await live.click();
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await expect(bar).toContainText('En route to New York JFK');
  await expect(bar.getByRole('button', { name: 'Follow aircraft', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).toHaveURL(/[?&]live=1/);
  await expect(page).not.toHaveURL(/[?&]t=/);
  // Leaving live keeps the moment on screen as an ordinary paused time.
  await live.click();
  await expect(live).toHaveAttribute('aria-pressed', 'false');
  await expect(page).toHaveURL(/[?&]t=/);
  await expect(page).not.toHaveURL(/live=1/);
  await page.goto(`./?route=LHR-JFK&dep1=${departure}&live=1`);
  await expect(timeline(page).getByRole('button', { name: 'Live', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(timeline(page)).toContainText('En route to New York JFK');
});

test('unsupported browser time zones disable local inputs while route editing and playback remain usable', async ({
  context,
  page,
  isMobile,
}) => {
  await context.addInitScript(() => {
    const Original = Intl.DateTimeFormat;
    Intl.DateTimeFormat = new Proxy(Original, {
      construct(target, args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
        if (args[1]?.timeZone === 'Europe/Copenhagen') throw new RangeError('Unsupported time zone');
        return Reflect.construct(target, args);
      },
    });
  });
  await page.goto('./?route=CPH-JFK&clock=CPH');
  await flight(page, 1).click();
  const editor = page.getByRole('region', { name: 'Flight 1 times' });
  await expect(editor.getByLabel('Departure date', { exact: true })).toBeDisabled();
  await expect(editor.getByLabel('Arrival date', { exact: true })).toBeEnabled();
  await expect(editor).toContainText('Time zone unavailable in this browser');
  await page.getByRole('button', { name: 'Play journey', exact: true }).click();
  await expect(timeline(page).getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await timeline(page).getByRole('button', { name: 'Pause playback' }).click();
  await expect(timeline(page).getByRole('slider')).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Show journey details' }).first().click();
  await expect(page.getByRole('button', { name: /Change airport/ }).first()).toBeVisible();
});

for (const [season, time] of [
  ['december-solstice', '2026-12-21T15:00:00Z'],
  ['march-equinox', '2026-03-20T15:00:00Z'],
] as const) {
  test(`sunlight globe review at ${season}`, async ({ page }, testInfo) => {
    await page.goto(`./?route=CPH-LHR-JFK&t=${time}`);
    await expect(page.locator('.stage')).toHaveClass(/is-ready/);
    await expect(timeline(page).getByRole('slider')).toHaveValue(String(Date.parse(time)));
    await expect(page.locator('.globe-marker__label')).toHaveText(['CPH', 'LHR', 'JFK']);
    await page.screenshot({ path: testInfo.outputPath(`sunlight-${season}.png`), animations: 'disabled' });
  });
}

test('playing is cinematic: the globe gets the screen until the controls are asked for', async ({
  page,
  isMobile,
}, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?route=CPH-LHR-JFK');
  await launcher(page).getByRole('button', { name: 'Play journey', exact: true }).click();
  const bar = timeline(page);
  // A mini player: pause, what is happening and the time; the planner, title and globe tools step aside.
  await expect(bar.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await expect(bar.getByRole('slider')).toHaveCount(0);
  await expect(page.locator('.topbar')).toHaveAttribute('inert', '');
  await expect(page.locator('.map-tools')).toHaveAttribute('inert', '');
  if (!isMobile) await expect(page.getByRole('main', { name: 'Journey planner' })).toHaveAttribute('inert', '');
  await page.screenshot({ path: `test-results/cinematic-${info.project.name}.png`, animations: 'disabled' });
  // Escape (or Show controls) brings the full timeline back while it plays; Hide controls returns to it.
  await page.keyboard.press('Escape');
  await expect(bar.getByRole('slider')).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await bar.getByRole('button', { name: 'Hide controls', exact: true }).click();
  await expect(bar.getByRole('slider')).toHaveCount(0);
  // Pausing ends it.
  await bar.getByRole('button', { name: 'Pause playback' }).click();
  await expect(bar.getByRole('slider')).toBeVisible();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert');
});
