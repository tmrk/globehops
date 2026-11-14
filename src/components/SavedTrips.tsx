import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { Translate } from '../i18n/catalogue.ts';
import type { uiFormatters } from '../i18n/uiFormat.ts';
import { routeCodesText, type SavedTripSummary } from '../state/savedTripSummary.ts';
import { extractLinkQuery } from '../state/sharedLink.ts';
import type { RemovedTrip, SavedTripView } from '../hooks/useSavedTrips.ts';
import {
  IconAlert,
  IconBookmark,
  IconClose,
  IconCompare,
  IconLink,
  IconPlane,
  IconReturn,
  IconTrash,
} from './Icons.tsx';

/** How many saved trips the empty planner lists before “All saved trips”. */
const INLINE_LIMIT = 3;
/** How long a removed trip can be brought back. */
const UNDO_MS = 6000;

interface TripText {
  title: string;
  /** The title is airport codes (set in the departure-board face), not the trip's own name. */
  codes: boolean;
  /** Dates when the trip has them, else what it contains. */
  when: string;
  /** Second line in the full list: the route under a name, else the dates and count. */
  detail: string;
}

/** A saved trip in words: its name or route, its dates, and how many flights or alternatives it holds. */
function savedTripText(summary: SavedTripSummary, t: Translate, fmt: ReturnType<typeof uiFormatters>): TripText {
  const routes = summary.alternatives.map((sections) => routeCodesText(sections)).filter(Boolean);
  const route = routes.join(', ');
  const count =
    summary.kind === 'compare' || summary.kind === 'compareTrips'
      ? t('saved.alternatives', fmt.number(summary.alternatives.length))
      : summary.flights === 1
        ? t('saved.oneFlight')
        : t('summary.flights', fmt.number(summary.flights));
  const dates = summary.start ? fmt.dateRange(summary.start, summary.end ?? summary.start) : '';
  return summary.label
    ? { title: summary.label, codes: false, when: dates || count, detail: [route, dates || count].join(' · ') }
    : { title: route, codes: true, when: dates || count, detail: [dates, count].filter(Boolean).join(' · ') };
}

function KindIcon({ kind, size }: { kind: SavedTripSummary['kind']; size: number }) {
  if (kind === 'trip') return <IconReturn size={size} />;
  if (kind === 'compare' || kind === 'compareTrips') return <IconCompare size={size} />;
  return <IconPlane size={size} />;
}

/** The way to the saved trips, beside About; it appears once something is saved and pulses when a trip is added. */
export function SavedTripsButton({ pulse, onOpen }: { pulse: number; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="float-btn saved-btn"
      aria-label={t('saved.title')}
      title={t('saved.title')}
      onClick={onOpen}
    >
      <IconBookmark size={19} />
      {pulse > 0 && <span key={pulse} className="saved-btn__pulse" aria-hidden="true" />}
    </button>
  );
}

export interface SavedTripsDialogHandle {
  open: () => void;
}

interface SavedTripsDialogProps {
  trips: readonly SavedTripView[];
  /** The saved trip on the globe, if any. */
  currentId: string | null;
  onOpenTrip: (trip: SavedTripView) => void;
  onRemove: (id: string) => RemovedTrip | null;
  onRestore: (removed: RemovedTrip) => void;
  /** Opens a GlobeHops link query (from `extractLinkQuery`). */
  onOpenLink: (query: string) => void;
}

/**
 * “Saved trips”: the trips kept on this device, newest first, each opened with one tap and removed with a
 * moment to undo; below them, a field that opens a pasted GlobeHops link here (the way into the installed app).
 */
export const SavedTripsDialog = forwardRef<SavedTripsDialogHandle, SavedTripsDialogProps>(function SavedTripsDialog(
  { trips, currentId, onOpenTrip, onRemove, onRestore, onOpenLink },
  ref,
) {
  const { t, fmt } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState(false);
  const [undo, setUndo] = useState<{ removed: RemovedTrip; title: string } | null>(null);
  const titleId = useId();
  const linkId = useId();

  useImperativeHandle(ref, () => ({
    open: () => {
      setLink('');
      setLinkError(false);
      setUndo(null);
      if (!dialogRef.current?.open) dialogRef.current?.showModal();
    },
  }));
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const close = () => dialogRef.current?.close();
  const openLink = (text: string) => {
    const query = extractLinkQuery(text);
    if (!query) return false;
    close();
    onOpenLink(query);
    return true;
  };

  const rows = trips.map((trip) => {
    const text = savedTripText(trip.summary, t, fmt);
    const current = trip.id === currentId;
    return (
      <li key={trip.id} className={`saved-item${current ? ' is-current' : ''}`}>
        <button
          type="button"
          className="saved-item__open"
          aria-current={current || undefined}
          onClick={() => {
            close();
            if (!current) onOpenTrip(trip);
          }}
        >
          <span className="saved-item__icon">
            <KindIcon kind={trip.summary.kind} size={16} />
          </span>
          <span className="saved-item__text">
            <span className={`saved-item__title${text.codes ? ' is-codes' : ''}`}>{text.title}</span>
            <span className="saved-item__detail">{text.detail}</span>
          </span>
          {current && <span className="saved-item__tag">{t('saved.showing')}</span>}
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--quiet saved-item__remove"
          aria-label={t('saved.remove', text.title)}
          title={t('saved.remove', text.title)}
          onClick={() => {
            const removed = onRemove(trip.id);
            if (removed) setUndo({ removed, title: text.title });
          }}
        >
          <IconTrash size={16} />
        </button>
      </li>
    );
  });
  if (undo) {
    rows.splice(
      Math.min(undo.removed.index, rows.length),
      0,
      <li key={`removed-${undo.removed.trip.id}`} className="saved-item is-removed">
        <span className="saved-item__removed">{t('saved.removed', undo.title)}</span>
        <button
          type="button"
          className="text-btn saved-item__undo"
          onClick={() => {
            onRestore(undo.removed);
            setUndo(null);
          }}
        >
          {t('saved.undo')}
        </button>
      </li>,
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="about saved-trips"
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      onClose={() => setUndo(null)}
    >
      <div className="about__inner saved-trips__inner">
        <button type="button" className="icon-btn about__close" aria-label={t('common.close')} onClick={close}>
          <IconClose />
        </button>
        <div className="saved-trips__head">
          <span className="saved-trips__mark" aria-hidden="true">
            <IconBookmark size={18} filled />
          </span>
          <h2 id={titleId}>{t('saved.title')}</h2>
        </div>

        {rows.length ? (
          <>
            <p className="saved-trips__lede">{t('saved.lede')}</p>
            <ul className="saved-list" role="list" aria-labelledby={titleId}>
              {rows}
            </ul>
          </>
        ) : (
          <p className="saved-trips__empty">{t('saved.empty')}</p>
        )}

        <form
          className="saved-link"
          onSubmit={(event) => {
            event.preventDefault();
            if (link.trim() && !openLink(link)) setLinkError(true);
          }}
        >
          <label className="saved-link__label" htmlFor={linkId}>
            <IconLink size={16} />
            {t('saved.linkLabel')}
          </label>
          <div className="saved-link__row">
            <input
              id={linkId}
              className="saved-link__input"
              type="url"
              inputMode="url"
              enterKeyHint="go"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={t('saved.linkPlaceholder')}
              aria-invalid={linkError || undefined}
              aria-describedby={linkError ? `${linkId}-error` : undefined}
              value={link}
              onChange={(event) => {
                setLink(event.target.value);
                setLinkError(false);
              }}
              onPaste={(event) => {
                // A pasted link opens at once; anything else stays in the field to be corrected.
                const text = event.clipboardData.getData('text/plain');
                if (text && openLink(text)) event.preventDefault();
              }}
            />
            <button type="submit" className="saved-link__open" disabled={!link.trim()}>
              {t('saved.linkOpen')}
            </button>
          </div>
          {linkError && (
            <p className="route-import__error" id={`${linkId}-error`} role="alert">
              <IconAlert size={15} />
              <span>{t('saved.linkInvalid')}</span>
            </p>
          )}
        </form>
      </div>
    </dialog>
  );
});

/** The empty planner's shortcut to saved trips: the newest few, then “All saved trips”. */
export function SavedTripsInline({
  trips,
  onOpenTrip,
  onShowAll,
}: {
  trips: readonly SavedTripView[];
  onOpenTrip: (trip: SavedTripView) => void;
  onShowAll: () => void;
}) {
  const { t, fmt } = useI18n();
  const titleId = useId();
  if (!trips.length) return null;
  return (
    <div className="suggestions saved-inline">
      <p className="suggestions__title" id={titleId}>
        {t('saved.title')}
      </p>
      <ul role="list" aria-labelledby={titleId}>
        {trips.slice(0, INLINE_LIMIT).map((trip) => {
          const text = savedTripText(trip.summary, t, fmt);
          return (
            <li key={trip.id}>
              <button
                type="button"
                className={`suggestion${text.codes ? ' suggestion--codes' : ''}`}
                title={text.detail}
                onClick={() => onOpenTrip(trip)}
              >
                <IconBookmark size={14} />
                <span className="suggestion__route">{text.title}</span>
                <span className="suggestion__duration">{text.when}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {trips.length > INLINE_LIMIT && (
        <button type="button" className="text-btn saved-inline__all" onClick={onShowAll}>
          {t('saved.all', fmt.number(trips.length))}
        </button>
      )}
    </div>
  );
}
