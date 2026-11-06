import type { AnalyticsConsent } from '../analytics.ts';

interface ConsentNoticeProps {
  onChoose: (consent: AnalyticsConsent) => void;
  onDetails: () => void;
}

/** A small, non-blocking question about Google Analytics, asked once per browser. */
export function ConsentNotice({ onChoose, onDetails }: ConsentNoticeProps) {
  return (
    <section className="consent" aria-labelledby="consent-title" aria-describedby="consent-text">
      <div className="consent__body">
        <h2 id="consent-title" className="consent__title">
          Usage statistics
        </h2>
        <p id="consent-text" className="consent__text">
          Allow Google Analytics cookies to help improve GlobeHops? Your routes and times are never sent.
        </p>
      </div>
      <div className="consent__actions">
        <button type="button" className="consent__more" onClick={onDetails}>
          Details
        </button>
        <button type="button" className="consent__btn" onClick={() => onChoose('denied')}>
          No thanks
        </button>
        <button type="button" className="consent__btn consent__btn--allow" onClick={() => onChoose('granted')}>
          Allow
        </button>
      </div>
    </section>
  );
}
