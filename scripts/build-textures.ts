/**
 * Builds the browser-ready Earth textures from NASA Blue Marble Next Generation (BMNG).
 *
 * Source: NASA Earth Observatory, Blue Marble Next Generation w/ Topography and Bathymetry,
 * July 2004 composite, equirectangular (plate carrée), 21600×10800.
 *   https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/
 * Credit: NASA Earth Observatory (Reto Stöckli, NASA Goddard Space Flight Center).
 * NASA imagery is generally not subject to copyright in the United States; see docs/DATA_SOURCES.md.
 *
 * Modifications: Lanczos resampling to power-of-two equirectangular sizes and WebP encoding.
 * No colour, geometry or content changes. The source files are NOT committed (they are large);
 * the generated textures in src/assets/textures/ are.
 *
 * Usage: node scripts/build-textures.ts [path/to/source.jpg]
 * Default source: .cache/bmng/world.topo.bathy.200407.3x21600x10800.jpg (download URL below).
 */
import { mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const SOURCE_URL =
  'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg';

const root = path.resolve(import.meta.dirname, '..');
const source = process.argv[2] ?? path.join(root, '.cache/bmng/world.topo.bathy.200407.3x21600x10800.jpg');
const outDir = path.join(root, 'src/assets/textures');

const outputs = [
  // Tiny placeholder shown instantly while the real texture streams in.
  { file: 'earth-1k.webp', width: 1024, quality: 72 },
  // Phones, tablets and GPUs limited to 4096px textures.
  { file: 'earth-4k.webp', width: 4096, quality: 82 },
  // Desktop GPUs with large screens.
  { file: 'earth-8k.webp', width: 8192, quality: 80 },
];

async function main() {
  if (!existsSync(source)) {
    console.error(`Source image not found: ${source}\nDownload it first:\n  curl -L -o ${source} ${SOURCE_URL}`);
    process.exit(1);
  }
  sharp.cache(false);
  // The 21600×10800 source exceeds sharp's default pixel limit.
  const meta = await sharp(source, { limitInputPixels: false }).metadata();
  if (!meta.width || !meta.height || meta.width !== meta.height * 2) {
    throw new Error(`Expected a 2:1 equirectangular image, got ${meta.width}×${meta.height}`);
  }
  await mkdir(outDir, { recursive: true });
  for (const o of outputs) {
    if (o.width > meta.width) {
      console.warn(`Skipping ${o.file}: source is only ${meta.width}px wide`);
      continue;
    }
    const target = path.join(outDir, o.file);
    await sharp(source, { limitInputPixels: false })
      .resize(o.width, o.width / 2, { kernel: 'lanczos3', fit: 'fill' })
      .webp({ quality: o.quality, effort: 6, smartSubsample: true })
      .toFile(target);
    const { size } = await stat(target);
    console.log(`${o.file}: ${o.width}×${o.width / 2}, ${(size / 1024).toFixed(0)} KiB`);
  }
}

await main();
