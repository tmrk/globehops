import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { pushUrl, replaceUrl } from '../analytics.ts';
import { parseLink, type LinkState } from '../state/link.ts';
import type { SearchIndex } from '../data/search.ts';
import type { AirportPickerHandle } from '../components/AirportPicker.tsx';

interface PickerHistoryOptions {
  isDesktop: boolean;
  index: SearchIndex | null;
  applyLink: (link: LinkState, index: SearchIndex, search: string) => void;
  setEditing: Dispatch<SetStateAction<number | null>>;
  takeoverRef: RefObject<AirportPickerHandle | null>;
  panelRef: RefObject<HTMLElement | null>;
}

export function usePickerHistory({
  isDesktop,
  index,
  applyLink,
  setEditing,
  takeoverRef,
  panelRef,
}: PickerHistoryOptions) {
  // The mobile search takeover gets its own history entry so the Android/browser back
  // button closes it instead of leaving the site.
  const pickerEntry = useRef(false);
  const ignoreNextPop = useRef(false);
  const shareUrlRef = useRef('');

  // Back/forward navigation between shared links.
  useEffect(() => {
    const onPop = () => {
      if (ignoreNextPop.current) {
        // We stepped back over the picker entry ourselves; keep the current route in the URL.
        ignoreNextPop.current = false;
        replaceUrl(shareUrlRef.current, null);
        return;
      }
      if (pickerEntry.current) {
        pickerEntry.current = false;
        setEditing(null);
        replaceUrl(shareUrlRef.current, null);
        return;
      }
      const idx = index;
      const link = parseLink(window.location.search);
      if (idx) {
        if (link.stops === null) link.stops = [];
        applyLink(link, idx, window.location.search);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyLink, index, setEditing]);

  const focusFrameRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    },
    [],
  );
  const focusStopButton = (index: number) => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      panelRef.current?.querySelectorAll<HTMLButtonElement>('.stop__main')[index]?.focus({ preventScroll: false });
    });
  };

  const focusTakeover = () => {
    if (isDesktop) return;
    if (!pickerEntry.current) {
      pickerEntry.current = true;
      pushUrl(window.location.href, { globehopsPicker: true });
    }
    takeoverRef.current?.reset();
    // Focus synchronously inside the user gesture so iOS raises the keyboard.
    takeoverRef.current?.focus();
  };

  const releasePickerEntry = () => {
    if (!pickerEntry.current) return;
    pickerEntry.current = false;
    ignoreNextPop.current = true;
    window.history.back();
  };

  const updatePickerAddress = useCallback((address: string) => {
    shareUrlRef.current = address;
  }, []);
  return { focusTakeover, releasePickerEntry, updatePickerAddress, focusStopButton };
}
