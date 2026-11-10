import { useId } from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import type { PreviewLane } from '../lib/playPreview.ts';
import { IconAlert, IconChevronUp, IconPlane, IconPlay } from './Icons.tsx';

interface PlayLauncherProps {
  /** What plays: “Play journey”, “Play trip”, “Play all 3 journeys”: the button's accessible name. */
  label: string;
  /** The route on the departure board, e.g. LHR → SIN → SYD. */
  route: string;
  /** Its length, dates or how many journeys. */
  detail: string;
  lanes: PreviewLane[];
  /** A schedule that cannot play: the button opens the times to fix instead. */
  problem?: { title: string; detail: string; onFix: () => void } | null;
  /** Phones and landscape phones: the top of the journey sheet or panel, not a card over the globe. */
  docked?: boolean;
  /** A one-time, motion-safe nudge for visitors who have never pressed Play. */
  cue?: boolean;
  /** Desktop: the button's tooltip mentions that Space plays too. */
  shortcut?: boolean;
  onPlay: () => void;
  /** The collapsed sheet's way to its details, beside the route. */
  onExpand?: () => void;
}

/**
 * The journey's player before it starts. Play is an amber wayfinding sign – a play mark and the word, like
 * the black-on-yellow signs that point the way through an airport – beside the route it will show, over a
 * miniature of the timeline it opens with the aircraft waiting at its start. The card sits exactly where
 * the timeline appears (beneath the globe, or atop the phone sheet), so pressing Play reads as one motion.
 */
export function PlayLauncher({
  label,
  route,
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
  const act = problem ? problem.onFix : onPlay;
  return (
    <section
      className={`launcher${docked ? ' launcher--docked' : ''}${problem ? ' has-problem' : ''}`}
      aria-label={t('launcher.region')}
      // The whole card plays for a pointer; the sign is the one control for keyboards and screen readers.
      onClick={(event) => {
        if (!(event.target as Element).closest('button')) act();
      }}
    >
      <div className="launcher__row">
        <button
          type="button"
          className={`launcher__play${cue && !problem ? ' is-cued' : ''}`}
          aria-label={problem ? problem.title : label}
          aria-describedby={detailId}
          title={!problem && shortcut ? t('launcher.shortcut', label) : undefined}
          onClick={act}
        >
          <span className="launcher__glyph" aria-hidden="true">
            {problem ? <IconAlert size={16} /> : <IconPlay size={16} />}
          </span>
          <span className="launcher__word" aria-hidden="true">
            {problem ? t('launcher.fix') : t('launcher.play')}
          </span>
        </button>
        <span className="launcher__info">
          <span className="launcher__route">{problem ? problem.title : route}</span>
          <span className="launcher__detail" id={detailId}>
            {problem ? problem.detail : detail}
          </span>
        </span>
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
      </div>
      {lanes.length > 0 && (
        <div className="launcher__strip" aria-hidden="true">
          <IconPlane size={13} className="launcher__plane" />
          <span className="launcher__lanes">
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
        </div>
      )}
    </section>
  );
}
