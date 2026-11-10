import { readFileSync } from 'node:fs';
import { installTools, invoke, ready } from './webTools.ts';
import { test, expect, openDisplay, airportField, basePath } from './fixtures.ts';
import { handleTool } from '../mcp/tools.ts';
import { context } from '../mcp/data.ts';
import type { ItineraryDocument } from '../src/agent/itinerary.ts';

interface Snapshot {
  stops: { code: string }[];
  legs: {
    from: string;
    to: string;
    departure: { utc: string; local: string } | null;
    arrival: { utc: string; local: string } | null;
  }[];
  transfers: { minutes: number }[];
  valid: boolean;
  totals: { flights: number };
  url: string;
  view: {
    time: string;
    play: boolean;
    speed: number | string;
    clock: string;
    units: string;
    dayNight: boolean;
    follow: boolean;
    names: boolean;
    borders: boolean;
    lang: string;
    leg: number | null;
  };
}
const examples = JSON.parse(readFileSync(new URL('../public/agent/examples.json', import.meta.url), 'utf8')) as {
  title: string;
  itinerary: ItineraryDocument & { stops: NonNullable<ItineraryDocument['stops']> };
  url: string;
  itineraryParamUrl: string;
}[];
const localUrl = (value: string) => {
  const url = new URL(value);
  return url.pathname + url.search;
};

test('generated examples and MCP visualization restore route, local times and the full view', async ({
  page,
}, info) => {
  await installTools(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const title of ['Fully scheduled via Heathrow', 'Crossing the date line', 'Visualisation options']) {
    const example = examples.find((example) => example.title === title)!;
    for (const url of [example.url, example.itineraryParamUrl]) {
      await page.goto(localUrl(url));
      await ready(page);
      const state = await invoke<Snapshot>(page, 'get_journey');
      expect(state.valid).toBe(true);
      expect(state.stops.map((stop) => stop.code)).toEqual(example.itinerary.stops.map((stop) => stop.airport));
      for (const [i, stop] of example.itinerary.stops.entries()) {
        if (stop.departure) expect(state.legs[i].departure!.local).toBe(stop.departure);
        if (stop.arrival) expect(state.legs[i - 1].arrival!.local).toBe(stop.arrival);
      }
      if (example.itinerary.view) {
        expect(state.view).toMatchObject({ ...example.itinerary.view, time: '2026-11-20T09:30:00.000Z' });
        await expect(page.getByRole('slider')).toHaveValue(String(Date.parse('2026-11-20T09:30Z')));
        await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
      }
    }
  }
  const visual = handleTool(context, 'visualize_route', {
    itinerary: {
      version: 1,
      stops: [
        { airport: 'CPH', departure: '2026-11-20T08:15' },
        { airport: 'LHR', layoverMinutes: 180 },
        { airport: 'JFK' },
      ],
    },
    view: {
      time: '2026-11-20T10:00Z',
      speed: 7200,
      clock: 'LHR',
      units: 'mi',
      dayNight: false,
      follow: true,
      lang: 'hu',
      names: true,
      borders: false,
      leg: 2,
    },
  });
  expect(visual.isError).not.toBe(true);
  for (const url of [visual.structuredContent!.url, visual.structuredContent!.itineraryParamUrl]) {
    await page.goto(localUrl(url as string));
    await ready(page);
    const state = await invoke<Snapshot>(page, 'get_journey');
    expect(state.view).toMatchObject({
      time: '2026-11-20T10:00:00.000Z',
      speed: 7200,
      clock: 'LHR',
      units: 'mi',
      dayNight: false,
      follow: true,
      lang: 'hu',
      names: true,
      borders: false,
      leg: 2,
    });
    expect(state.transfers[0].minutes).toBe(180);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
    await expect(page.getByRole('application')).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('agent-route-desktop.png'), animations: 'disabled' });
});

test('live tools validate atomically, patch state, preserve preferences and expose live playback', async ({
  page,
}, info) => {
  await installTools(page, 'modern');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('globehops:countryNames', 'off');
    localStorage.setItem('globehops:borders', 'on');
    localStorage.setItem('globehops:followAircraft', 'off');
    localStorage.setItem('globehops:unit', 'km');
    localStorage.setItem('globehops:daynight', 'on');
  });
  await page.goto(
    './?route=CPH-LHR_180-JFK&dep1=2026-11-20T08:15&t=2026-11-20T10:00Z&names=1&borders=0&follow=1&units=mi&daynight=0&leg=2',
  );
  await ready(page);
  const initial = await invoke<Snapshot>(page, 'get_journey');
  expect(initial.view).toMatchObject({
    names: true,
    borders: false,
    follow: true,
    units: 'mi',
    dayNight: false,
    leg: 2,
  });
  const bad = await page.evaluate(() => window.globeAgentTools.set_route.execute({ route: 'CPH-ZZZ-JFK' }));
  expect(bad.isError).toBe(true);
  expect(bad.content[0].text).toContain('Unknown airport ZZZ');
  expect((await invoke<Snapshot>(page, 'get_journey')).stops).toEqual(initial.stops);
  await invoke(page, 'set_view', {
    t: '2026-11-20T12:00Z',
    speed: 1800,
    clock: 'utc',
    lang: 'hu',
    names: false,
    borders: true,
    dayNight: true,
    follow: false,
    units: 'km',
  });
  await expect.poll(async () => (await invoke<Snapshot>(page, 'get_journey')).view.lang).toBe('hu');
  expect((await invoke<Snapshot>(page, 'get_journey')).view).toMatchObject({
    time: '2026-11-20T12:00:00.000Z',
    speed: 1800,
    clock: 'utc',
    names: false,
    borders: true,
    dayNight: true,
    follow: false,
    units: 'km',
    leg: 2,
  });
  await invoke(page, 'select_flight', { leg: 1 });
  expect((await invoke<Snapshot>(page, 'get_journey')).view.leg).toBe(1);
  await invoke(page, 'select_flight', { leg: null });
  expect((await invoke<Snapshot>(page, 'get_journey')).view.leg).toBeNull();
  const shared = await invoke<{ url: string }>(page, 'get_share_link');
  expect(new URL(shared.url).pathname).toBe(`${basePath}hu/`);
  expect(shared.url).toContain('t=2026-11-20T12:00Z');
  expect(
    await page.evaluate(() =>
      Object.fromEntries(
        ['countryNames', 'borders', 'followAircraft', 'unit', 'daynight', 'locale'].map((key) => [
          key,
          localStorage.getItem(`globehops:${key}`),
        ]),
      ),
    ),
  ).toEqual({ countryNames: 'off', borders: 'on', followAircraft: 'off', unit: 'km', daynight: 'on', locale: 'en' });
  await invoke(page, 'set_view', { play: true });
  await expect.poll(async () => (await invoke<Snapshot>(page, 'get_journey')).view.play).toBe(true);
  const whilePlaying = await invoke<{ url: string }>(page, 'get_share_link');
  expect(whilePlaying.url).toContain('play=1');
  expect(whilePlaying.url).toContain('&t=');
  await expect(page).not.toHaveURL(/[?&]t=/);
  await invoke(page, 'set_view', { play: false });
  expect((await invoke<Snapshot>(page, 'get_journey')).view.play).toBe(false);
  await invoke(page, 'set_route', {
    itinerary: {
      version: 1,
      stops: [{ airport: 'AKL', departure: '2026-11-20T00:30' }, { airport: 'HNL' }],
      view: { lang: 'en', names: true },
    },
  });
  await expect
    .poll(async () => (await invoke<Snapshot>(page, 'get_journey')).stops.map((s) => s.code))
    .toEqual(['AKL', 'HNL']);
  expect((await invoke<Snapshot>(page, 'get_journey')).legs[0].departure!.utc).toBe('2026-11-19T11:30Z');
  await invoke(page, 'set_view', { play: true });
  await expect.poll(async () => (await invoke<Snapshot>(page, 'get_journey')).view.play).toBe(true);
  await invoke(page, 'set_view', { play: false });
  expect(await page.evaluate(() => window.globeAgentRegistrations)).toBe(7);
  await page.screenshot({ path: info.outputPath('agent-edited-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 412, height: 915 });
  await expect(page.getByRole('application')).toBeVisible();
  await page.screenshot({ path: info.outputPath('agent-edited-phone.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /\(AKL\).*Change airport/ }).click();
  await expect(airportField(page)).toBeFocused();
  await page.screenshot({ path: info.outputPath('agent-picker-phone.png'), animations: 'disabled' });
});

for (const mode of ['provide', 'broken'] as const)
  test(`optional WebMCP ${mode} API leaves the app usable`, async ({ page }) => {
    await installTools(page, mode);
    await page.goto('./?route=CPH-JFK');
    await expect(
      page.getByRole('list', { name: 'Journey stops' }).getByRole('button', { name: /Change airport$/ }),
    ).toHaveCount(2);
    if (mode === 'provide') {
      await ready(page);
      expect((await invoke<Snapshot>(page, 'get_journey')).stops.map((s) => s.code)).toEqual(['CPH', 'JFK']);
    } else {
      await expect.poll(() => page.evaluate(() => window.globeAgentRemovals)).toBe(2);
      expect(await page.evaluate(() => Object.keys(window.globeAgentTools))).toEqual([]);
    }
    const menu = await openDisplay(page);
    await expect(menu.getByRole('radiogroup', { name: 'Distance unit' })).toBeVisible();
  });

test('static discovery describes the deployed locale pages, schema, examples and dataset', async ({
  page,
  request,
}) => {
  await page.goto('./hu/?route=CPH-JFK');
  const capabilityHref = await page.locator('link[rel="describedby"]').getAttribute('href');
  const helpHref = await page.locator('link[rel="help"]').getAttribute('href');
  expect(capabilityHref).toBe(`${basePath}agent/capabilities.json`);
  expect(helpHref).toBe(`${basePath}llms.txt`);
  const capabilities = (await (await request.get(capabilityHref!)).json()) as {
    locales: string[];
    visualisationOptions: string[];
    webMcp: { tools: string[] };
    mcp: { resources: string[] };
  };
  expect(capabilities.locales).toEqual(['en', 'hu', 'sv']);
  expect(capabilities.visualisationOptions).toEqual(
    expect.arrayContaining(['follow', 'lang', 'names', 'borders', 'leg']),
  );
  expect(capabilities.webMcp.tools).toHaveLength(7);
  expect(capabilities.mcp.resources).toHaveLength(4);
  const schema = (await (await request.get(`${basePath}agent/itinerary.schema.json`)).json()) as {
    properties: { view: { properties: object } };
  };
  expect(Object.keys(schema.properties.view.properties)).toEqual(
    expect.arrayContaining(['follow', 'lang', 'names', 'borders', 'leg']),
  );
  const dataset = (await (await request.get(`${basePath}agent/dataset.json`)).json()) as {
    app: { version: string; commit: string };
    airports: { generatedAt: string };
    timeZones: { release: string };
  };
  expect(dataset.app.version).toBe(
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
  );
  expect(dataset.app.commit).toMatch(/^[a-f0-9]{7}$/);
  expect(dataset.airports.generatedAt).toBeTruthy();
  expect(dataset.timeZones.release).toBe('2026f');
  expect(await (await request.get(helpHref!)).text()).toContain('Experimental browser tools (WebMCP)');
  const jsonLd = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}') as {
    potentialAction: { target: { urlTemplate: string } };
  };
  await page.goto(localUrl(jsonLd.potentialAction.target.urlTemplate.replace('{route}', 'CPH-JFK')));
  await expect(
    page.getByRole('list', { name: 'Journey stops' }).getByRole('button', { name: /Change airport$/ }),
  ).toHaveCount(2);
});

test('view-only links validate flight bounds and explicit defaults survive reload', async ({ page }) => {
  await installTools(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('globehops:followAircraft', 'on');
    localStorage.setItem('globehops:daynight', 'off');
  });
  await page.goto('./?route=CPH-JFK&follow=0&daynight=1&names=0&borders=1');
  await ready(page);
  expect((await invoke<Snapshot>(page, 'get_journey')).view).toMatchObject({
    follow: false,
    dayNight: true,
    names: false,
    borders: true,
  });
  await page.reload();
  await ready(page);
  expect((await invoke<Snapshot>(page, 'get_journey')).view).toMatchObject({
    follow: false,
    dayNight: true,
    names: false,
    borders: true,
  });
  const styled = handleTool(context, 'visualize_route', { route: 'CPH-JFK', view: { dayNight: true, names: true } });
  expect(new URL(styled.structuredContent!.url as string).searchParams.has('follow')).toBe(false);
  for (const url of [styled.structuredContent!.url, styled.structuredContent!.itineraryParamUrl]) {
    await page.goto(localUrl(url as string));
    await ready(page);
    expect((await invoke<Snapshot>(page, 'get_journey')).view).toMatchObject({
      follow: true,
      dayNight: true,
      names: true,
    });
  }
  await invoke(page, 'select_flight', { leg: 1 });
  expect((await invoke<Snapshot>(page, 'get_journey')).view.follow).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('globehops:followAircraft'))).toBe('on');
  await page.goto('./?leg=1');
  await ready(page);
  expect((await invoke<Snapshot>(page, 'get_journey')).view.leg).toBe(1);
  await page.goto('./?leg=9');
  await ready(page);
  expect((await invoke<Snapshot>(page, 'get_journey')).view.leg).toBeNull();
  await invoke(page, 'set_route', { route: '' });
  expect((await invoke<Snapshot>(page, 'get_journey')).stops).toEqual([]);
  const shared = await invoke<{ url: string }>(page, 'get_share_link');
  expect(new URL(shared.url).searchParams.get('route')).toBe('');
  await page.goto(localUrl(shared.url));
  await ready(page);
  expect((await invoke<Snapshot>(page, 'get_journey')).stops).toEqual([]);
});

test('live import parses paths, compares through App and leaves the plan unchanged on errors', async ({ page }) => {
  await installTools(page);
  await page.goto('./?route=CPH-ARN');
  await ready(page);
  const imported = await invoke<{ flights: { from: string; to: string; points: number }[]; url: string }>(
    page,
    'import_route',
    {
      text: 'EGLL CPT KJFK',
      mode: 'compare',
    },
  );
  expect(imported.flights).toMatchObject([{ from: 'LHR', to: 'JFK', points: 3 }]);
  expect(new URL(imported.url).searchParams.get('b.route')).toBe('LHR-JFK');
  expect(new URL(imported.url).searchParams.has('b.trk1')).toBe(true);
  const before = await invoke<Snapshot>(page, 'get_journey');
  await expect(invoke(page, 'import_route', { text: '<gpx/>' })).rejects.toThrow();
  expect((await invoke<Snapshot>(page, 'get_journey')).stops).toEqual(before.stops);
  const replaced = await invoke<{ url: string }>(page, 'import_route', { text: 'EGLL KJFK\nLFPG EKCH' });
  expect(new URL(replaced.url).searchParams.get('2.route')).toBe('CDG-CPH');
  expect(new URL(replaced.url).searchParams.has('b.route')).toBe(false);
});
