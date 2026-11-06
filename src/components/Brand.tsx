import { useId } from 'react';
import { APP_COMMIT, APP_DATE, APP_VERSION, describeBuild } from '../version.ts';

/**
 * The GlobeHops mark: a globe with one great-circle hop between two airports, drawn with the same
 * origin (ring) and destination (filled) markers as the globe itself. Same art as public/logo.svg.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  const gradient = `${useId()}-globe`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="logo-mark">
      <defs>
        <radialGradient id={gradient} cx="36%" cy="28%" r="82%">
          <stop offset="0" stopColor="#4a92da" />
          <stop offset="0.55" stopColor="#1b5592" />
          <stop offset="1" stopColor="#0a2547" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="25" fill={`url(#${gradient})`} />
      <g fill="none" stroke="#cfe5ff" strokeOpacity=".28" strokeWidth="1.5">
        <ellipse cx="32" cy="32" rx="10.5" ry="25" />
        <path d="M8.2 25.5c15.6 5 32 5 47.6 0M10.7 44.5c13.8 3.9 28.8 3.9 42.6 0" />
      </g>
      <circle cx="32" cy="32" r="25" fill="none" stroke="#9ccaff" strokeOpacity=".85" strokeWidth="1.8" />
      <path
        d="M18.5 43.5C21.5 25 34 15.5 47.5 19.5"
        fill="none"
        stroke="#04060c"
        strokeOpacity=".45"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M18.5 43.5C21.5 25 34 15.5 47.5 19.5"
        fill="none"
        stroke="#ffc24b"
        strokeWidth="4.2"
        strokeLinecap="round"
      />
      <circle cx="18.5" cy="43.5" r="4.6" fill="#0a0f1a" stroke="#ffc24b" strokeWidth="2.8" />
      <circle cx="47.5" cy="19.5" r="5" fill="#ffc24b" stroke="#fff" strokeWidth="2.4" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <LogoMark />
      <span className="brand__name">GlobeHops</span>
    </div>
  );
}

/** The running release, faint in the bottom-left corner; hover shows the build. */
export function VersionTag() {
  const build = describeBuild(APP_COMMIT, APP_DATE);
  return (
    <p className="app-version" title={build || undefined}>
      <span className="sr-only">GlobeHops version </span>v{APP_VERSION}
    </p>
  );
}
