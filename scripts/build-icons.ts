/**
 * Renders the PNG app icons (and optionally the social preview image) from the SVG sources
 * in public/ using Playwright's Chromium. Icons are original artwork (MIT, this repository).
 *
 *   node scripts/build-icons.ts                 → favicon-32, apple-touch-icon, icon-192/512, maskable
 *   node scripts/build-icons.ts --og <url>      → also public/og-image.png from a running build,
 *                                                e.g. http://localhost:4173/globehops/
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const pub = (f: string) => path.join(root, 'public', f);

const logo = await readFile(pub('logo.svg'), 'utf8');
const favicon = await readFile(pub('favicon.svg'), 'utf8');
// The social card is rendered from an inline page, so embed the brand typeface rather than linking it.
const barlow = async (weight: number) =>
  (
    await readFile(path.join(root, `node_modules/@fontsource/barlow/files/barlow-latin-${weight}-normal.woff2`))
  ).toString('base64');
const fontFaces = (
  await Promise.all(
    [500, 600, 700].map(
      async (w) =>
        `@font-face{font-family:Barlow;font-weight:${w};src:url(data:font/woff2;base64,${await barlow(w)}) format('woff2')}`,
    ),
  )
).join('');

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function render(html: string, size: { width: number; height: number }, file: string) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>${fontFaces}</style></head><body style="margin:0;background:transparent">${html}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: pub(file), omitBackground: true });
  await page.close();
  console.log('wrote', file);
}

const svgAt = (svg: string, px: number) => svg.replace(/width="64" height="64"/, `width="${px}" height="${px}"`);
// Full-bleed square with the mark centred; `scale` keeps maskable icons inside the safe zone.
const tile = (px: number, scale: number, radius = 0) =>
  `<div style="width:${px}px;height:${px}px;display:grid;place-items:center;border-radius:${radius}px;` +
  `background:radial-gradient(circle at 50% 40%,#0f1c33,#05080f 75%)">${svgAt(logo, Math.round(px * scale))}</div>`;

await render(svgAt(favicon, 32), { width: 32, height: 32 }, 'favicon-32.png');
await render(tile(180, 0.86), { width: 180, height: 180 }, 'apple-touch-icon.png');
await render(tile(192, 0.84, 42), { width: 192, height: 192 }, 'icon-192.png');
await render(tile(512, 0.84, 112), { width: 512, height: 512 }, 'icon-512.png');
await render(tile(512, 0.66), { width: 512, height: 512 }, 'icon-maskable-512.png');

const ogIndex = process.argv.indexOf('--og');
if (ogIndex !== -1) {
  const url = process.argv[ogIndex + 1] ?? 'http://localhost:4173/globehops/';
  // 1. Capture the real globe with a route (UI chrome hidden).
  // ≥1000 px wide uses the side-panel layout, so hiding the panel leaves no inset on the globe.
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'en-GB',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${url}?route=CPH-LHR-JFK`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: '.panel,.topbar,.hud-wrap,.toast-region{display:none!important}' });
  await page.waitForSelector('.stage.is-ready');
  await page.waitForTimeout(4000);
  const globe = await page.screenshot({ type: 'png' });
  await page.close();
  // 2. Compose the 1200×630 card.
  const img = `data:image/png;base64,${globe.toString('base64')}`;
  await render(
    `<div style="position:relative;width:1200px;height:630px;overflow:hidden;background:radial-gradient(ellipse at 72% 45%,#10223d 0%,#05080f 62%);font-family:Barlow,system-ui,sans-serif">
      <img src="${img}" style="position:absolute;right:-150px;top:-185px;width:1000px;height:1000px;-webkit-mask-image:radial-gradient(circle at 50% 50%,#000 46%,transparent 62%)">
      <div style="position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:520px">
        <div style="display:flex;align-items:center;gap:18px">${svgAt(logo, 76)}
          <span style="font-size:62px;font-weight:700;letter-spacing:-0.005em;color:#eef1f6">GlobeHops</span></div>
        <p style="margin:28px 0 0;font-size:38px;line-height:1.2;color:#eef1f6;font-weight:600">Your journey by air,<br>on a real 3D globe.</p>
        <p style="margin:18px 0 0;font-size:25px;line-height:1.35;color:#a9b2c3;font-weight:500">Great-circle routes, distances and<br>estimated flight times — free &amp; open source.</p>
      </div>
    </div>`,
    { width: 1200, height: 630 },
    'og-image.png',
  );
}

await browser.close();
