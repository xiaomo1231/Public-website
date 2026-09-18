import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export interface LoadingStateProps {
  label?: ReactNode
  description?: ReactNode
  className?: string
  inline?: boolean
}

export function LoadingState({
  label = 'Loading…',
  description,
  className,
  inline,
}: LoadingStateProps): JSX.Element {
  if (inline) {
    return (
      <span className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
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
      {label && <div className="font-medium text-foreground">{label}</div>}
      {description && <div>{description}</div>}
    </div>
  )
}