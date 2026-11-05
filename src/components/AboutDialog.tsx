import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { DatasetMeta } from '../data/airports.ts';
import { ALTITUDE_EXAGGERATION, DEFAULT_ALTITUDE_MODEL } from '../lib/altitude.ts';
import { DEFAULT_FLIGHT_TIME_MODEL } from '../lib/flightTime.ts';
import { DEFAULT_LAYOVER_MIN, formatLayover } from '../lib/layover.ts';
import { LogoMark } from './Brand.tsx';
import { IconClose } from './Icons.tsx';

export interface AboutDialogHandle {
  open: () => void;
}

const REPO_URL = 'https://github.com/tmrk/globehops';

export const AboutDialog = forwardRef<AboutDialogHandle, { meta: DatasetMeta | null }>(function AboutDialog(
  { meta },
  ref,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => ({ open: () => dialogRef.current?.showModal() }));
  const updated = meta?.generatedAt
    ? new Date(meta.generatedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })
    : null;
  const m = DEFAULT_FLIGHT_TIME_MODEL;
  const a = DEFAULT_ALTITUDE_MODEL;

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
          aria-label="Close"
          onClick={() => dialogRef.current?.close()}
        >
          <IconClose />
        </button>
        <div className="about__brand">
          <LogoMark size={36} />
          <h2 id="about-title">GlobeHops</h2>
        </div>
        <p className="about__lede">
          See any journey by air as it really curves around the Earth. Enter airports, then rotate and zoom the globe to
          explore the great-circle routes between them.
        </p>
        <h3>How it works</h3>
        <ul>
          <li>
            Routes are the <strong>shortest great-circle paths</strong> on a spherical Earth (mean radius 6,371.0088
            km). Real flights often deviate because of winds, air-traffic control, weather and restricted airspace.
          </li>
          <li>
            Each arc follows a <strong>simplified flight profile</strong>: a climb of about {a.climbMinutes} min to a
            typical cruising altitude of {a.cruiseAltitudeKm} km, level cruise, and a descent over the last{' '}
            {a.descentMinutes} min. Short flights peak lower. Height is exaggerated {ALTITUDE_EXAGGERATION}× so it shows
            at globe scale; the dashed line beneath is the ground track.
          </li>
          <li>
            Flight times are <strong>estimates</strong>: distance at an average {m.cruiseSpeedKmh} km/h plus{' '}
            {m.overheadMinutes} min for take-off, climb, approach and landing. Total time adds a layover at each
            connection ({formatLayover(DEFAULT_LAYOVER_MIN)} unless you change it).
          </li>
        </ul>
        <h3>Sources &amp; credits</h3>
        <ul>
          <li>
            Earth imagery: <strong>Blue Marble Next Generation</strong> (July 2004 composite, with topography and
            bathymetry) by NASA Earth Observatory / Reto Stöckli, NASA Goddard Space Flight Center. A cloud-free
            composite of satellite imagery — not a live view. GlobeHops is not affiliated with or endorsed by NASA.
          </li>
          <li>
            Airport data:{' '}
            <a href="https://ourairports.com/data/" target="_blank" rel="noreferrer">
              OurAirports
            </a>{' '}
            (public domain)
            {updated ? `, updated ${updated}` : ''}.
          </li>
          <li>
            Country borders:{' '}
            <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">
              Natural Earth
            </a>{' '}
            1:50m boundary lines (public domain). They show de facto boundaries and imply no position on territorial
            disputes.
          </li>
          <li>
            Built with React, Three.js and the Geist typefaces. Open source under the MIT licence —{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              source code on GitHub
            </a>
            .
          </li>
        </ul>
        <p className="about__privacy">
          No accounts, no tracking. Your route lives only in the page address and this browser.
        </p>
      </div>
    </dialog>
  );
});
