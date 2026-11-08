/** Shared asset catalogue for the icon builder and PWA document generation. */
export interface SplashScreen {
  /** Portrait CSS pixels, before applying dpr. */
  width: number;
  height: number;
  dpr: number;
  devices: string;
}

export const SPLASH_SCREENS: readonly SplashScreen[] = [
  { width: 440, height: 956, dpr: 3, devices: 'iPhone 16/17 Pro Max' },
  { width: 402, height: 874, dpr: 3, devices: 'iPhone 16 Pro, 17, 17 Pro' },
  { width: 420, height: 912, dpr: 3, devices: 'iPhone Air' },
  { width: 430, height: 932, dpr: 3, devices: 'iPhone 14 Pro Max–16 Plus' },
  { width: 393, height: 852, dpr: 3, devices: 'iPhone 14 Pro–16' },
  { width: 428, height: 926, dpr: 3, devices: 'iPhone 12/13 Pro Max, 14 Plus' },
  { width: 390, height: 844, dpr: 3, devices: 'iPhone 12–14, 16e' },
  { width: 375, height: 812, dpr: 3, devices: 'iPhone X/XS/11 Pro, 12/13 mini' },
  { width: 414, height: 896, dpr: 3, devices: 'iPhone XS Max, 11 Pro Max' },
  { width: 414, height: 896, dpr: 2, devices: 'iPhone XR, 11' },
  { width: 414, height: 736, dpr: 3, devices: 'iPhone 8 Plus' },
  { width: 375, height: 667, dpr: 2, devices: 'iPhone SE 2/3, 8' },
  { width: 1032, height: 1376, dpr: 2, devices: 'iPad Pro 13″ M4' },
  { width: 1024, height: 1366, dpr: 2, devices: 'iPad Pro 12.9″, Air 13″' },
  { width: 834, height: 1210, dpr: 2, devices: 'iPad Pro 11″ M4' },
  { width: 834, height: 1194, dpr: 2, devices: 'iPad Pro 11″' },
  { width: 820, height: 1180, dpr: 2, devices: 'iPad Air 10.9/11″, iPad 10th+' },
  { width: 834, height: 1112, dpr: 2, devices: 'iPad Air 3, Pro 10.5″' },
  { width: 810, height: 1080, dpr: 2, devices: 'iPad 10.2″' },
  { width: 744, height: 1133, dpr: 2, devices: 'iPad mini 6/7' },
  { width: 768, height: 1024, dpr: 2, devices: 'Older iPads/minis' },
];

/** One entry per screen and orientation; file is relative to public/. */
export function splashFiles(): { file: string; width: number; height: number; media: string }[] {
  return SPLASH_SCREENS.flatMap(({ width, height, dpr }) =>
    (['portrait', 'landscape'] as const).map((orientation) => {
      const pixelWidth = (orientation === 'portrait' ? width : height) * dpr;
      const pixelHeight = (orientation === 'portrait' ? height : width) * dpr;
      return {
        file: `splash/${pixelWidth}x${pixelHeight}.png`,
        width: pixelWidth,
        height: pixelHeight,
        media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})`,
      };
    }),
  );
}

/** Startup-image links, with base including its trailing slash. */
export function splashLinkTags(base: string): string {
  return splashFiles()
    .map(({ file, media }) => `<link rel="apple-touch-startup-image" media="${media}" href="${base}${file}">`)
    .join('\n');
}

export const APP_ICONS: readonly { src: string; sizes: string; purpose: 'any' | 'maskable' }[] = [
  { src: 'icon-192.png', sizes: '192x192', purpose: 'any' },
  { src: 'icon-512.png', sizes: '512x512', purpose: 'any' },
  { src: 'icon-maskable-192.png', sizes: '192x192', purpose: 'maskable' },
  { src: 'icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
];

export const SCREENSHOTS: readonly {
  src: string;
  sizes: string;
  type: 'image/webp';
  form_factor: 'wide' | 'narrow';
}[] = [
  { src: 'screenshots/wide.webp', sizes: '1440x900', type: 'image/webp', form_factor: 'wide' },
  { src: 'screenshots/narrow.webp', sizes: '1082x2202', type: 'image/webp', form_factor: 'narrow' },
];
