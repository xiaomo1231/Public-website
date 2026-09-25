import { Slot } from '@radix-ui/react-slot'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Short label above the title (e.g. the workspace / section name). */
  eyebrow?: ReactNode
  /** Optional leading icon shown in a theme-tinted badge. */
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn('px-4 pb-3 pt-5 sm:px-6 lg:px-8', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {icon && (
            <span
              aria-hidden
              className="page-icon mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-theme-primary-soft text-foreground [&_svg]:h-5 [&_svg]:w-5"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0 space-y-1.5">
            {eyebrow && (
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-theme-primary" />
                {eyebrow}
              </p>
            )}
            <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-[28px]">
              {title}
            </h1>
            {description && (
              <p className="max-w-2xl text-balance text-sm text-muted-foreground sm:text-[15px]">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export interface PageContentProps {
  children: ReactNode
  className?: string
}

export function PageContent({ children, className }: PageContentProps): JSX.Element {
  return (
    <main className={cn('flex-1 overflow-auto px-4 py-6 sm:px-6 lg:px-8', className)}>
      {children}
    </main>
  )
}

export function PageContainer({
  children,
  asChild,
  className,
}: {
  children: ReactNode
  asChild?: boolean
  className?: string
}): JSX.Element {
  const Comp = asChild ? Slot : 'div'
  return <Comp className={cn('flex h-full min-h-0 flex-col', className)}>{children}</Comp>
}
