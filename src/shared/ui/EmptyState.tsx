import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/80 bg-card/60 p-10 text-center',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          className="grid h-14 w-14 place-items-center rounded-2xl bg-theme-primary-soft text-foreground [&_svg]:h-7 [&_svg]:w-7"
        >
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground text-balance">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}