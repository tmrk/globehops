import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { IconCheck, IconPencil, IconReset, IconShare } from './Icons.tsx';

interface JourneyPanelHeaderProps {
  /** A single journey's own name, which replaces the title. */
  name?: string | null;
  comparing: boolean;
  /** The journeys are a trip's (outbound, return, …). */
  trip?: boolean;
  /** Alternative trips are compared. */
  comparingTrips?: boolean;
  hasAirports: boolean;
  canArrange: boolean;
  arranging: boolean;
  /** Something user-made exists: stops, times, compared journeys or an open timeline. */
  canReset: boolean;
  onToggleArranging: () => void;
  onShare: () => void;
  onReset: () => void;
}

/**
 * Title plus Edit, Share and Reset; Reset asks for confirmation in place of the other actions. The
 * confirmation slides in from where Reset was, and the usual actions settle back when it is cancelled.
 */
export function JourneyPanelHeader({
  name = null,
  comparing,
  trip = false,
  comparingTrips = false,
  hasAirports,
  canArrange,
  arranging,
  canReset,
  onToggleArranging,
  onShare,
  onReset,
}: JourneyPanelHeaderProps) {
  const { t } = useI18n();
  const [confirmingReset, setConfirmingReset] = useState(false);
  /** Set once the confirmation has been dismissed, so only that return animates, not every first render. */
  const [returned, setReturned] = useState(false);
  const confirming = confirmingReset && canReset;
  const resetRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The safe choice takes focus, so a second Enter or Space cannot reset by accident.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirmingReset(false);
    setReturned(true);
    requestAnimationFrame(() => resetRef.current?.focus());
  };
  const confirm = () => {
    setConfirmingReset(false);
    setReturned(true);
    onReset();
  };

  const title = () => {
    if (name) return name;
    if (comparingTrips) return t('trips.title');
    if (comparing) return t('compare.title');
    if (trip) return t('trip.title');
    return t(hasAirports ? 'panel.yourJourney' : 'panel.showAFlight');
  };
  return (
    <div className="panel__head">
      <h2 className="panel__title">{title()}</h2>
      {confirming ? (
        <div
          className="panel__actions panel__actions--confirm"
          role="group"
          aria-label={t('panel.resetQuestion')}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            cancel();
          }}
        >
          <button ref={cancelRef} type="button" className="head-btn" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="head-btn head-btn--danger" onClick={confirm}>
            <IconReset size={17} />
            <span>{t('panel.resetConfirm')}</span>
          </button>
        </div>
      ) : (
        <div className={`panel__actions${returned ? ' is-returning' : ''}`}>
          {canArrange && (
            <button
              type="button"
              className={`head-btn${arranging ? ' is-on' : ''}`}
              aria-pressed={arranging}
              onClick={onToggleArranging}
            >
              {arranging ? <IconCheck size={17} /> : <IconPencil size={16} />}
              <span>{arranging ? t('panel.done') : t('panel.edit')}</span>
            </button>
          )}
          {hasAirports && (
            <button type="button" className="head-btn" onClick={onShare}>
              <IconShare size={17} />
              <span>{t('panel.share')}</span>
            </button>
          )}
          {canReset && (
            <button
              ref={resetRef}
              type="button"
              className="head-btn head-btn--icon"
              aria-label={t('panel.reset')}
              title={t('panel.reset')}
              onClick={() => setConfirmingReset(true)}
            >
              <IconReset size={17} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
