import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from '@/i18n'
import { cn } from '@/shared/lib/utils'

export interface LoadingStateProps {
  label?: ReactNode
  description?: ReactNode
  className?: string
  inline?: boolean
}

export function LoadingState({
  label,
  description,
  className,
  inline,
}: LoadingStateProps): JSX.Element {
  const { t } = useTranslation()
  const resolvedLabel = label === undefined ? t('common.loading') : label

  if (inline) {
    return (
      <span className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        {resolvedLabel}
      </span>
    )
  }
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-border/70 bg-card/60 p-10 text-center text-sm text-muted-foreground',
        className,
      )}
    >
      <span className="plate-grid grid h-14 w-14 place-items-center rounded-2xl border border-border/70 bg-theme-primary-soft text-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </span>
      {resolvedLabel && <div className="font-medium text-foreground">{resolvedLabel}</div>}
      {description && <div>{description}</div>}
    </div>
  )
}