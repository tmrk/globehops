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
  /** The globe's floating time dial (desktop, no flights): the globe keeps clear of it and the top bar. */
  dial: boolean;
}

export function usePanelInsets(panelRef: RefObject<HTMLElement | null>, layout: PanelLayout) {
  const { isDesktop, collapsed, editing, stops, selectedLeg, timeOpen, initialized, arranging, dial } = layout;
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  const [sheetInset, setSheetInset] = useState(0);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // On phones the open time bar is part of the sheet, so the sheet alone covers the bottom of the globe.
    const measure = () => {
      const r = panel.getBoundingClientRect();
      const sheet = Math.max(0, Math.round(window.innerHeight - r.top));
      setSheetInset((prev) => (Math.abs(prev - sheet) < 2 ? prev : sheet));
      const floating = isDesktop && dial ? document.querySelector('.hud-wrap .time-dial') : null;
      const below = floating ? Math.round(window.innerHeight - floating.getBoundingClientRect().top) + 8 : 0;
      const next: Insets = isDesktop
        ? { top: floating ? 56 : 0, right: 0, bottom: below, left: Math.round(r.right) }
        : { top: 56, right: 0, bottom: sheet + 8, left: 0 };
      setInsets((prev) =>
        Math.abs(prev.left - next.left) < 2 && Math.abs(prev.bottom - next.bottom) < 2 && prev.top === next.top
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [panelRef, isDesktop, collapsed, editing, stops, selectedLeg, timeOpen, initialized, arranging, dial]);

  return { insets, sheetInset };
}
