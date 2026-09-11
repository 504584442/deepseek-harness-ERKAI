// TM Agent wordmark: the 天幕 mark plus "TM AGENT" letterforms. The upstream
// 182x24 (with mark) and 156x24 (name only) viewBoxes are kept intact so every
// brand slot keeps its sizing and its geometry assertions.

import type { IconProps } from './icons/props.ts'

/** Display options for the TM Agent wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading brand mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the brand wordmark.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading brand mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <svg
      width={(size * (includeMark ? 182 : 156)) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 182 24' : '26 0 156 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark ? (
        <g transform="translate(-4.62,-5.95) scale(0.0312)">
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
      ) : null}
      <text
        x={includeMark ? 33 : 26}
        y="17.75"
        fill="currentColor"
        fontFamily="'Segoe UI', 'Microsoft YaHei', Arial, sans-serif"
        fontSize="16"
        fontWeight="700"
        letterSpacing="5"
      >
        TM AGENT
      </text>
    </svg>
  )
}
