import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export interface ErrorStateProps {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  action,
  className,
}: ErrorStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-10 text-center',
        className,
      )}
    >
      <AlertCircle className="h-6 w-6 text-destructive" />
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-destructive">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground text-balance">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}