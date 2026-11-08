/**
 * Stylised app icons and iOS launch screens: public-domain Natural Earth land silhouettes,
 * smooth orthographic sphere lighting and an original luminous great-circle ribbon (MIT).
 * Requires Playwright Chromium. Downloads pinned country polygons only if the cache is absent.
 *   node scripts/build-icons.ts
 *   node scripts/build-icons.ts --og http://localhost:4173/globehops/
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { atomicWrite, loadNaturalEarth } from './build-country-labels.ts';
import { COUNTRY_LABEL_SOURCE_URL } from './lib/countryLabels.ts';
import { APP_ICONS, SCREENSHOTS, splashFiles, SPLASH_SCREENS } from './pwa-assets.ts';

// Artwork geometry is independent of output size; every asset downsamples the same 4× master.
const ARTWORK = {
  size: 2048,
  radius: 860,
  view: { latitude: 12, longitude: 3, roll: 15 },
  route: {
    origin: [-23.4356, -46.4731] as [number, number], // São Paulo (GRU)
    destination: [60.3172, 24.9633] as [number, number], // Helsinki (HEL)
    lift: 0.17,
  },
  // Ice-blue land over cobalt water; the lit rim is directional, never a uniform outline.
  palette: {
    shadow: [10, 37, 82],
    mid: [20, 82, 168],
    lit: [61, 143, 240],
    land: [207, 230, 255],
    landShadow: [28, 70, 132],
    rim: [120, 204, 255],
    glow: ['#5ab4ff50', '#4ba8ff20', '#388dff07', '#388dff00'],
    amber: ['#f27a00b0', '#ff9200', '#ffa814', '#ffc23d'],
  },
};
const TILE = {
  top: '#132a52',
  bottom: '#040814',
  corner: 0.224,
  diameter: 0.75,
  maskableDiameter: 0.72,
};

type CountryGeometry =
  { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };
interface CountryCollection {
  type: 'FeatureCollection';
  features: { geometry: CountryGeometry }[];
}

const root = path.resolve(import.meta.dirname, '..');
const pub = (f: string) => path.join(root, 'public', f);
const cache = path.join(root, '.cache/naturalearth/ne_50m_admin_0_countries.geojson');
const source = await loadNaturalEarth(COUNTRY_LABEL_SOURCE_URL, cache, false, false);
const countries = JSON.parse(source.text) as CountryCollection;
if (
  countries.type !== 'FeatureCollection' ||
  !Array.isArray(countries.features) ||
  countries.features.length < 200 ||
  countries.features.some(({ geometry }) => !['Polygon', 'MultiPolygon'].includes(geometry.type))
) {
  throw new Error('Invalid Natural Earth country polygons');
}
if (source.downloaded) await atomicWrite(cache, source.text);

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

// Canvas 2D performs the orthographic projection per pixel; no WebGL or photo texture.
const page = await browser.newPage({ viewport: { width: ARTWORK.size, height: ARTWORK.size } });
const globeData = await page.evaluate(
  ({ countries, artwork }) => {
    const size = artwork.size;
    const radius = artwork.radius;
    const center = size / 2;
    const rad = Math.PI / 180;
    type Vec = [number, number, number];
    const lat = artwork.view.latitude * rad;
    const lon = artwork.view.longitude * rad;
    const roll = artwork.view.roll * rad;
    const forward: Vec = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
    const eastBase: Vec = [-Math.sin(lon), 0, Math.cos(lon)];
    const northBase: Vec = [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon)];
    const east = eastBase.map((v, i) => v * Math.cos(roll) + northBase[i] * Math.sin(roll)) as Vec;
    const north = northBase.map((v, i) => v * Math.cos(roll) - eastBase[i] * Math.sin(roll)) as Vec;
    const dot = (a: Vec, b: Vec) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    const mask = document.createElement('canvas');
    // A high-resolution equirectangular coverage mask keeps coastlines smooth after projection.
    mask.width = 8192;
    mask.height = 4096;
    const m = mask.getContext('2d', { willReadFrequently: true })!;
    m.fillStyle = '#fff';
    for (const { geometry } of countries.features) {
      const polygons =
        geometry.type === 'Polygon' ? [geometry.coordinates as number[][][]] : (geometry.coordinates as number[][][][]);
      for (const polygon of polygons) {
        m.beginPath();
        for (const ring of polygon) {
          ring.forEach(([lng, lat], i) => {
            const x = ((lng + 180) / 360) * mask.width;
            const y = ((90 - lat) / 180) * mask.height;
            if (i === 0) m.moveTo(x, y);
            else m.lineTo(x, y);
          });
          m.closePath();
        }
        m.fill('evenodd');
      }
    }
    const pixels = m.getImageData(0, 0, mask.width, mask.height).data;
    const landAt = (u: number, v: number) => {
      const x = u * mask.width - 0.5;
      const y = Math.max(0, Math.min(mask.height - 1, v * mask.height - 0.5));
      const ix = Math.floor(x),
        iy = Math.floor(y),
        fx = x - ix,
        fy = y - iy;
      const at = (dx: number, dy: number) =>
        pixels[(Math.min(mask.height - 1, iy + dy) * mask.width + ((ix + dx + mask.width) % mask.width)) * 4 + 3] / 255;
      return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
    };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const glow = ctx.createRadialGradient(center, center, radius * 0.995, center, center, radius * 1.08);
    glow.addColorStop(0, artwork.palette.glow[0]);
    glow.addColorStop(0.22, artwork.palette.glow[1]);
    glow.addColorStop(0.6, artwork.palette.glow[2]);
    glow.addColorStop(1, artwork.palette.glow[3]);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    const surface = document.createElement('canvas');
    surface.width = surface.height = size;
    const sc = surface.getContext('2d')!;
    const data = sc.createImageData(size, size);
    const { shadow, mid, lit, landShadow, rim } = artwork.palette;
    for (let py = 0; py < size; py++) {
      const y = (center - py - 0.5) / radius;
      for (let px = 0; px < size; px++) {
        const x = (px + 0.5 - center) / radius,
          rr = x * x + y * y;
        if (rr > 1) continue;
        const z = Math.sqrt(1 - rr);
        const world = forward.map((value, i) => value * z + east[i] * x + north[i] * y) as Vec;
        const land =
          landAt((Math.atan2(world[2], world[0]) + Math.PI) / (2 * Math.PI), 0.5 - Math.asin(world[1]) / Math.PI) *
          0.88;
        // Wrapped diffuse light avoids a flat black night side. All land shares the ocean lighting.
        const light = -0.48 * x + 0.55 * y + 0.68 * z;
        const diffuse = Math.pow(Math.max(0, (light + 0.24) / 1.24), 1.15);
        const spec = Math.pow(Math.max(0, -0.27 * x + 0.31 * y + 0.911 * z), 14) * 0.15;
        // Fresnel light is broadest on the upper-left limb and fades around the shadow side.
        const fresnel = Math.pow(1 - z, 3.5) * (0.025 + 0.7 * Math.max(0, -0.65 * x + 0.72 * y));
        const inner = 1 - 0.15 * Math.pow(1 - z, 2) * Math.max(0, 0.65 * x - 0.72 * y);
        const index = (py * size + px) * 4;
        for (let c = 0; c < 3; c++) {
          const ocean =
            diffuse < 0.48
              ? shadow[c] + ((mid[c] - shadow[c]) * diffuse) / 0.48
              : mid[c] + ((lit[c] - mid[c]) * (diffuse - 0.48)) / 0.52;
          const ice = landShadow[c] + (artwork.palette.land[c] - landShadow[c]) * diffuse;
          const base = (ocean * (1 - land) + ice * land) * inner;
          const gloss = base + (255 - base) * spec;
          data.data[index + c] = gloss + (rim[c] - gloss) * fresnel;
        }
        data.data[index + 3] = 255;
      }
    }
    sc.putImageData(data, 0, 0);
    ctx.drawImage(surface, 0, 0);
    const vector = ([latitude, longitude]: [number, number]): Vec => [
      Math.cos(latitude * rad) * Math.cos(longitude * rad),
      Math.sin(latitude * rad),
      Math.cos(latitude * rad) * Math.sin(longitude * rad),
    ];
    // GRU–HEL: a real great circle, lifted radially by 17% at mid-flight.
    const origin = vector(artwork.route.origin),
      destination = vector(artwork.route.destination);
    const angle = Math.acos(dot(origin, destination));
    const project = (point: Vec, lift = 1) => ({
      x: center + radius * lift * dot(point, east),
      y: center - radius * lift * dot(point, north),
    });
    const points = Array.from({ length: 257 }, (_, i) => {
      const t = i / 256,
        a = Math.sin((1 - t) * angle) / Math.sin(angle),
        b = Math.sin(t * angle) / Math.sin(angle);
      const world = origin.map((value, j) => value * a + destination[j] * b) as Vec;
      return { ...project(world, 1 + artwork.route.lift * Math.sin(Math.PI * t)), ground: project(world), t };
    });
    // Ground track stays on the sphere while the luminous ribbon lifts away.
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.ground.x, p.ground.y);
      else ctx.lineTo(p.ground.x, p.ground.y);
    });
    ctx.strokeStyle = '#03152b50';
    ctx.lineWidth = radius * 0.035;
    ctx.filter = `blur(${radius * 0.014}px)`;
    ctx.stroke();
    ctx.restore();
    // Offset the sampled curve along its screen normal to form a tapered ribbon.
    const ribbon = (lower: number, upper: number) => {
      const edge = (p: (typeof points)[number], i: number, offset: number) => {
        const a = points[Math.max(0, i - 1)],
          b = points[Math.min(256, i + 1)];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          len = Math.hypot(dx, dy);
        const width = radius * (0.014 + 0.116 * Math.pow(Math.sin((p.t * Math.PI) / 2), 1.3));
        return { x: p.x - (dy / len) * width * offset, y: p.y + (dx / len) * width * offset };
      };
      ctx.beginPath();
      points.forEach((p, i) => {
        const e = edge(p, i, lower);
        if (i === 0) ctx.moveTo(e.x, e.y);
        else ctx.lineTo(e.x, e.y);
      });
      if (lower === -0.5 && upper === 0.5) {
        const p = points[256],
          a = points[255];
        const normal = Math.atan2(p.x - a.x, -(p.y - a.y));
        ctx.arc(p.x, p.y, (radius * 0.13) / 2, normal + Math.PI, normal + 2 * Math.PI);
      }
      for (let i = 256; i >= 0; i--) {
        const e = edge(points[i], i, upper);
        ctx.lineTo(e.x, e.y);
      }
      ctx.closePath();
    };
    const start = points[0],
      end = points[256];
    const amber = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    amber.addColorStop(0, artwork.palette.amber[0]);
    amber.addColorStop(0.35, artwork.palette.amber[1]);
    amber.addColorStop(0.72, artwork.palette.amber[2]);
    amber.addColorStop(1, artwork.palette.amber[3]);
    ctx.save();
    ctx.shadowColor = '#ff920090';
    ctx.shadowBlur = radius * 0.055;
    ribbon(-0.5, 0.5);
    ctx.fillStyle = amber;
    ctx.fill();
    ctx.restore();
    // A smooth cross-ribbon highlight gives the accent volume without a hard stripe.
    for (let band = 0; band < 24; band++) {
      const lo = -0.5 + band / 24,
        hi = lo + 1 / 24;
      ribbon(lo, hi);
      ctx.fillStyle = `rgba(255,222,150,${0.22 * Math.exp(-Math.pow(((lo + hi) / 2 + 0.22) / 0.2, 2))})`;
      ctx.fill();
    }
    for (const [i, p] of [start, end].entries()) {
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * (i === 0 ? 0.06 : 0.16));
      halo.addColorStop(0, i === 0 ? '#ff920088' : '#ffb83080');
      halo.addColorStop(0.25, '#ffa01a38');
      halo.addColorStop(1, '#ffa01a00');
      ctx.fillStyle = halo;
      ctx.fillRect(p.x - radius * 0.16, p.y - radius * 0.16, radius * 0.32, radius * 0.32);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * (i === 0 ? 0.023 : 0.042), 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#ffa01a' : '#ffe9b0';
      ctx.fill();
    }
    return canvas.toDataURL('image/png');
  },
  { countries, artwork: ARTWORK },
);
await page.close();
const globe = Buffer.from(globeData.split(',')[1], 'base64');

async function icon(size: number, rounded: boolean, maskable: boolean, file: string) {
  const page = await browser.newPage();
  const data = await page.evaluate(
    async ({ globeData, artwork, tile, rounded, maskable }) => {
      const size = artwork.size;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      if (rounded) {
        // Cubics with long tangent handles produce a continuous, squircle-like corner.
        const r = size * tile.corner;
        const k = r * 0.12;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(size - r, 0);
        ctx.bezierCurveTo(size - k, 0, size, k, size, r);
        ctx.lineTo(size, size - r);
        ctx.bezierCurveTo(size, size - k, size - k, size, size - r, size);
        ctx.lineTo(r, size);
        ctx.bezierCurveTo(k, size, 0, size - k, 0, size - r);
        ctx.lineTo(0, r);
        ctx.bezierCurveTo(0, k, k, 0, r, 0);
        ctx.closePath();
        ctx.clip();
      }
      const background = ctx.createLinearGradient(0, 0, 0, size);
      background.addColorStop(0, tile.top);
      background.addColorStop(1, tile.bottom);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size, size);
      const bloom = ctx.createRadialGradient(size * 0.46, size * 0.43, 0, size * 0.46, size * 0.43, size * 0.54);
      bloom.addColorStop(0, '#2275cc30');
      bloom.addColorStop(1, '#2275cc00');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, size, size);
      const image = new Image();
      image.src = globeData;
      await image.decode();
      const diameter = maskable ? tile.maskableDiameter : tile.diameter;
      const edge = (size * diameter) / ((artwork.radius * 2) / artwork.size);
      // Centre maskable art exactly; its atmosphere reaches 72% × 1.08 = 77.76% of the tile.
      const cx = size * (maskable ? 0.5 : 0.51);
      const cy = size * (maskable ? 0.5 : 0.525);
      ctx.drawImage(image, cx - edge / 2, cy - edge / 2, edge, edge);
      return canvas.toDataURL('image/png');
    },
    { globeData, artwork: ARTWORK, tile: TILE, rounded, maskable },
  );
  const output = sharp(Buffer.from(data.split(',')[1], 'base64')).resize(size, size);
  if (!rounded) output.removeAlpha();
  await output.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(pub(file));
  await page.close();
  console.log('wrote', file);
}
for (const asset of APP_ICONS) {
  await icon(Number(asset.sizes.split('x')[0]), asset.purpose === 'any', asset.purpose === 'maskable', asset.src);
}
await icon(180, false, false, 'apple-touch-icon.png');

await mkdir(pub('splash'), { recursive: true });
for (const screen of splashFiles()) {
  const short = Math.min(screen.width, screen.height);
  const definition = SPLASH_SCREENS.find((item) => item.width * item.dpr === short)!;
  const edge = Math.round((short * (definition.width >= 744 ? 0.22 : 0.3)) / ((ARTWORK.radius * 2) / ARTWORK.size));
  const mark = await sharp(globe).resize(edge).toBuffer();
  await sharp({ create: { width: screen.width, height: screen.height, channels: 3, background: '#04060c' } })
    .composite([{ input: mark, gravity: 'centre' }])
    // Preserve smooth lighting and a fully faded atmosphere on the flat launch backdrop.
    .png({ compressionLevel: 9, adaptiveFiltering: true })
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
