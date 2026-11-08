import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { APP_ICONS, SCREENSHOTS, SPLASH_SCREENS, splashFiles, splashLinkTags } from './pwa-assets.ts';

const pub = (file: string) => path.resolve(import.meta.dirname, '../public', file);

describe('iOS startup images', () => {
  it('covers all 21 screens in both orientations without duplicate files or media queries', () => {
    const files = splashFiles();
    expect(SPLASH_SCREENS).toHaveLength(21);
    expect(files).toHaveLength(42);
    expect(new Set(files.map(({ file }) => file)).size).toBe(42);
    expect(new Set(files.map(({ media }) => media)).size).toBe(42);
    SPLASH_SCREENS.forEach(({ width, height, dpr }, i) => {
      for (const [j, orientation] of ['portrait', 'landscape'].entries()) {
        const asset = files[i * 2 + j];
        const w = (j === 0 ? width : height) * dpr;
        const h = (j === 0 ? height : width) * dpr;
        expect(asset).toEqual({
          file: `splash/${w}x${h}.png`,
          width: w,
          height: h,
          media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})`,
        });
      }
    });
  });

  it.each(splashFiles())('$file has the declared pixel dimensions and an opaque app backdrop', async (asset) => {
    const metadata = await sharp(pub(asset.file)).metadata();
    expect(metadata.width).toBe(asset.width);
    expect(metadata.height).toBe(asset.height);
    const { data } = await sharp(pub(asset.file))
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data]).toEqual([4, 6, 12, 255]);
  });

  it('emits exactly one well-formed, base-prefixed startup link per image', () => {
    const lines = splashLinkTags('/globehops/').split('\n');
    expect(lines).toHaveLength(splashFiles().length);
    splashFiles().forEach(({ media, file }, i) => {
      expect(lines[i]).toBe(`<link rel="apple-touch-startup-image" media="${media}" href="/globehops/${file}">`);
      expect(lines[i]).toMatch(
        /^<link rel="apple-touch-startup-image" media="[^"<>]+" href="\/globehops\/splash\/\d+x\d+\.png">$/,
      );
    });
  });
});

describe('manifest assets', () => {
  it.each([...APP_ICONS, ...SCREENSHOTS, { src: 'apple-touch-icon.png', sizes: '180x180' }])(
    '$src exists at $sizes',
    async ({ src, sizes }) => {
      const metadata = await sharp(pub(src)).metadata();
      expect(`${metadata.width}x${metadata.height}`).toBe(sizes);
      expect(metadata.format).toBe(src.endsWith('.webp') ? 'webp' : 'png');
      if (src.includes('maskable') || src === 'apple-touch-icon.png') expect(metadata.hasAlpha).toBe(false);
    },
  );

  it('provides both required sizes for each icon purpose and both screenshot form factors', () => {
    expect(APP_ICONS.map(({ sizes, purpose }) => `${sizes}:${purpose}`).sort()).toEqual([
      '192x192:any',
      '192x192:maskable',
      '512x512:any',
      '512x512:maskable',
    ]);
    expect(SCREENSHOTS.map(({ form_factor, type }) => `${form_factor}:${type}`).sort()).toEqual([
      'narrow:image/webp',
      'wide:image/webp',
    ]);
  });
});
