// TM Agent brand mark (天幕): a luminous canopy arc over an agent core, with
// the two canopy posts at its feet. Replaces the upstream whale artwork; the
// original 23.16x17.04 viewBox is kept so every existing brand-slot layout and
// its geometry assertions stay unchanged. Ink rides currentColor.

import type { IconProps } from './icons/props.ts'

/**
 * Render the TM Agent brand mark.
 * @param props.size - width in px (default 24; height keeps the 23.16:17.04 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the brand mark svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 17.04) / 23.16}
      className={className}
      viewBox="0 0 23.16 17.04"
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(-4.66,-9.83) scale(0.0318)">
        <path
          d="M 176 664 Q 512 150 848 664"
          fill="none"
          stroke="currentColor"
          strokeWidth="56"
          strokeLinecap="round"
        />
        <circle cx="176" cy="664" r="26" fill="currentColor" />
        <circle cx="848" cy="664" r="26" fill="currentColor" />
        <circle cx="512" cy="742" r="58" fill="currentColor" />
      </g>
    </svg>
  )
}
