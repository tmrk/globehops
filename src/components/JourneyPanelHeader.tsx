import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { IconCheck, IconPencil, IconReset, IconShare } from './Icons.tsx';

interface JourneyPanelHeaderProps {
  comparing: boolean;
  isExample: boolean;
  hasAirports: boolean;
  canArrange: boolean;
  arranging: boolean;
  /** Something user-made exists: stops, times, compared journeys or an open timeline. */
  canReset: boolean;
  onToggleArranging: () => void;
  onShare: () => void;
  onReset: () => void;
}

/** Title plus Edit, Share and Reset; Reset asks for confirmation in place of the other actions. */
export function JourneyPanelHeader({
  comparing,
  isExample,
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
  const confirming = confirmingReset && canReset;
  const resetRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The safe choice takes focus, so a second Enter or Space cannot reset by accident.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirmingReset(false);
    requestAnimationFrame(() => resetRef.current?.focus());
  };
  const confirm = () => {
    setConfirmingReset(false);
    onReset();
  };

  const title = () => {
    if (comparing) return t('compare.title');
    if (isExample) return t('panel.exampleJourney');
    return t(hasAirports ? 'panel.yourJourney' : 'panel.planAJourney');
  };
  return (
    <div className="panel__head">
      <h2 className="panel__title">{title()}</h2>
      {confirming ? (
        <div
          className="panel__actions"
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
        <div className="panel__actions">
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
