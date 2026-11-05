import { useId } from 'react';

/** The GlobeHops mark: a globe with a great-circle "hop" between two airports (same art as public/logo.svg). */
export function LogoMark({ size = 30 }: { size?: number }) {
  const id = useId();
  const gradient = `${id}-globe`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="logo-mark">
      <defs>
        <radialGradient id={gradient} cx="38%" cy="32%" r="78%">
          <stop offset="0" stopColor="#3a7fc4" />
          <stop offset="0.55" stopColor="#16406f" />
          <stop offset="1" stopColor="#0a1c35" />
        </radialGradient>
      </defs>
      <circle cx="31" cy="34" r="22" fill={`url(#${gradient})`} />
      <path
        d="M31 12.6c-5.2 5.6-8 13-8 21.4s2.8 15.8 8 21.4M9.4 31.5c6.6 2.1 14 3.2 21.6 3.2s15-1.1 21.6-3.2"
        fill="none"
        stroke="#a9cfff"
        strokeOpacity=".28"
        strokeWidth="1.6"
      />
      <circle cx="31" cy="34" r="22" fill="none" stroke="#a9cfff" strokeOpacity=".45" strokeWidth="1.6" />
      <path
        d="M12.5 46.5C17.5 27.5 33 15 53 15.5"
        fill="none"
        stroke="#ffc24b"
        strokeWidth="4.6"
        strokeLinecap="round"
      />
      <circle cx="12.5" cy="46.5" r="5.4" fill="#ffc24b" />
      <circle cx="53" cy="15.5" r="5" fill="#fff" stroke="#ffc24b" strokeWidth="2.8" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <LogoMark />
      <span className="brand__name">
        Globe<span>Hops</span>
      </span>
    </div>
  );
}
