/** Small hand-drawn icon set (no icon library). 20×20 viewBox, stroke-based, currentColor. */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);
export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </Icon>
);
export const IconSwap = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 3.5v12.5M7 16l-3-3M13 16.5V4M13 4l3 3" />
  </Icon>
);
export const IconShare = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 12.5V3.2M6.6 6.2L10 2.8l3.4 3.4" />
    <path d="M6.5 9H5.2c-.9 0-1.7.8-1.7 1.7v4.6c0 .9.8 1.7 1.7 1.7h9.6c.9 0 1.7-.8 1.7-1.7v-4.6c0-.9-.8-1.7-1.7-1.7h-1.3" />
  </Icon>
);
export const IconGrip = (p: IconProps) => (
  <Icon {...p} stroke="none" fill="currentColor">
    <circle cx="7.5" cy="5.5" r="1.25" />
    <circle cx="12.5" cy="5.5" r="1.25" />
    <circle cx="7.5" cy="10" r="1.25" />
    <circle cx="12.5" cy="10" r="1.25" />
    <circle cx="7.5" cy="14.5" r="1.25" />
    <circle cx="12.5" cy="14.5" r="1.25" />
  </Icon>
);
export const IconFrame = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" />
    <circle cx="10" cy="10" r="2.2" />
  </Icon>
);
/** Globe outline crossed by a dashed boundary: the country-borders layer. */
export const IconBorders = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path
      d="M10.6 3.1l-.9 3.4 1.9 2.6-1.4 3.2 1.6 4.6M9.7 9.4l-6.5 1.4M11.6 9.1l5.2-2"
      strokeWidth={1.3}
      strokeDasharray="1.7 1.5"
    />
  </Icon>
);
export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 6.4V10l2.4 1.6" />
  </Icon>
);
export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 8l4.5 4.5L14.5 8" />
  </Icon>
);
export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8.8" cy="8.8" r="5.3" />
    <path d="M12.8 12.8l3.7 3.7" />
  </Icon>
);
export const IconBack = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.5 4.5L7 10l5.5 5.5" />
  </Icon>
);
export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 4.5L13 10l-5.5 5.5" />
  </Icon>
);
export const IconChevronUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12.5L10 7l5.5 5.5" />
  </Icon>
);
export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 9v4.6M10 6.4v.1" />
  </Icon>
);
/** Counter-clockwise arrow: start over. */
export const IconReset = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.8 7A6 6 0 1 1 4.1 11" />
    <path d="M4.6 3.4v3.8h3.8" />
  </Icon>
);
export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5h12M8 5.5V4h4v1.5M5.5 5.5l.7 10.2c.1.7.6 1.3 1.4 1.3h4.8c.8 0 1.3-.6 1.4-1.3l.7-10.2" />
  </Icon>
);
export const IconPlane = (p: IconProps) => (
  <Icon {...p} stroke="none" fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 1.8c.75 0 1.25.9 1.25 2.1v5.3l7.25 4.35v2.05l-7.25-2.25v4.4l2.25 1.7v1.6L12 20.1l-3.5.95v-1.6l2.25-1.7v-4.4L3.5 15.6v-2.05l7.25-4.35V3.9c0-1.2.5-2.1 1.25-2.1z" />
  </Icon>
);
export const IconPlay = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5l8 5.5-8 5.5z" fill="currentColor" stroke="none" />
  </Icon>
);
export const IconPause = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 5v10M13 5v10" strokeWidth={3} />
  </Icon>
);
export const IconSunMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.7 3.7a6.5 6.5 0 11-8.9 8.9 5.5 5.5 0 008.9-8.9z" />
    <path d="M5 2v2M2 5h2M4 4l1 1" />
  </Icon>
);

/** Atlas text layer: two letter sizes over a text baseline. */
export const IconLabels = (p: IconProps) => (
  <Icon viewBox="0 0 24 24" {...p}>
    <path d="M3 16L7.5 5 12 16M4.6 12h5.8M20 16v-5a3 3 0 1 0 0 4M20 12h-2a2 2 0 1 0 2 2M3 20h18" />
  </Icon>
);

/** Stacked map sheets: display options for the globe. */
export const IconLayers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.2l7 3.6-7 3.6-7-3.6z" />
    <path d="M3 10.2l7 3.6 7-3.6M3 13.6l7 3.6 7-3.6" />
  </Icon>
);
export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.6 4.4l3 3-8.4 8.4-3.7.7.7-3.7z" />
    <path d="M11 6l3 3" />
  </Icon>
);
export const IconRuler = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.2 13.2l10-10 3.6 3.6-10 10z" />
    <path d="M6.3 10.1l1.6 1.6M8.6 7.8l1.1 1.1M10.9 5.5l1.6 1.6" />
  </Icon>
);
export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10.5l3.6 3.6 7.4-8.2" />
  </Icon>
);

export const IconFollow = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="5.5" />
    <circle cx="10" cy="10" r="1.5" />
    <path d="M10 2v3M10 15v3M2 10h3M15 10h3" />
  </Icon>
);

export const IconLanguage = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 16l3.7-10 3.7 10M3.8 12.5h4.8M10 5h7.5M13.5 3v2M16 5c-.5 4-2.4 6.4-5.5 8M11 7.5c1.1 2.4 3 4.3 6.5 5.5" />
  </Icon>
);
export const IconWaves = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 6c3-3 5 3 8 0s5 3 8 0M2 10c3-3 5 3 8 0s5 3 8 0M2 14c3-3 5 3 8 0s5 3 8 0" />
  </Icon>
);
export const IconMotion = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 6h5M2 10h3M2 14h5M10 6l5 4-5 4M7 10h8" />
    <circle cx="17" cy="10" r="1" />
  </Icon>
);
export const IconLocate = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="5.5" />
    <circle cx="10" cy="10" r="1.5" fill="currentColor" />
    <path d="M10 2v2M10 16v2M2 10h2M16 10h2" />
  </Icon>
);

export const IconCompare = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7c4-5 10-5 14 0M3 15c4-5 10-5 14 0M14 4l3 3-3 2M14 12l3 3-3 2" />
  </Icon>
);
