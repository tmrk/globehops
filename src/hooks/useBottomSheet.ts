import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { sheetDragOffset, sheetRelease } from '../lib/sheet.ts';

const DURATION = 240;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Approximate collapsed height (handle + peek row); only used to aim the collapse animation. */
const PEEK_HEIGHT = 74;
/** The sheet's handle; with the timeline docked in the sheet, the collapsed sheet is handle + timeline. */
const HANDLE_HEIGHT = 22;

/** Height the sheet keeps when collapsed: the docked timeline stays, otherwise the peek bar. */
function peekHeight(panel: HTMLElement) {
  const bar = panel.querySelector<HTMLElement>('.time-bar');
  return bar ? HANDLE_HEIGHT + bar.offsetHeight : PEEK_HEIGHT;
}

interface Options {
  enabled: boolean;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  reducedMotion: boolean;
}

/**
 * Native-feeling bottom sheet: drag the sheet down (from its handle, header, or content scrolled to
 * the top) to collapse it to its peek bar, and lift the peek bar to expand it. Movement is applied
 * imperatively as a transform, so dragging never re-renders React.
 */
export function useBottomSheet(panelRef: React.RefObject<HTMLElement | null>, options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const busy = useRef(false);
  const cancelSlide = useRef<(() => void) | null>(null);
  /** Height and drag offset just before the sheet changes state, for a continuous expand animation. */
  const before = useRef<{ height: number; offset: number } | null>(null);

  const slide = useCallback(
    (from: number, to: number, done?: () => void) => {
      cancelSlide.current?.();
      const panel = panelRef.current;
      if (!panel) return done?.();
      if (latest.current.reducedMotion) {
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

  /** Slides the expanded sheet down to where the peek bar will sit, then collapses it. */
  const collapse = useCallback(
    (fromOffset = 0) => {
      const panel = panelRef.current;
      if (!panel || latest.current.collapsed) return;
      const target = Math.max(0, panel.offsetHeight - peekHeight(panel));
      slide(fromOffset, target, () => {
        latest.current.setCollapsed(true);
        panel.style.transform = '';
      });
    },
    [panelRef, slide],
  );

  const expand = useCallback(
    (fromOffset = 0) => {
      const panel = panelRef.current;
      if (!panel || !latest.current.collapsed) return;
      before.current = { height: panel.offsetHeight, offset: fromOffset };
      latest.current.setCollapsed(false);
    },
    [panelRef],
  );

  useLayoutEffect(() => {
    if (!options.enabled || options.reducedMotion) cancelSlide.current?.();
    return () => cancelSlide.current?.();
  }, [options.enabled, options.reducedMotion]);

  // Expanding swaps the peek bar for the full sheet; start it where the peek bar was and slide up.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const start = before.current;
    before.current = null;
    if (!panel || options.collapsed || !start) return;
    slide(Math.max(0, panel.offsetHeight - start.height + start.offset), 0);
  }, [options.collapsed, panelRef, slide]);

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
    } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || busy.current) return;
      const target = e.target as Element;
      // Native controls (layover menus, date pickers, the search field, the timeline) keep their own gestures.
      if (target.closest('input, select, textarea')) return;
      const y = e.touches[0].clientY;
      drag = {
        startY: y,
        lastY: y,
        lastT: e.timeStamp,
        velocity: 0,
        offset: 0,
        active: false,
        scroller: target.closest<HTMLElement>('.panel__scroll'),
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
      const collapsed = latest.current.collapsed;
      if (!drag.active) {
        const dy = y - drag.startY;
        if (Math.abs(dy) < 6) return;
        // Content scrolls normally unless it is already at the top and the finger moves down.
        if (drag.scroller && (dy < 0 || drag.scroller.scrollTop > 0)) {
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
      drag.offset = sheetDragOffset(y - drag.startY, collapsed);
      panel.style.transform = drag.offset ? `translateY(${drag.offset}px)` : '';
    };

    const onEnd = () => {
      const current = drag;
      drag = null;
      if (!current?.active) return;
      const { collapsed } = latest.current;
      const action = sheetRelease({
        offset: current.offset,
        velocity: current.velocity,
        height: panel.offsetHeight,
        collapsed,
      });
      if (action === 'collapse') collapse(current.offset);
      else if (action === 'expand') expand(current.offset);
      else slide(current.offset, 0);
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
  }, [options.enabled, panelRef, collapse, expand, slide]);

  return { collapse, expand };
}
