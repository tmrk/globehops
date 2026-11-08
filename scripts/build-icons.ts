/**
 * Photographic app icons, iOS launch screens and manifest screenshots.
 * NASA Blue Marble imagery (public domain) with an original route overlay (MIT).
 * Requires installed Playwright Chromium; no WebGL or network requests for asset rendering.
 *   node scripts/build-icons.ts
 *   node scripts/build-icons.ts --og http://localhost:4173/globehops/
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { APP_ICONS, SCREENSHOTS, splashFiles, SPLASH_SCREENS } from './pwa-assets.ts';

const root = path.resolve(import.meta.dirname, '..');
const pub = (f: string) => path.join(root, 'public', f);

const logo = await readFile(pub('logo.svg'), 'utf8');
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

// Project once at 4× the largest icon size. All outputs downsample this master.
const page = await browser.newPage({ viewport: { width: 2048, height: 2048 } });
const texture = `data:image/webp;base64,${(await readFile(path.join(root, 'src/assets/textures/earth-8k.webp'))).toString('base64')}`;
const globeData = await page.evaluate(
  async ({ texture }) => {
    const size = 2048;
    const radius = 880;
    const center = size / 2;
    const rad = Math.PI / 180;
    // Move east from the initial Atlantic view to show the real route’s bow; a slight roll
    // preserves the brand mark’s lower-left to upper-right diagonal.
    const lat = 12 * rad;
    const lon = -6 * rad;
    type Vec = [number, number, number];
    const forward: Vec = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
    const eastBase: Vec = [-Math.sin(lon), 0, Math.cos(lon)];
    const northBase: Vec = [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon)];
    const roll = 12 * rad;
    const east = eastBase.map((v, i) => v * Math.cos(roll) + northBase[i] * Math.sin(roll)) as Vec;
    const north = northBase.map((v, i) => v * Math.cos(roll) - eastBase[i] * Math.sin(roll)) as Vec;
    const dot = (a: Vec, b: Vec) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    const load = async (url: string) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      return {
        pixels: ctx.getImageData(0, 0, image.width, image.height).data,
        width: image.width,
        height: image.height,
      };
    };
    const day = await load(texture);
    // NASA equirectangular: left = 180°W, centre = Greenwich, top = north.
    // Equivalent to SphereGeometry UVs with scene +X=Greenwich, +Y=north, −Z=east.
    const sample = (map: typeof day, u: number, v: number, channel: number) => {
      const x = u * map.width - 0.5;
      const y = Math.max(0, Math.min(map.height - 1, v * map.height - 0.5));
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const at = (dx: number, dy: number) =>
        map.pixels[(Math.min(map.height - 1, iy + dy) * map.width + ((ix + dx + map.width) % map.width)) * 4 + channel];
      return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
    };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const glow = ctx.createRadialGradient(center, center, radius * 0.99, center, center, radius * 1.085);
    glow.addColorStop(0, '#76afff40');
    glow.addColorStop(0.3, '#4b98ff18');
    glow.addColorStop(1, '#4b98ff00');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    const surface = document.createElement('canvas');
    surface.width = surface.height = size;
    const surfaceCtx = surface.getContext('2d')!;
    const data = surfaceCtx.createImageData(size, size);
    for (let py = 0; py < size; py++) {
      const y = (center - py - 0.5) / radius;
      for (let px = 0; px < size; px++) {
        const x = (px + 0.5 - center) / radius;
        const rr = x * x + y * y;
        if (rr > 1) continue;
        const z = Math.sqrt(1 - rr);
        const world = forward.map((value, i) => value * z + east[i] * x + north[i] * y) as Vec;
        const u = (Math.atan2(world[2], world[0]) + Math.PI) / (2 * Math.PI);
        const v = 0.5 - Math.asin(world[1]) / Math.PI;
        const light = Math.max(0, -0.4 * x + 0.45 * y + 0.8 * z);
        const shade = (0.77 + 0.31 * light) * (0.78 + 0.22 * Math.pow(z, 0.4));
        const rgb = [0, 1, 2].map((c) => sample(day, u, v, c));
        const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        const index = (py * size + px) * 4;
        for (let c = 0; c < 3; c++) {
          data.data[index + c] = Math.max(
            0,
            Math.min(255, ((luma + (rgb[c] - luma) * 1.16 - 128) * 1.07 + 132) * shade),
          );
        }
        data.data[index + 3] = 255;
      }
    }
    surfaceCtx.putImageData(data, 0, 0);
    // Slight optical softness suppresses subpixel terrain noise; the rim and route stay crisp.
    ctx.filter = 'blur(2.6px)';
    ctx.drawImage(surface, 0, 0);
    ctx.filter = 'none';
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#9ccaff';
    ctx.lineWidth = radius * 0.014;
    ctx.stroke();
    const vector = (latitude: number, longitude: number): Vec => [
      Math.cos(latitude * rad) * Math.cos(longitude * rad),
      Math.sin(latitude * rad),
      Math.cos(latitude * rad) * Math.sin(longitude * rad),
    ];
    const origin = vector(-23.4356, -46.4731);
    const destination = vector(51.47, -0.4543);
    const angle = Math.acos(dot(origin, destination));
    const project = (point: Vec, lift = 1) => ({
      x: center + radius * lift * dot(point, east),
      y: center - radius * lift * dot(point, north),
      visible: dot(point, forward) > 0,
    });
    ctx.beginPath();
    for (let i = 0; i <= 256; i++) {
      const t = i / 256;
      const a = Math.sin((1 - t) * angle) / Math.sin(angle);
      const b = Math.sin(t * angle) / Math.sin(angle);
      const point = project(
        origin.map((value, j) => value * a + destination[j] * b) as Vec,
        1 + 0.04 * Math.sin(Math.PI * t),
      );
      if (!point.visible) continue;
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.lineCap = ctx.lineJoin = 'round';
    const stroke = radius * 2 * 0.075;
    ctx.strokeStyle = '#04060c73';
    ctx.lineWidth = stroke * 1.8;
    ctx.stroke();
    ctx.strokeStyle = '#ffc24b';
    ctx.lineWidth = stroke;
    ctx.stroke();
    for (const [i, endpoint] of [origin, destination].entries()) {
      const point = project(endpoint);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * (i === 0 ? 0.13 : 0.14), 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#0a0f1a' : '#ffc24b';
      ctx.fill();
      ctx.strokeStyle = i === 0 ? '#ffc24b' : '#fff';
      ctx.lineWidth = radius * (i === 0 ? 0.065 : 0.052);
      ctx.stroke();
    }
    return canvas.toDataURL('image/png');
  },
  { texture },
);
await page.close();
const globe = Buffer.from(globeData.split(',')[1], 'base64');

async function icon(size: number, scale: number, rounded: boolean, file: string) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 2 });
  await page.setContent(
    `<body style="margin:0;background:transparent"><canvas width="${size * 2}" height="${size * 2}" style="width:${size}px;height:${size}px"></canvas></body>`,
  );
  await page.evaluate(
    async ({ globeData, size, scale, rounded }) => {
      const canvas = document.querySelector('canvas')!;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(2, 2);
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, rounded ? size * 0.22 : 0);
      ctx.clip();
      const gradient = ctx.createRadialGradient(size / 2, size * 0.4, 0, size / 2, size * 0.4, size * 0.75);
      gradient.addColorStop(0, '#0f1c33');
      gradient.addColorStop(1, '#05080f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      const image = new Image();
      image.src = globeData;
      await image.decode();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const edge = (size * scale) / (1760 / 2048);
      ctx.drawImage(image, (size - edge) / 2, (size - edge) / 2, edge, edge);
    },
    { globeData, size, scale, rounded },
  );
  const png = await page.screenshot({ omitBackground: true });
  const output = sharp(png).resize(size, size);
  if (!rounded) output.removeAlpha();
  await output.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(pub(file));
  await page.close();
  console.log('wrote', file);
}
// The maskable disc is 72%; its glow reaches 72% × 1.085 = 78.12%, inside the 80% safe circle.
for (const asset of APP_ICONS) {
  const size = Number(asset.sizes.split('x')[0]);
  await icon(size, asset.purpose === 'maskable' ? 0.72 : 0.8, asset.purpose === 'any', asset.src);
}
await icon(180, 0.78, false, 'apple-touch-icon.png');

await mkdir(pub('splash'), { recursive: true });
for (const screen of splashFiles()) {
  const short = Math.min(screen.width, screen.height);
  const definition = SPLASH_SCREENS.find((item) => item.width * item.dpr === short)!;
  const edge = Math.round((short * (definition.width >= 744 ? 0.22 : 0.3)) / (1760 / 2048));
  const mark = await sharp(globe).resize(edge).toBuffer();
  await sharp({ create: { width: screen.width, height: screen.height, channels: 3, background: '#04060c' } })
    .composite([{ input: mark, gravity: 'centre' }])
    // Quantise only launch screens; app-icon PNG compression above is lossless.
    .png({ compressionLevel: 9, palette: true, quality: 80, dither: 0.1 })
    .toFile(pub(screen.file));
}
console.log('wrote', splashFiles().length, 'launch screens');
await mkdir(pub('screenshots'), { recursive: true });
for (const asset of SCREENSHOTS) {
  await sharp(path.join(root, 'docs', asset.form_factor === 'wide' ? 'screenshot.png' : 'screenshot-mobile.png'))
    .webp({ quality: 82 })
    .toFile(pub(asset.src));
  console.log('wrote', asset.src);
}

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
