import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { sheetDragOffset, sheetRelease, type SheetDetent } from '../lib/sheet.ts';

const DURATION = 260;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Approximate collapsed height (handle + peek row), until the sheet has been seen collapsed. */
const PEEK_HEIGHT = 74;
/** The sheet's handle; with the timeline docked in the sheet, the collapsed sheet is handle + timeline. */
const HANDLE_HEIGHT = 22;

/** Estimated height the sheet keeps when collapsed: the docked timeline or launcher stays, else the peek bar. */
function estimatedPeekHeight(panel: HTMLElement) {
  const bar = panel.querySelector<HTMLElement>('.time-bar, .launcher');
  return bar ? HANDLE_HEIGHT + bar.offsetHeight : PEEK_HEIGHT;
}

interface Options {
  enabled: boolean;
  detent: SheetDetent;
  /** Moves the sheet to another detent (state only; the hook animates). */
  onDetent: (detent: SheetDetent) => void;
  reducedMotion: boolean;
  /**
   * What the collapsed sheet shows (the timeline, the launcher, the globe's dial, a route summary). Each
   * kind's measured height aims later collapse animations, so the sheet comes to rest exactly where its peek
   * will be.
   */
  peek: string;
}

/**
 * Native-feeling bottom sheet with three heights: drag it down (from its handle, header, or content
 * scrolled to the top) towards its peek bar, lift it to show the journey, and lift a journey that does
 * not fit further to edit it at nearly full height. Movement is applied imperatively as a transform, so
 * dragging never re-renders React; a changed height animates from where the sheet was (FLIP).
 */
export function useBottomSheet(panelRef: React.RefObject<HTMLElement | null>, options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const busy = useRef(false);
  const cancelSlide = useRef<(() => void) | null>(null);
  /** The sheet's visual top just before it changed detent, so the new height starts where it was. */
  const flipFrom = useRef<number | null>(null);
  const peekHeights = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel && options.enabled && options.detent === 'peek' && !busy.current)
      peekHeights.current.set(options.peek, panel.offsetHeight);
  });

  const slide = useCallback(
    (from: number, to: number, done?: () => void) => {
      cancelSlide.current?.();
      const panel = panelRef.current;
      if (!panel) return done?.();
      if (latest.current.reducedMotion || Math.abs(from - to) < 1) {
        panel.style.transition = '';
        panel.style.transform = '';
        return done?.();
      }
      busy.current = true;
      panel.style.transition = 'none';
      panel.style.transform = `translateY(${from}px)`;
      void panel.offsetHeight; // commit the start position before transitioning
      panel.style.transition = `transform ${DURATION}ms ${EASE}`;
      panel.style.transform = to ? `translateY(${to}px)` : '';
      const cleanup = () => {
        panel.removeEventListener('transitionend', onTransitionEnd);
        window.clearTimeout(timer);
        cancelSlide.current = null;
        busy.current = false;
        panel.style.transition = '';
        panel.style.transform = '';
      };
      const end = () => {
        cleanup();
        done?.();
      };
      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target === panel && event.propertyName === 'transform') end();
      };
      const timer = window.setTimeout(end, DURATION + 100);
      panel.addEventListener('transitionend', onTransitionEnd);
      cancelSlide.current = cleanup;
    },
    [panelRef],
  );

  /** Slides the sheet down to where the peek bar will sit, then collapses it. */
  const collapse = useCallback(
    (fromOffset = 0) => {
      const panel = panelRef.current;
      if (!panel || latest.current.detent === 'peek') return;
      const peek = peekHeights.current.get(latest.current.peek) ?? estimatedPeekHeight(panel);
      const target = Math.max(0, panel.offsetHeight - peek);
      slide(fromOffset, target, () => {
        latest.current.onDetent('peek');
        panel.style.transform = '';
      });
    },
    [panelRef, slide],
  );

  /**
   * Moves to another detent. Collapsing slides the content away first; otherwise the sheet changes height
   * at once and its top glides from where it was (the sheet's background continues below its bottom edge,
   * so a shrinking sheet never uncovers the globe beneath it).
   */
  const goTo = useCallback(
    (next: SheetDetent, fromOffset = 0) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (next === latest.current.detent) return slide(fromOffset, 0);
      if (next === 'peek') return collapse(fromOffset);
      cancelSlide.current?.();
      flipFrom.current = panel.getBoundingClientRect().top;
      latest.current.onDetent(next);
    },
    [panelRef, slide, collapse],
  );
  const expand = useCallback((fromOffset = 0) => goTo('half', fromOffset), [goTo]);

  useLayoutEffect(() => {
    if (!options.enabled || options.reducedMotion) cancelSlide.current?.();
    return () => cancelSlide.current?.();
  }, [options.enabled, options.reducedMotion]);

  // A new height starts where the sheet's top was and glides to its resting place.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!panel || from === null || !options.enabled) return;
    panel.style.transition = 'none';
    panel.style.transform = '';
    slide(from - panel.getBoundingClientRect().top, 0);
  }, [options.detent, options.enabled, panelRef, slide]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!options.enabled || !panel) return;
    let drag: {
      startY: number;
      lastY: number;
      lastT: number;
      velocity: number;
      offset: number;
      active: boolean;
      scroller: HTMLElement | null;
      canGrow: boolean;
    } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || busy.current) return;
      const target = e.target as Element;
      // Native controls (layover menus, date pickers, the search field, the timeline) keep their own gestures.
      if (target.closest('input, select, textarea')) return;
      const y = e.touches[0].clientY;
      const list = panel.querySelector<HTMLElement>('.panel__scroll');
      drag = {
        startY: y,
        lastY: y,
        lastT: e.timeStamp,
        velocity: 0,
        offset: 0,
        active: false,
        scroller: target.closest<HTMLElement>('.panel__scroll'),
        canGrow: !!list && list.scrollHeight > list.clientHeight + 4,
      };
    };

    const onMove = (e: TouchEvent) => {
      if (!drag) return;
      if (e.touches.length !== 1) {
        drag = null;
        panel.style.transform = '';
        panel.style.transition = '';
        return;
      }
      const y = e.touches[0].clientY;
      const { detent } = latest.current;
      if (!drag.active) {
        const dy = y - drag.startY;
        if (Math.abs(dy) < 6) return;
        // The list scrolls normally, except that a half sheet whose list does not fit grows first (as native
        // sheets do), and a list already at its top hands a downward drag to the sheet.
        const grows = detent === 'half' && drag.canGrow && dy < 0;
        if (drag.scroller && !grows && (dy < 0 || drag.scroller.scrollTop > 0)) {
          drag = null;
          return;
        }
        drag.active = true;
        drag.startY = y;
        panel.style.transition = 'none';
      }
      e.preventDefault();
      // Measure velocity over windows of at least 8 ms: coalesced events can arrive almost together.
      const dt = e.timeStamp - drag.lastT;
      if (dt >= 8) {
        drag.velocity = 0.7 * ((y - drag.lastY) / dt) + 0.3 * drag.velocity;
        drag.lastY = y;
        drag.lastT = e.timeStamp;
      }
      drag.offset = sheetDragOffset(y - drag.startY, detent, drag.canGrow);
      panel.style.transform = drag.offset ? `translateY(${drag.offset}px)` : '';
    };

    const onEnd = () => {
      const current = drag;
      drag = null;
      if (!current?.active) return;
      const { detent } = latest.current;
      const next = sheetRelease({
        offset: current.offset,
        velocity: current.velocity,
        height: panel.offsetHeight,
        detent,
        canGrow: current.canGrow,
      });
      goTo(next, current.offset);
    };

    panel.addEventListener('touchstart', onStart, { passive: true });
    panel.addEventListener('touchmove', onMove, { passive: false });
    panel.addEventListener('touchend', onEnd);
    panel.addEventListener('touchcancel', onEnd);
    return () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onEnd);
      cancelSlide.current?.();
      panel.style.transform = '';
      panel.style.transition = '';
    };
  }, [options.enabled, panelRef, goTo]);

  return { collapse, expand, goTo };
}
