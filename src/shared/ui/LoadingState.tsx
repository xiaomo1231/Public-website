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
        'flex flex-col items-center justify-center gap-3 rounded-lg border bg-card/50 p-10 text-center text-sm text-muted-foreground',
        className,
      )}
    >
      <Loader2 className="h-6 w-6 animate-spin" />
      {resolvedLabel && <div className="font-medium text-foreground">{resolvedLabel}</div>}
      {description && <div>{description}</div>}
    </div>
  )
}