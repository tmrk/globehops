import { useI18n } from '../i18n/I18nProvider.tsx';
import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { searchAirports, type SearchIndex } from '../data/search.ts';
import type { Airport } from '../types.ts';
import { CodeBadge } from './CodeBadge.tsx';
import { IconBack, IconSearch } from './Icons.tsx';

export interface AirportPickerProps {
  index: SearchIndex | null;
  /** Accessible label, e.g. "Departure airport". */
  label: string;
  /** Short visible caption in the takeover header, e.g. "From". */
  caption: string;
  placeholder: string;
  variant: 'inline' | 'takeover';
  onSelect: (airport: Airport) => void;
  onCancel: () => void;
}

export interface AirportPickerHandle {
  focus: () => void;
  reset: () => void;
}

/**
 * WAI-ARIA 1.2 combobox with a listbox popup. Search runs locally over the bundled
 * OurAirports dataset on every keystroke (well under a millisecond per query).
 */
export const AirportPicker = forwardRef<AirportPickerHandle, AirportPickerProps>(function AirportPicker(
  { index, label, caption, placeholder, variant, onSelect, onCancel },
  ref,
) {
  const { t, fmt } = useI18n();

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const pressRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const tapSelectedAt = useRef(-Infinity);
  const listRef = useRef<HTMLUListElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const popover = usePopoverPosition(fieldRef, variant === 'inline');
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus({ preventScroll: true }),
    reset: () => {
      setQuery('');
      setActive(-1);
    },
  }));

  const results = useMemo(() => (index && query.trim() ? searchAirports(index, query, 8) : []), [index, query]);
  const open = results.length > 0;
  const trimmed = query.trim();

  const choose = (a: Airport | undefined) => {
    if (!a) return;
    onSelect(a);
    setQuery('');
    setActive(-1);
  };

  const moveActive = (next: number) => {
    setActive(next);
    const el = listRef.current?.children[next] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        if (!open) return;
        e.preventDefault();
        moveActive(active < results.length - 1 ? active + 1 : 0);
        break;
      case 'ArrowUp':
        if (!open) return;
        e.preventDefault();
        moveActive(active > 0 ? active - 1 : results.length - 1);
        break;
      case 'Enter':
        if (!open) return;
        e.preventDefault();
        choose(results[active >= 0 ? active : 0]);
        break;
      case 'Escape':
        e.preventDefault();
        if (query) {
          setQuery('');
          setActive(-1);
        } else onCancel();
        break;
    }
  };

  const onBlur = (e: React.FocusEvent) => {
    // Inline pickers close when focus leaves them; the mobile takeover stays open so the
    // results remain browsable after the keyboard is dismissed.
    if (variant !== 'inline') return;
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    onCancel();
  };

  let status: string;
  if (!index) status = t('picker.loadingAirports');
  else if (!trimmed) status = t('picker.hint');
  else if (!results.length) status = t('picker.noMatches', trimmed);
  else status = t(results.length === 1 ? 'picker.oneSuggestion' : 'picker.suggestions', fmt.number(results.length));

  const list = (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={t('picker.results')}
      className="picker__list"
      hidden={!open}
    >
      {results.map((a, i) => (
        <li
          key={a.id}
          id={optionId(i)}
          role="option"
          aria-selected={i === active}
          className={`picker__option${i === active ? ' is-active' : ''}`}
          // Keep focus in the input so the keyboard stays up and blur doesn't close the list.
          onPointerDown={(e) => {
            e.preventDefault();
            pressRef.current = { id: a.id, x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => e.pointerType === 'mouse' && active !== i && setActive(i)}
          onPointerUp={(e) => {
            // Touch: preventing pointerdown (to keep the keyboard up) can suppress the click
            // event in some browsers, so select on pointerup for taps that didn't scroll.
            const press = pressRef.current;
            pressRef.current = null;
            if (e.pointerType === 'mouse' || !press || press.id !== a.id) return;
            if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) return;
            tapSelectedAt.current = performance.now();
            choose(a);
          }}
          onPointerCancel={() => (pressRef.current = null)}
          onClick={() => {
            // Mouse and keyboard-synthesised clicks; skip the click that may follow a handled tap.
            if (performance.now() - tapSelectedAt.current < 700) return;
            choose(a);
          }}
        >
          <CodeBadge airport={a} />
          <span className="picker__text">
            <span className="picker__name">{a.name}</span>
            <span className="picker__place">{fmt.place(a)}</span>
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`picker picker--${variant}`} onBlur={onBlur}>
      <div className="picker__bar">
        {variant === 'takeover' && (
          <button
            type="button"
            className="icon-btn picker__back"
            onClick={onCancel}
            aria-label={t('picker.backToJourney')}
          >
            <IconBack />
          </button>
        )}
        <div className="picker__field" ref={fieldRef}>
          {variant === 'takeover' && <span className="picker__caption">{caption}</span>}
          <IconSearch className="picker__icon" size={18} />
          <input
            ref={inputRef}
            className="picker__input"
            type="text"
            role="combobox"
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={placeholder}
            value={query}
            autoFocus={variant === 'inline'}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
              listRef.current?.scrollTo?.({ top: 0 });
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      {variant === 'inline' ? (
        // The inline suggestions float over the itinerary, so opening the search never moves the rows.
        popover &&
        createPortal(
          <div className={`picker__popover${popover.above ? ' is-above' : ''}`} style={popover.style}>
            {list}
            {!open && <p className="picker__status">{status}</p>}
          </div>,
          document.body,
        )
      ) : (
        <>
          {list}
          {!open && <p className="picker__status">{status}</p>}
        </>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {trimmed ? status : ''}
      </span>
    </div>
  );
});

const GAP = 6;
const MARGIN = 12;

/** Fixed-position placement under (or, when space is short, above) the field; follows scroll and resize. */
function usePopoverPosition(fieldRef: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [placement, setPlacement] = useState<{ style: React.CSSProperties; above: boolean } | null>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!enabled || !field) return;
    const update = () => {
      const r = field.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP - MARGIN;
      const aboveSpace = r.top - GAP - MARGIN;
      const above = below < 240 && aboveSpace > below;
      const style: React.CSSProperties = {
        left: Math.round(r.left),
        width: Math.round(r.width),
        maxHeight: Math.max(120, Math.min(420, above ? aboveSpace : below)),
        ...(above ? { bottom: Math.round(window.innerHeight - r.top + GAP) } : { top: Math.round(r.bottom + GAP) }),
      };
      setPlacement((prev) => (prev && JSON.stringify(prev.style) === JSON.stringify(style) ? prev : { style, above }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(field);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [fieldRef, enabled]);
  return enabled ? placement : null;
}
