import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route('https://tmrk.github.io/**', async (route) => {
  const url = new URL(route.request().url());
  const r = await fetch('http://localhost:4173' + url.pathname + url.search);
  await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
});
// Let gtag.js load, but never deliver hits to the real property.
await ctx.route(/google-analytics\.com|\/g\/collect/, (route) => route.abort());
const page = await ctx.newPage();
const show = (label) => (r) => {
  if (!/collect/.test(r.url())) return;
  const q = new URL(r.url()).searchParams;
  const keep = ['en', 'dl', 'dt', 'dr', 'ep.entry', 'ep.method', 'epn.flights', 'ep.content_type'];
  const head = keep.filter((k) => q.has(k)).map((k) => `${k}=${q.get(k)}`).join(' | ');
  const body = (r.postData() ?? '').split('\n').filter(Boolean).map((l) => {
    const b = new URLSearchParams(l);
    return keep.filter((k) => b.has(k)).map((k) => `${k}=${b.get(k)}`).join(' | ');
  });
  console.log(label(), head, body.length ? JSON.stringify(body) : '');
};
let phase = 'load';
page.on('request', show(() => phase));
await page.goto('https://tmrk.github.io/globehops/?route=CPH-LHR-JFK');
await page.getByRole('button', { name: 'Allow', exact: true }).click();
await page.waitForTimeout(7000);
phase = 'edit';
await page.getByRole('combobox', { name: 'Layover in London' }).selectOption('180');
await page.waitForTimeout(3000);
phase = 'play';
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(3000);
phase = 'scroll';
await page.mouse.wheel(0, 2000);
await page.waitForTimeout(6000);
phase = 'leave';
await page.close({ runBeforeUnload: true });
await new Promise((r) => setTimeout(r, 1500));
await browser.close();
