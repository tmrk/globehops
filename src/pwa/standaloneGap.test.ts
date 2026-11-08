import { describe, expect, it } from 'vitest';
import { standaloneGap, type ViewportMetrics } from './standaloneGap.ts';

// iPhone 16 Pro Max at the Home Screen: 440×956 screen, 62 px status bar, layout viewport 894 px tall.
const phone: ViewportMetrics = {
  standalone: true,
  innerWidth: 440,
  innerHeight: 894,
  screenWidth: 440,
  screenHeight: 956,
  safeTop: 62,
};

describe('standaloneGap', () => {
  it('measures the status-bar-sized strip the layout viewport leaves at the bottom', () => {
    expect(standaloneGap(phone)).toBe(62);
  });
  it('is zero when the viewport already reaches the bottom or outside the Home Screen', () => {
    expect(standaloneGap({ ...phone, innerHeight: 956 })).toBe(0);
    expect(standaloneGap({ ...phone, standalone: false })).toBe(0);
    expect(standaloneGap({ ...phone, safeTop: 0 })).toBe(0);
  });
  it('ignores shortfalls that are not the status bar, such as an on-screen keyboard', () => {
    expect(standaloneGap({ ...phone, innerHeight: 600 })).toBe(0);
  });
  it('ignores windows narrower than the screen (iPad Split View, Stage Manager)', () => {
    const ipad = { standalone: true, screenWidth: 1032, screenHeight: 1376, safeTop: 24 };
    expect(standaloneGap({ ...ipad, innerWidth: 1032, innerHeight: 1352 })).toBe(24);
    expect(standaloneGap({ ...ipad, innerWidth: 694, innerHeight: 1352 })).toBe(0);
  });
  it('uses landscape screen dimensions when the window is wider than tall', () => {
    expect(standaloneGap({ ...phone, innerWidth: 956, innerHeight: 420, safeTop: 20 })).toBe(20);
    expect(standaloneGap({ ...phone, innerWidth: 956, innerHeight: 440 })).toBe(0);
  });
});
