import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export interface SectionHeadingProps {
  title: ReactNode
  description?: ReactNode
  /** Short label above the title. */
  eyebrow?: ReactNode
  /** Trailing control (e.g. a "view all" link or a small button). */
  action?: ReactNode
  className?: string
}

/**
 * A section title row used inside pages.
 *
 * Gives content blocks a clear hierarchy without wrapping every one of them in
 * its own card. Kept separate from `PageHeader` so a page can have a strong
 * header and several lighter section headings.
 */
export function SectionHeading({
  title,
  description,
  eyebrow,
  action,
  className,
}: SectionHeadingProps): JSX.Element {
  return (
    <div
      className={cn(
        'mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {description && (
          <p className="max-w-2xl text-sm text-muted-foreground text-balance">{description}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}
