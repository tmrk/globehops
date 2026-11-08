import { describe, expect, it } from 'vitest';
import { standaloneGap, type ViewportMetrics } from './standaloneGap.ts';

// iPhone 16 Pro at the Home Screen: 402×874 screen, fixed UI stops one 62 px status bar short.
const phone: ViewportMetrics = {
  standalone: true,
  innerWidth: 402,
  fixedHeight: 812,
  screenWidth: 402,
  screenHeight: 874,
};

describe('standaloneGap', () => {
  it('measures the strip that fixed-position UI leaves at the bottom', () => {
    expect(standaloneGap(phone)).toBe(62);
  });
  it('is zero when fixed UI already reaches the bottom or outside the Home Screen', () => {
    expect(standaloneGap({ ...phone, fixedHeight: 874 })).toBe(0);
    expect(standaloneGap({ ...phone, standalone: false })).toBe(0);
    expect(standaloneGap({ ...phone, fixedHeight: 0 })).toBe(0);
  });
  it('ignores differences far larger than a status bar', () => {
    expect(standaloneGap({ ...phone, fixedHeight: 600 })).toBe(0);
  });
  it('ignores windows narrower than the screen (iPad Split View, Stage Manager)', () => {
    const ipad = { standalone: true, screenWidth: 1032, screenHeight: 1376 };
    expect(standaloneGap({ ...ipad, innerWidth: 1032, fixedHeight: 1352 })).toBe(24);
    expect(standaloneGap({ ...ipad, innerWidth: 694, fixedHeight: 1352 })).toBe(0);
  });
  it('uses landscape screen dimensions when the window is wider than tall', () => {
    expect(standaloneGap({ ...phone, innerWidth: 874, fixedHeight: 382 })).toBe(20);
    expect(standaloneGap({ ...phone, innerWidth: 874, fixedHeight: 402 })).toBe(0);
  });
});
