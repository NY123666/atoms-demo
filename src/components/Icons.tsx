import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function svg(path: ReactNode, props: IconProps, viewBox = '0 0 24 24') {
  const { size = 16, className } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export const IconPlus = (p: IconProps) => svg(<path d="M12 5v14M5 12h14" />, p)
export const IconSpark = (p: IconProps) =>
  svg(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />, p)
export const IconSettings = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 8.9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>,
    p,
  )
export const IconStar = (p: IconProps) => svg(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />, p)
export const IconTrash = (p: IconProps) =>
  svg(<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />, p)
export const IconCopy = (p: IconProps) =>
  svg(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h8" />
    </>,
    p,
  )
export const IconDownload = (p: IconProps) => svg(<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16" />, p)
export const IconShare = (p: IconProps) =>
  svg(
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.3M8.2 13.2l7.6 4.3" />
    </>,
    p,
  )
export const IconBack = (p: IconProps) => svg(<path d="M15 5l-7 7 7 7" />, p)
export const IconChevron = (p: IconProps) => svg(<path d="M6 9l6 6 6-6" />, p)
export const IconRefresh = (p: IconProps) =>
  svg(<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />, p)
export const IconCode = (p: IconProps) => svg(<path d="M9 18l-6-6 6-6M15 6l6 6-6 6" />, p)
export const IconPlay = (p: IconProps) => svg(<path d="M6 4l14 8-14 8V4z" />, p)
export const IconStop = (p: IconProps) => svg(<rect x="6" y="6" width="12" height="12" rx="2" />, p)
export const IconCheck = (p: IconProps) => svg(<path d="M4 12.5l5 5L20 6.5" />, p)
export const IconClose = (p: IconProps) => svg(<path d="M6 6l12 12M18 6L6 18" />, p)
export const IconSearch = (p: IconProps) =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>,
    p,
  )
export const IconHistory = (p: IconProps) =>
  svg(<path d="M3 12a9 9 0 109-9 9 9 0 00-7.5 4M3 4v5h5M12 8v4l3 2" />, p)
export const IconBolt = (p: IconProps) => svg(<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />, p)
export const IconLayers = (p: IconProps) =>
  svg(<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />, p)
export const IconExternal = (p: IconProps) =>
  svg(<path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />, p)
export const IconLogo = (p: IconProps) =>
  svg(<path d="M8 19V5h8M8 12h6" />, { ...p, size: p.size ?? 18 })
