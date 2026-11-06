import { useI18n } from '../i18n/I18nProvider.tsx';
import { IconCheck, IconPencil, IconShare } from './Icons.tsx';

interface JourneyPanelHeaderProps {
  comparing: boolean;
  isExample: boolean;
  hasAirports: boolean;
  canArrange: boolean;
  arranging: boolean;
  onToggleArranging: () => void;
  onShare: () => void;
}

export function JourneyPanelHeader({
  comparing,
  isExample,
  hasAirports,
  canArrange,
  arranging,
  onToggleArranging,
  onShare,
}: JourneyPanelHeaderProps) {
  const { t } = useI18n();
  const title = () => {
    if (comparing) return t('compare.title');
    if (isExample)
      return (
        <>
          {t('panel.exampleJourney')}
          <span className="panel__hint">{t('panel.chooseAnyAirportToChangeIt')}</span>
        </>
      );
    return t(hasAirports ? 'panel.yourJourney' : 'panel.planAJourney');
  };
  return (
    <div className="panel__head">
      <h2 className="panel__title">{title()}</h2>
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
      </div>
    </div>
  );
}
