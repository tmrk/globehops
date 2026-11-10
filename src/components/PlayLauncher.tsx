import { useId } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { PreviewLane } from '../lib/playPreview.ts';
import { IconAlert, IconChevronUp, IconPlay } from './Icons.tsx';

interface PlayLauncherProps {
  /** What plays: “Play journey”, “Play trip”, “Play all 3 journeys”. Also the button's accessible name. */
  label: string;
  /** The route and its length, or what is being compared. */
  detail: string;
  lanes: PreviewLane[];
  /** A schedule that cannot play: the button opens the times to fix instead. */
  problem?: { title: string; detail: string; onFix: () => void } | null;
  /** Phones: the top of the journey sheet rather than a card floating over the globe. */
  docked?: boolean;
  /** A one-time, motion-safe nudge for visitors who have never pressed Play. */
  cue?: boolean;
  /** Desktop: show that Space plays too. */
  shortcut?: boolean;
  onPlay: () => void;
  /** The collapsed sheet's way to its details, beside the play button. */
  onExpand?: () => void;
}

/**
 * The journey's player before it starts: one large play control whose preview strip is a miniature of
 * the timeline it opens. It sits exactly where the timeline appears (beneath the globe, or atop the
 * phone sheet), and its play disc stays put as the timeline replaces it, so playing reads as one motion.
 */
export function PlayLauncher({
  label,
  detail,
  lanes,
  problem,
  docked = false,
  cue = false,
  shortcut = false,
  onPlay,
  onExpand,
}: PlayLauncherProps) {
  const { t } = useI18n();
  const detailId = useId();
  return (
    <section
      className={`launcher${docked ? ' launcher--docked' : ''}${problem ? ' has-problem' : ''}`}
      aria-label={t('launcher.region')}
    >
      <button
        type="button"
        className={`launcher__main${cue && !problem ? ' is-cued' : ''}`}
        aria-label={problem ? problem.title : label}
        aria-describedby={detailId}
        title={!problem && shortcut ? t('launcher.shortcut', label) : undefined}
        onClick={problem ? problem.onFix : onPlay}
      >
        <span className="launcher__disc" aria-hidden="true">
          {problem ? <IconAlert size={22} /> : <IconPlay size={26} />}
        </span>
        <span className="launcher__text">
          <span className="launcher__title">
            <span className="launcher__label">{problem ? problem.title : label}</span>
            {shortcut && !problem && (
              <kbd className="launcher__key" aria-hidden="true">
                {t('launcher.space')}
              </kbd>
            )}
          </span>
          <span className="launcher__detail" id={detailId}>
            {problem ? problem.detail : detail}
          </span>
          {lanes.length > 0 && (
            <span className="launcher__strip" aria-hidden="true">
              {lanes.map((lane, i) => (
                <span key={i} className="launcher__lane">
                  {lane.segments.map((segment, k) => (
                    <span
                      key={k}
                      className={`launcher__segment launcher__segment--${segment.kind}`}
                      style={{
                        left: `${segment.start * 100}%`,
                        width: `${(segment.end - segment.start) * 100}%`,
                        backgroundColor: segment.color,
                      }}
                    />
                  ))}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {onExpand && (
        <button
          type="button"
          className="launcher__more icon-btn icon-btn--quiet"
          aria-label={t('panel.showJourneyDetails')}
          onClick={onExpand}
        >
          <IconChevronUp size={20} />
        </button>
      )}
    </section>
  );
}
