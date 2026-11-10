import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Insets } from '../globe/GlobeRenderer.ts';
import type { Stop } from '../types.ts';

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
interface PanelLayout {
  isDesktop: boolean;
  collapsed: boolean;
  editing: number | null;
  stops: Stop[];
  selectedLeg: number | null;
  timeOpen: boolean;
  initialized: boolean;
  arranging: boolean;
  /**
   * Desktop: what floats beneath the globe (the time dial without flights, else the play launcher or the
   * open timeline); the globe keeps clear of it and, with the dial, of the top bar.
   */
  floating: 'dial' | 'launcher' | 'timeline' | null;
  /** Phones: a full-height sheet covers the globe, so its framing waits for the sheet to come down. */
  frozen?: boolean;
  /** Cinematic playback: the panel and the top bar step aside, and the globe takes their room. */
  cinematic?: boolean;
}

export function usePanelInsets(panelRef: RefObject<HTMLElement | null>, layout: PanelLayout) {
  const {
    isDesktop,
    collapsed,
    editing,
    stops,
    selectedLeg,
    timeOpen,
    initialized,
    arranging,
    floating,
    frozen,
    cinematic = false,
  } = layout;
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  const [sheetInset, setSheetInset] = useState(0);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // On phones the open time bar is part of the sheet, so the sheet alone covers the bottom of the globe.
    const measure = () => {
      if (frozen) return;
      const r = panel.getBoundingClientRect();
      const sheet = Math.max(0, Math.round(window.innerHeight - r.top));
      setSheetInset((prev) => (Math.abs(prev - sheet) < 2 ? prev : sheet));
      const bar =
        isDesktop && floating
          ? document.querySelector('.hud-wrap > .time-dial, .hud-wrap > .launcher, .hud-wrap > .time-bar')
          : null;
      const below = bar ? Math.round(window.innerHeight - bar.getBoundingClientRect().top) + 8 : 0;
      const next: Insets = isDesktop
        ? { top: floating === 'dial' ? 56 : 0, right: 0, bottom: below, left: cinematic ? 0 : Math.round(r.right) }
        : { top: cinematic ? 8 : 56, right: 0, bottom: sheet + 8, left: 0 };
      setInsets((prev) =>
        Math.abs(prev.left - next.left) < 2 && Math.abs(prev.bottom - next.bottom) < 2 && prev.top === next.top
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    const bar = document.querySelector('.hud-wrap > .time-dial, .hud-wrap > .launcher, .hud-wrap > .time-bar');
    if (bar) ro.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    panelRef,
    isDesktop,
    collapsed,
    editing,
    stops,
    selectedLeg,
    timeOpen,
    initialized,
    arranging,
    floating,
    frozen,
    cinematic,
  ]);

  return { insets, sheetInset };
}
