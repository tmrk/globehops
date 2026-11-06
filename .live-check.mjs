import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
const page = await ctx.newPage();
const hits = [];
page.on('request', (r) => {
  const u = new URL(r.url());
  if (/google-analytics\.com|googletagmanager\.com/.test(u.hostname)) {
    const q = Object.fromEntries(u.searchParams);
    const body = r.postData() ?? '';
    hits.push({ host: u.hostname, path: u.pathname, en: q.en, dl: q.dl, dt: q.dt, dr: q.dr, body: body.slice(0, 200) });
  }
});
page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
await page.goto('https://tmrk.github.io/globehops/?route=CPH-LHR-JFK');
const notice = page.getByRole('region', { name: 'Usage statistics' });
await notice.waitFor({ timeout: 20000 });
console.log('notice visible; google requests before consent:', hits.length);
await page.screenshot({ path: process.argv[2] });
await page.getByRole('button', { name: 'Allow', exact: true }).click();
await page.waitForTimeout(8000);
console.log('after allow:', JSON.stringify(hits, null, 1));
const before = hits.length;
// Edit the route: change the London layover (rewrites the address).
await page.getByRole('combobox', { name: 'Layover in London' }).selectOption('180');
await page.waitForTimeout(6000);
console.log('url now', page.url());
console.log('requests after route edit:', JSON.stringify(hits.slice(before), null, 1));
console.log('cookies', (await ctx.cookies()).map((c) => c.name).join(','));
await browser.close();
