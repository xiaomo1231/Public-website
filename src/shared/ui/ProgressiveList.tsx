import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { Button } from './Button'
import { cn } from '@/shared/lib/utils'

export interface ProgressiveListProps<T> {
  items: T[]
  /** How many items to render initially and per "show more" click. */
  pageSize?: number
  renderItem: (item: T, index: number) => ReactNode
  className?: string
  /** Rendered when `items` is empty. */
  empty?: ReactNode
}

/**
 * Renders a long list progressively instead of mounting every row at once.
 *
 * This is deliberately *not* virtualization: no dependency, no measurement,
 * no scroll anchoring. It caps the mounted DOM at `pageSize` + whatever the
 * user explicitly revealed, which is enough for the lists in this app
 * (hundreds to a few thousand rows).
 *
 * The revealed count is never reset when the underlying list changes; a
 * shrinking list simply renders fewer rows, and a growing one keeps the
 * user's revealed window.
 */
export function ProgressiveList<T>({
  items,
  pageSize = 50,
  renderItem,
  className,
  empty,
}: ProgressiveListProps<T>): JSX.Element {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(pageSize)

  if (items.length === 0 && empty !== undefined) {
    return <>{empty}</>
  }

  const visible = items.slice(0, revealed)
  const remaining = items.length - visible.length

  return (
    <div className={className}>
      {visible.map((item, index) => renderItem(item, index))}

      {remaining > 0 && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevealed((current) => current + pageSize)}
          >
            <ChevronDown className={cn('h-4 w-4')} />
            {t('progressiveList.showMore', { count: Math.min(pageSize, remaining) })}
            <span className="text-muted-foreground">{t('progressiveList.remaining', { count: remaining })}</span>
          </Button>
        </div>
      )}
    </div>
  )
}
