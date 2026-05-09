/**
 * Icônes monochromes 16/24 px utilisées dans l'UI Atelier.
 * Toutes en `currentColor` pour suivre la couleur du parent.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
}

export const IconChevron = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>
);

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" /></svg>
);

export const IconSquare = (p: IconProps) => (
  <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" /></svg>
);

export const IconPaperclip = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 11.5l-8.49 8.49a5 5 0 11-7.07-7.07l8.49-8.49a3.5 3.5 0 014.95 4.95l-8.49 8.49a2 2 0 11-2.83-2.83L15.5 7" />
  </svg>
);

export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 0115.3-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 01-15.3 6.4L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 12l5 5L20 7" /></svg>
);

export const IconSpeaker = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M11 5L6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
    <path d="M16 8a5 5 0 010 8" />
    <path d="M19 5a9 9 0 010 14" />
  </svg>
);

export const IconCamera = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 5l1.5 2H20a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2h4.5L10 5h4z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const IconLeaf = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M11 20A7 7 0 014 13V4h9a7 7 0 010 14h-2v2z" />
    <path d="M4 4l9 9" />
  </svg>
);

export const IconCalendar = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </svg>
);
