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
export const IconChevronLeft = IconBack;
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
export const IconLink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 11.5a3 3 0 004.2 0l2.6-2.6a3 3 0 00-4.2-4.2l-.9.9" />
    <path d="M11.5 8.5a3 3 0 00-4.2 0L4.7 11.1a3 3 0 004.2 4.2l.9-.9" />
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
