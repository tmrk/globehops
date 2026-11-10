import type { Page } from '@playwright/test';
import { test, expect, stopButtons, airportField } from './fixtures.ts';
import { installTools, invoke, ready } from './webTools.ts';

const dated =
  '?route=BUD-JFK&dep1=2026-11-20T08:00&arr2=2026-11-20T12:00&b.route=BUD-LHR-JFK&b.dep1=2026-11-20T07:00&b.arr2=2026-11-20T08:30&b.dep2=2026-11-20T10:00&b.arr3=2026-11-20T13:00&clock=utc';
const bar = (page: Page) => page.getByRole('region', { name: 'Timeline', exact: true });

async function settlePaint(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

test.beforeEach(async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (isMobile) await page.setViewportSize({ width: 390, height: 844 });
});

test('add, edit, share and remove an alternative without changing journey A', async ({ page }, info) => {
  await page.goto('./?route=BUD-JFK');
  await page.getByRole('button', { name: 'Compare journeys' }).click();
  await expect(page.getByRole('heading', { name: 'Compare journeys' })).toBeVisible();
  const a = page.getByRole('tab', { name: 'A BUD → JFK' });
  const b = page.getByRole('tab', { name: 'B Choose airports' });
  await expect(b).toHaveAttribute('aria-selected', 'true');
  // A new journey starts empty, never as a copy, and offers different routes between A's airports.
  await expect(stopButtons(page)).toHaveCount(0);
  const similar = page.getByRole('list', { name: 'Similar routes' }).getByRole('button');
  await expect(similar).toHaveText([/^BUD → LHR → JFK/, /^BUD → ZRH → JFK/, /^BUD → CPH → JFK/]);
  await b.focus();
  await b.press('Home');
  await expect(a).toBeFocused();
  await a.press('ArrowRight');
  await expect(b).toBeFocused();
  await similar.first().click();
  await expect(page.getByRole('list', { name: 'Similar routes' })).toHaveCount(0);
  await expect(stopButtons(page)).toHaveCount(3);
  await expect(stopButtons(page).nth(1)).toHaveAccessibleName(/\(LHR\)/);
  const summary = page.getByRole('region', { name: 'Journey comparison' });
  await expect(summary.locator('.compare-summary__row')).toHaveCount(2);
  await expect(summary.locator('.compare-summary__row').nth(0)).toContainText('Fastest');
  await expect(summary.locator('.compare-summary__row').nth(1)).toContainText(/\+\d+h/);
  await expect(page).toHaveURL(/b.route=BUD-LHR-JFK/);
  const strips = await summary
    .locator('.comparison-strip')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ left: node.getBoundingClientRect().left, width: node.getBoundingClientRect().width })),
    );
  expect(strips[0]).toEqual(strips[1]);
  await expect(page).toHaveTitle('Compare: BUD → JFK, BUD → LHR → JFK · GlobeHops');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await settlePaint(page);
  await page.screenshot({ path: `test-results/compare-editing-${info.project.name}.png`, animations: 'disabled' });
  // The picker must remain usable with the taller comparison ticket.
  await stopButtons(page).nth(1).click();
  await airportField(page).fill('LHR');
  await expect(page.getByRole('option', { name: /^LHR\b/ })).toBeVisible();
  await settlePaint(page);
  await page.screenshot({ path: `test-results/compare-picker-${info.project.name}.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(airportField(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove journey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your journey', exact: true })).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page).toHaveURL(/\?route=BUD-JFK$/);
  await expect(page.getByRole('region', { name: 'Journey totals' })).toBeVisible();
  // One Reset clears every compared journey, its times and the timeline at once.
  await page.goto('./?route=BUD-JFK&b.route=BUD-LHR-JFK&t=2026-12-01T10:00Z');
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset journey', exact: true }).click();
  await page
    .getByRole('group', { name: /^Reset the journey\?/ })
    .getByRole('button', { name: 'Reset' })
    .click();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Timeline' })).toHaveCount(0);
  await expect(stopButtons(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/route=|b\./);
});

test('all journeys play on one axis with live lanes and overlapping aircraft', async ({ page, isMobile }, info) => {
  await page.goto(`./${dated}`);
  await expect(bar(page)).toBeVisible();
  // Close the auto-open timetable to start through the primary ticket action.
  await bar(page).getByRole('button', { name: 'Close timeline' }).click();
  await page.getByRole('button', { name: 'Play all', exact: true }).click();
  await expect(bar(page).getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await bar(page).getByRole('button', { name: 'Pause playback' }).click();
  const lanes = bar(page).locator('.comparison-lane');
  await expect(lanes).toHaveCount(2);
  const slider = bar(page).getByRole('slider', { name: 'Journey time' });
  await slider.focus();
  await slider.press('Home');
  await expect(lanes.nth(0)).toContainText('Departs in 1h 30m');
  await expect(lanes.nth(1)).toContainText('Departs in 30m');
  await bar(page).getByRole('button', { name: 'Next flight' }).click();
  await expect(lanes.nth(1)).toContainText('Flying to London');
  await slider.focus();
  await slider.press('ArrowRight');
  // At the next departure A flies while B is still flying its first leg.
  await bar(page).getByRole('button', { name: 'Next flight' }).click();
  await expect(lanes.nth(0)).toContainText('Flying to New York');
  await expect(lanes.nth(1)).toContainText('Flying to London');
  await expect(page.locator('.globe-plane:has(.globe-plane__tag)')).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator('.globe-plane')
        .evaluateAll(
          (nodes) =>
            nodes.filter((node) => getComputedStyle(node).opacity === '1' && getComputedStyle(node).display !== 'none')
              .length,
        ),
    )
    .toBeGreaterThanOrEqual(2);
  await bar(page).getByRole('button', { name: 'Next flight' }).click();
  await slider.focus();
  await slider.press('ArrowLeft');
  await expect(lanes.nth(1)).toContainText('Layover in London');
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await settlePaint(page);
  await page.screenshot({ path: `test-results/compare-playback-${info.project.name}.png`, animations: 'disabled' });
  if (isMobile) {
    const bounds = await page.locator('.panel').boundingBox();
    expect(bounds!.y).toBeGreaterThan(844 * 0.45);
  }
  await slider.focus();
  await slider.press('End');
  await expect(bar(page)).toContainText('A arrives first');
  await expect(lanes.nth(0)).toContainText('Landed in New York · 17:00');
  await expect(lanes.nth(1)).toContainText('Landed in New York · 18:00');
  await lanes.nth(1).click();
  await expect(lanes.nth(1)).toHaveAttribute('aria-pressed', 'true');
  // All route airports appear in the clock menu, even with journey B active.
  await expect(
    bar(page).getByRole('combobox', { name: 'Clock time zone' }).getByRole('option', { name: 'London time' }),
  ).toHaveCount(1);
  // A visit, reload and back/forward retain both journeys and their schedules.
  await expect(page).toHaveURL(/b.route=BUD-LHR-JFK/);
  await page.reload();
  await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(2);
  await page.goto('./');
  await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(2);
  await expect(page).toHaveURL(/b.dep2=2026-11-20T10:00/);
  await page.evaluate(() => {
    history.pushState(null, '', '?route=CPH-JFK');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(2);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Your journey', exact: true })).toBeVisible();
});

test('WebMCP applies labelled comparisons, reports them, shares them and resets to a single route', async ({
  page,
}) => {
  await installTools(page);
  await page.goto('./?route=CPH-JFK');
  await ready(page);
  await invoke(page, 'compare_journeys', {
    journeys: [
      {
        label: 'Direct',
        stops: [
          { airport: 'BUD', departure: '2026-11-20T08:00' },
          { airport: 'JFK', arrival: '2026-11-20T12:00' },
        ],
      },
      { label: 'Via London', stops: [{ airport: 'BUD' }, { airport: 'LHR' }, { airport: 'JFK' }] },
    ],
    view: { clock: 'LHR' },
  });
  await expect(page.getByRole('tab', { name: 'A Direct' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'B Via London' })).toBeVisible();
  await expect(bar(page).locator('.comparison-lane')).toHaveCount(2);
  const state = await invoke<{
    comparison: { journeys: { id: string; anchor: string }[]; comparison: { fastest: string }; url: string };
  }>(page, 'get_journey');
  expect(state.comparison.journeys).toMatchObject([
    { id: 'A', anchor: 'entered' },
    { id: 'B', anchor: 'assumed' },
  ]);
  const shared = await invoke<{ url: string }>(page, 'get_share_link');
  expect(shared.url).toContain('b.route=BUD-LHR-JFK');
  expect(shared.url).toContain('b.label=Via%20London');
  await invoke(page, 'set_view', { clock: 'LHR' });
  await page.getByRole('tab', { name: 'B Via London' }).click();
  await invoke(page, 'select_flight', { leg: 2 });
  await expect(page.getByRole('region', { name: 'Flight 2 times' })).toBeVisible();
  const active = await invoke<{ valid: boolean; legs: { departure: { utc: string } }[] }>(page, 'get_journey');
  expect(active.valid).toBe(true);
  expect(active.legs[0].departure.utc).toBe('2026-11-20T07:00Z');
  await invoke(page, 'set_view', { leg: 1 });
  await expect(page.getByRole('tab', { name: 'A Direct' })).toHaveAttribute('aria-selected', 'true');
  const framed = await invoke<{ url: string }>(page, 'get_share_link');
  expect(new URL(framed.url).searchParams.get('leg')).toBe('1');
  await invoke(page, 'set_route', { route: 'CPH-JFK' });
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page).toHaveURL(/\?route=CPH-JFK$/);
});

test('four journeys keep the phone globe visible and tabs reachable', async ({ page, isMobile }, info) => {
  await page.goto('./?route=BUD-JFK&b.route=BUD-LHR-JFK&c.route=BUD-FRA-JFK&d.route=BUD-CDG-JFK');
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Add journey' })).toHaveCount(0);
  await page.getByRole('tab').first().focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab').last()).toBeFocused();
  // WebKit rounds the scroll edge to device pixels.
  await expect(page.getByRole('tab').last()).toBeInViewport({ ratio: 0.99 });
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await settlePaint(page);
  await page.screenshot({ path: `test-results/compare-four-editing-${info.project.name}.png`, animations: 'disabled' });
  if (isMobile) {
    const scroll = await page.locator('.panel__scroll').boundingBox();
    expect(scroll!.height).toBeGreaterThan(100);
  }
  await page.getByRole('button', { name: 'Play all' }).click();
  await expect(bar(page).locator('.comparison-lane')).toHaveCount(4);
  await bar(page).getByRole('button', { name: 'Pause playback' }).click();
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await settlePaint(page);
  await page.screenshot({ path: `test-results/compare-four-${info.project.name}.png`, animations: 'disabled' });
  if (isMobile) {
    const bounds = await page.locator('.panel').boundingBox();
    expect(bounds!.y).toBeGreaterThan(844 * 0.45);
  }
});

test('an invalid alternative points to its own flight editor and blocks playback', async ({ page }) => {
  await page.goto('./?route=BUD-JFK&dep1=2026-11-20T08:00&b.route=JFK-LHR&b.dep1=2026-03-08T02:30');
  await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
  await expect(bar(page).getByRole('button', { name: 'Play all' })).toBeDisabled();
  await bar(page).getByRole('button', { name: "Fix flight 1's times to play" }).click();
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Flight 1 times' })).toContainText(/doesn.t exist/);
});

test('compares round trips: a way home for every journey, out and back side by side', async ({ page }, info) => {
  await page.goto('./?route=BUD-FRA-JFK&b.route=BUD-JFK');
  await page.getByRole('button', { name: 'Add return flights' }).click();
  await expect(page.getByRole('heading', { name: 'Compare trips' })).toBeVisible();
  const trips = page.getByRole('tablist', { name: 'Trips' }).getByRole('tab');
  await expect(trips).toHaveText(['Avia FRA', 'BNonstop']);
  const ways = page.getByRole('tablist', { name: 'Journeys of trip A' }).getByRole('tab');
  await expect(ways).toHaveText(['Outbound', 'Return']);
  await expect(ways.nth(1)).toHaveAttribute('aria-selected', 'true');
  // Each trip comes home its own way, ready for its own connections and times.
  await expect(stopButtons(page)).toHaveCount(2);
  await expect(stopButtons(page).nth(0)).toHaveAccessibleName(/\(JFK\)/);
  await expect(page.getByText('≈ 7 days in New York')).toBeVisible();
  await expect(page).toHaveURL(/\?route=BUD-FRA-JFK&2\.route=JFK-BUD&b\.route=BUD-JFK&b\.2\.route=JFK-BUD$/);
  const rows = page.getByRole('region', { name: 'Trip comparison' }).locator('.trip-compare__row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveAccessibleName(/^B Nonstop: Outbound ≈ .+, Return ≈ .+, Fastest$/);
  await expect(rows.nth(0)).toContainText(/\+\d+h/);
  // Switching trips keeps the way being edited, and switching ways keeps the trip.
  await trips.nth(1).click();
  const bWays = page.getByRole('tablist', { name: 'Journeys of trip B' }).getByRole('tab');
  await expect(bWays.nth(1)).toHaveAttribute('aria-selected', 'true');
  await bWays.nth(1).press('ArrowLeft');
  await expect(bWays.nth(0)).toBeFocused();
  await expect(stopButtons(page).nth(0)).toHaveAccessibleName(/\(BUD\)/);
  await expect(trips.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveTitle('Compare: BUD → JFK → BUD, BUD → JFK → BUD · GlobeHops');
  // The link reopens the same comparison.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Compare trips' })).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.stage')).toHaveClass(/is-ready/);
  await settlePaint(page);
  await page.screenshot({ path: `test-results/compare-trips-${info.project.name}.png`, animations: 'disabled' });
  // Without the returns, the trips are compared journeys again.
  await page.getByRole('tablist', { name: 'Journeys of trip A' }).getByRole('tab', { name: 'Return' }).click();
  await page.getByRole('button', { name: 'Remove return flights' }).click();
  await expect(page.getByRole('heading', { name: 'Compare journeys' })).toBeVisible();
  await expect(page).toHaveURL(/\?route=BUD-FRA-JFK&b\.route=BUD-JFK$/);
});

test('compared trips share one clock and skip the stay every traveller shares', async ({ page }, info) => {
  const trips =
    '?route=BUD-FRA-JFK&dep1=2026-12-01T07:10&2.route=JFK-BUD&2.dep1=2026-12-10T18:00&b.route=BUD-JFK&b.2.route=JFK-BUD';
  await page.goto(`./${trips}&t=2026-12-05T12:00Z`);
  const lanes = bar(page).getByRole('group', { name: 'Trips' }).getByRole('button');
  await expect(lanes).toHaveCount(2);
  await expect(lanes.nth(0)).toContainText('Staying in New York');
  await expect(lanes.nth(1)).toContainText('Staying in New York');
  await expect(bar(page).locator('.time-bar__break-label')).toHaveText('9 days');
  // The untimed trip travels on the same days as the timed one.
  await expect(page.getByRole('tablist', { name: 'Journeys of trip A' }).getByRole('tab')).toHaveText([
    'OutboundTue 1 Dec',
    'ReturnThu 10 Dec',
  ]);
  await page.getByRole('tablist', { name: 'Trips' }).getByRole('tab').nth(1).click();
  await expect(page.getByRole('tablist', { name: 'Journeys of trip B' }).getByRole('tab')).toHaveText([
    'Outbound≈ Tue 1 Dec',
    'Return≈ Thu 10 Dec',
  ]);
  await page.screenshot({ path: `test-results/compare-trips-stay-${info.project.name}.png`, animations: 'disabled' });
  await page.goto(`./${trips}&t=2026-12-01T19:30Z`);
  await bar(page).getByRole('button', { name: 'Play all' }).click();
  await expect(lanes.nth(0)).toContainText(/Return · /, { timeout: 30_000 });
  await expect(bar(page).locator('.time-bar__readout')).toContainText(/1[01] Dec/);
});
