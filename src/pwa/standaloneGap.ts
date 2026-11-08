/**
 * iOS home-screen apps with `black-translucent` status bars and `viewport-fit=cover` start the layout
 * viewport under the status bar but make it shorter by the status bar's height (WebKit bug 237961), so
 * `position: fixed; inset: 0` stops one status bar short of the bottom edge and leaves a black strip.
 * The app measures that shortfall and extends its fixed root (and bottom-anchored sheets) by it.
 */
export interface ViewportMetrics {
  /** iOS `navigator.standalone`: running from the Home Screen. */
  standalone: boolean;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  /** Resolved `env(safe-area-inset-top)` in CSS pixels. */
  safeTop: number;
}

/** CSS pixels missing below the layout viewport, or 0 when the viewport already reaches the bottom. */
export function standaloneGap(m: ViewportMetrics): number {
  if (!m.standalone || m.safeTop <= 0) return 0;
  // iOS reports portrait screen dimensions regardless of orientation.
  const landscape = m.innerWidth > m.innerHeight;
  const short = Math.min(m.screenWidth, m.screenHeight);
  const long = Math.max(m.screenWidth, m.screenHeight);
  // Only a window spanning the whole screen width (not iPad Split View or Stage Manager) owns the bottom edge.
  if (Math.abs(m.innerWidth - (landscape ? long : short)) > 1) return 0;
  const gap = Math.round((landscape ? short : long) - m.innerHeight);
  // The shortfall is exactly the status bar; anything else (e.g. an on-screen keyboard) is not this bug.
  return gap > 0 && Math.abs(gap - m.safeTop) <= 4 ? gap : 0;
}

let current = 0;

/** The measured gap, for code that converts viewport heights into app heights. */
export function currentStandaloneGap(): number {
  return current;
}

function safeAreaTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)';
  document.body.append(probe);
  const value = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return value;
}

/** Keeps `--standalone-gap` on <html> current; a no-op outside iOS home-screen apps. */
export function watchStandaloneGap(): void {
  if (!('standalone' in navigator) || navigator.standalone !== true) return;
  const update = () => {
    current = standaloneGap({
      standalone: true,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      screenWidth: screen.width,
      screenHeight: screen.height,
      safeTop: safeAreaTop(),
    });
    document.documentElement.style.setProperty('--standalone-gap', `${current}px`);
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => requestAnimationFrame(update));
}
