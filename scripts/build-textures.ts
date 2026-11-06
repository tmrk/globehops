/**
 * Builds the browser-ready Earth textures: the daytime surface from NASA Blue Marble Next
 * Generation (BMNG) and the night-light mask from NASA Black Marble 2016.
 *
 * Day source: NASA Earth Observatory, Blue Marble Next Generation w/ Topography and Bathymetry,
 * July 2004 composite, equirectangular (plate carrée), 21600×10800.
 *   https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
 * Credit: NASA Earth Observatory (Reto Stöckli, NASA Goddard Space Flight Center).
 *
 * Night source: NASA Earth Observatory, Earth at Night (Black Marble) 2016 colour composite,
 * equirectangular, 13500×6750 (3 km). Credit: NASA Earth Observatory images by Joshua Stevens,
 * using Suomi NPP VIIRS data from Miguel Román, NASA's Goddard Space Flight Center.
 *   https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/
 *
 * NASA imagery is generally not subject to copyright in the United States; see docs/DATA_SOURCES.md.
 *
 * Day modifications: Lanczos resampling to power-of-two equirectangular sizes, a lift of the darkest
 * water (see liftOceans) so deep oceans read differently by day and by night, and WebP encoding.
 * No geometry or content changes.
 * Night modifications: Lanczos resampling, then a single-channel light mask that removes the
 * bluish moonlit land and ocean (see lightMask) so the shader can tint and fade lights by sun angle.
 *
 * The source files are NOT committed (they are large); the generated textures in src/assets/textures/ are.
 *
 * Usage: node scripts/build-textures.ts [--day-only | --night-only] [day-source.jpg] [night-source.jpg]
 * Default sources: .cache/bmng/world.topo.bathy.200407.3x21600x10800.jpg and
 * .cache/blackmarble/BlackMarble_2016_3km.jpg (download URLs below).
 */
import { mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { lightMask } from './lib/lights.ts';
import { liftOceans } from './lib/ocean.ts';

export const SOURCE_URL =
  'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg';
export const NIGHT_SOURCE_URL =
  'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const paths = args.filter((arg) => !arg.startsWith('--'));
const dayOnly = args.includes('--day-only');
const nightOnly = args.includes('--night-only');
const daySource = paths[0] ?? path.join(root, '.cache/bmng/world.topo.bathy.200407.3x21600x10800.jpg');
const nightSource = paths[1] ?? path.join(root, '.cache/blackmarble/BlackMarble_2016_3km.jpg');
const outDir = path.join(root, 'src/assets/textures');

const dayOutputs = [
  // Tiny placeholder shown instantly while the real texture streams in.
  { file: 'earth-1k.webp', width: 1024, quality: 72 },
  // Phones, tablets and GPUs limited to 4096px textures.
  { file: 'earth-4k.webp', width: 4096, quality: 82 },
  // Desktop GPUs with large screens.
  { file: 'earth-8k.webp', width: 8192, quality: 80 },
];

const nightOutputs = [
  // Phones and GPUs limited below 4096px.
  { file: 'lights-2k.webp', width: 2048, quality: 80 },
  // Everything else; mostly black, so it stays small.
  { file: 'lights-4k.webp', width: 4096, quality: 75 },
];

async function sourceWidth(source: string): Promise<number> {
  // The full-resolution sources exceed sharp's default pixel limit.
  const meta = await sharp(source, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height || meta.width !== meta.height * 2) {
    throw new Error(`Expected a 2:1 equirectangular image, got ${meta.width}×${meta.height}: ${source}`);
  }
  return meta.width;
}

async function report(target: string, file: string, width: number) {
  const { size } = await stat(target);
  console.log(`${file}: ${width}×${width / 2}, ${(size / 1024).toFixed(0)} KiB`);
}

async function buildDay(source: string) {
  const width = await sourceWidth(source);
  for (const o of dayOutputs) {
    if (o.width > width) {
      console.warn(`Skipping ${o.file}: source is only ${width}px wide`);
      continue;
    }
    const height = o.width / 2;
    const { data, info } = await sharp(source, { limitInputPixels: false })
      .resize(o.width, height, { kernel: 'lanczos3', fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`Expected an RGB day source, got ${info.channels} channels`);
    const target = path.join(outDir, o.file);
    await sharp(liftOceans(data), { raw: { width: o.width, height, channels: 3 } })
      .webp({ quality: o.quality, effort: 6, smartSubsample: true })
      .toFile(target);
    await report(target, o.file, o.width);
  }
}

async function buildNight(source: string) {
  const width = await sourceWidth(source);
  for (const o of nightOutputs) {
    if (o.width > width) {
      console.warn(`Skipping ${o.file}: source is only ${width}px wide`);
      continue;
    }
    const height = o.width / 2;
    const { data, info } = await sharp(source, { limitInputPixels: false })
      .resize(o.width, height, { kernel: 'lanczos3', fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`Expected an RGB night source, got ${info.channels} channels`);
    const target = path.join(outDir, o.file);
    await sharp(lightMask(data), { raw: { width: o.width, height, channels: 1 } })
      .webp({ quality: o.quality, effort: 6 })
      .toFile(target);
    await report(target, o.file, o.width);
  }
}

async function main() {
  if (dayOnly && nightOnly) throw new Error('Choose at most one of --day-only and --night-only');
  const jobs: [string, string, string, (source: string) => Promise<void>][] = [];
  if (!nightOnly) jobs.push(['Day', daySource, SOURCE_URL, buildDay]);
  if (!dayOnly) jobs.push(['Night', nightSource, NIGHT_SOURCE_URL, buildNight]);
  sharp.cache(false);
  await mkdir(outDir, { recursive: true });
  for (const [name, source, url, build] of jobs) {
    if (!existsSync(source)) {
      console.error(`${name} source image not found: ${source}\nDownload it first:\n  curl -L -o ${source} ${url}`);
      process.exitCode = 1;
      continue;
    }
    await build(source);
  }
}

await main();
