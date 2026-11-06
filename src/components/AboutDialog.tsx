import { useI18n } from '../i18n/I18nProvider.tsx';
import { LanguageSelector } from '../i18n/LanguageSelector.tsx';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { DatasetMeta } from '../data/airports.ts';
import type { AnalyticsConsentState } from '../hooks/useAnalyticsConsent.ts';
import { ALTITUDE_EXAGGERATION, DEFAULT_ALTITUDE_MODEL } from '../lib/altitude.ts';
import { DEFAULT_FLIGHT_TIME_MODEL } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN } from '../lib/layover.ts';
import { LogoMark } from './Brand.tsx';
import { IconClose } from './Icons.tsx';
import { APP_COMMIT, APP_DATE, APP_VERSION, CHANGELOG_URL } from '../version.ts';

export interface AboutDialogHandle {
  /** Opens the dialog, optionally scrolled to the privacy section. */
  open: (section?: 'privacy') => void;
}

const REPO_URL = 'https://github.com/tmrk/globehops';

interface AboutDialogProps {
  meta: DatasetMeta | null;
  analytics: AnalyticsConsentState;
}

export const AboutDialog = forwardRef<AboutDialogHandle, AboutDialogProps>(function AboutDialog(
  { meta, analytics },
  ref,
) {
  const { t, fmt } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const privacyRef = useRef<HTMLHeadingElement>(null);
  useImperativeHandle(ref, () => ({
    open: (section) => {
      dialogRef.current?.showModal();
      if (section === 'privacy') privacyRef.current?.scrollIntoView({ block: 'start' });
    },
  }));
  const updated = meta?.generatedAt ? fmt.shortDate(meta.generatedAt.slice(0, 10)) : null;
  const m = DEFAULT_FLIGHT_TIME_MODEL;
  const a = DEFAULT_ALTITUDE_MODEL;
  const build = fmt.build(APP_COMMIT, APP_DATE);

  return (
    <dialog
      ref={dialogRef}
      className="about"
      aria-labelledby="about-title"
      onClick={(e) => {
        // Click on the backdrop closes the dialog.
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="about__inner">
        <button
          type="button"
          className="icon-btn about__close"
          aria-label={t('common.close')}
          onClick={() => dialogRef.current?.close()}
        >
          <IconClose />
        </button>
        <div className="about__brand">
          <LogoMark size={36} />
          <h2 id="about-title">GlobeHops</h2>
        </div>
        <p className="about__lede">{t('about.intro')}</p>
        <LanguageSelector />
        <h3>{t('about.method')}</h3>
        <ul>
          <li>{t('about.routes', fmt.number(6371.0088))}</li>
          <li>
            {t(
              'about.profile',
              fmt.number(a.climbMinutes),
              fmt.number(a.cruiseAltitudeKm),
              fmt.number(a.descentMinutes),
              fmt.number(ALTITUDE_EXAGGERATION),
            )}
          </li>
          <li>
            {t(
              'about.estimates',
              fmt.number(m.cruiseSpeedKmh),
              fmt.number(m.overheadMinutes),
              fmt.layover(DEFAULT_LAYOVER_MIN),
            )}
          </li>
        </ul>
        <p>{t('about.playback')}</p>
        <h3>{t('about.credits')}</h3>
        <ul>
          <li>{t('about.imagery')}</li>
          <li>
            {t('about.airports')}{' '}
            <a href="https://ourairports.com/data/" target="_blank" rel="noreferrer">
              OurAirports
            </a>{' '}
            {t('about.publicDomain')}
            {updated ? t('about.updated', updated) : ''}.
          </li>
          <li>
            {t('about.borders')}{' '}
            <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">
              Natural Earth
            </a>{' '}
            {t('about.boundaries')}
          </li>
          <li>
            {t('about.zones')}{' '}
            <a href="https://github.com/evansiroky/timezone-boundary-builder" target="_blank" rel="noreferrer">
              timezone-boundary-builder 2026f
            </a>{' '}
            {t('about.zoneLicense')}{' '}
            <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">
              Open Database License (ODbL)
            </a>
            ; {t('about.copyright')}{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              {t('about.osm')}
            </a>
            .
          </li>
          <li>
            {t('about.built')}{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              {t('about.source')}
            </a>
            .
          </li>
        </ul>
        <h3 ref={privacyRef} id="about-privacy">
          {t('about.privacy')}
        </h3>
        <p className="about__privacy">{t('about.privacyText')}</p>
        {analytics.available ? (
          <button
            type="button"
            className="about__toggle"
            aria-pressed={analytics.consent === 'granted'}
            onClick={() => analytics.choose(analytics.consent === 'granted' ? 'denied' : 'granted')}
          >
            <span>{t('about.statistics')}</span>
            <span className="switch" aria-hidden="true" />
          </button>
        ) : null}
        <p className="about__version">
          {t('about.version', APP_VERSION)}
          {build ? ` · ${build}` : ''} ·{' '}
          <a href={CHANGELOG_URL} target="_blank" rel="noreferrer">
            {t('about.whatsNew')}
          </a>
        </p>
      </div>
    </dialog>
  );
});
