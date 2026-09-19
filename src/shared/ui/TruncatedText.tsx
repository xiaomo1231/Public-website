import type { ElementType } from 'react'
import { cn } from '@/shared/lib/utils'
import { TooltipProvider, TooltipWrapper } from './Tooltip'

export interface TruncatedTextProps {
  /**
   * The full text. It is always rendered in the DOM — only the *visual* length
   * is clipped, by CSS, against the real container width.
   */
  text: string
  className?: string
  /**
   * Reveal the full text on hover/focus. Defaults to `true`; the full text is
   * also exposed to assistive tech via `aria-label` either way.
   */
  tooltip?: boolean
  /** Element to render. Defaults to `span`. */
  as?: ElementType
}

/**
 * Single-line text that never widens its container.
 *
 * Pair it with `flex-1` (or any width-constrained parent) so the ellipsis has a
 * box to clip against; the `min-w-0` and `max-w-full` here stop long unbroken
 * strings — file names, URLs, CJK text — from forcing the layout wider.
 */
export function TruncatedText({
  text,
  className,
  tooltip = true,
  as: Tag = 'span',
}: TruncatedTextProps): JSX.Element {
  const node = (
    <Tag className={cn('block min-w-0 max-w-full truncate', className)} aria-label={text}>
      {text}
    </Tag>
  )

  if (!tooltip) return node

  return (
    // Self-contained provider so the tooltip works even when this renders
    // outside the app-level provider (isolated tests, storybook, dialogs).
    <TooltipProvider delayDuration={300}>
      <TooltipWrapper content={text}>{node}</TooltipWrapper>
    </TooltipProvider>
  )
}
