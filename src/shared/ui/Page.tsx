import { Slot } from '@radix-ui/react-slot'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header
      className={cn(
        'flex flex-col gap-3 border-b bg-background/95 px-6 py-5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="break-words text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground text-balance">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export interface PageContentProps {
  children: ReactNode
  className?: string
}

export function PageContent({ children, className }: PageContentProps): JSX.Element {
  return <main className={cn('flex-1 overflow-auto px-6 py-6', className)}>{children}</main>
}

export function PageContainer({ children, asChild, className }: { children: ReactNode; asChild?: boolean; className?: string }): JSX.Element {
  const Comp = asChild ? Slot : 'div'
  return <Comp className={cn('flex h-full min-h-0 flex-col', className)}>{children}</Comp>
}