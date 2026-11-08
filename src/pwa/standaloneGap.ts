/**
 * iOS home-screen apps with `black-translucent` status bars and `viewport-fit=cover` start the layout
 * viewport under the status bar but make it shorter by the status bar's height (WebKit bug 237961), so
 * `position: fixed; inset: 0` stops one status bar short of the bottom edge and leaves a black strip.
 * The app measures that shortfall and extends its fixed root (and bottom-anchored sheets) by it.
 */
export interface ViewportMetrics {
  /** Running as an iOS home-screen app. */
  standalone: boolean;
  innerWidth: number;
  /** Height of a `position: fixed; top: 0; bottom: 0` box — what bottom-anchored UI actually gets. */
  fixedHeight: number;
  screenWidth: number;
  screenHeight: number;
}

/** CSS pixels missing below fixed-position UI, or 0 when it already reaches the bottom edge. */
export function standaloneGap(m: ViewportMetrics): number {
  if (!m.standalone || m.fixedHeight <= 0) return 0;
  // iOS reports portrait screen dimensions regardless of orientation.
  const landscape = m.innerWidth > m.fixedHeight;
  const short = Math.min(m.screenWidth, m.screenHeight);
  const long = Math.max(m.screenWidth, m.screenHeight);
  // Only a window spanning the whole screen width (not iPad Split View or Stage Manager) owns the bottom edge.
  if (Math.abs(m.innerWidth - (landscape ? long : short)) > 1) return 0;
  const gap = Math.round((landscape ? short : long) - m.fixedHeight);
  // The bug costs one status bar (≈ 20–62 px); larger differences are some other window shape.
  return gap > 0 && gap <= 100 ? gap : 0;
}

let current = 0;
let fixedHeight = 0;

/** The measured gap, for code that converts viewport heights into app heights. */
export function currentStandaloneGap(): number {
  return current;
}

/** Height available to fixed-position UI before the gap (0 until measured). */
export function standaloneFixedHeight(): number {
  return fixedHeight;
}

function measureFixedHeight(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;bottom:0;left:0;width:1px;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

function isIosHomeScreenApp(): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    ('standalone' in navigator && navigator.standalone === true) ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;
  return ios && standalone;
}

/** Keeps `--standalone-gap` on <html> current; a no-op outside iOS home-screen apps. */
export function watchStandaloneGap(): void {
  if (!isIosHomeScreenApp()) return;
  const update = () => {
    fixedHeight = measureFixedHeight();
    current = standaloneGap({
      standalone: true,
      innerWidth: window.innerWidth,
      fixedHeight,
      screenWidth: screen.width,
      screenHeight: screen.height,
    });
    document.documentElement.style.setProperty('--standalone-gap', `${current}px`);
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('pageshow', update);
  window.addEventListener('orientationchange', () => requestAnimationFrame(update));
  // iOS settles the standalone viewport after launch; re-measure once it has.
  window.addEventListener('load', () => requestAnimationFrame(update));
}
