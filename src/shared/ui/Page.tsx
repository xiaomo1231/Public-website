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
  /** Optional strip rendered under the title block (e.g. per-course navigation). */
  nav?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  nav,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn('px-4 pb-3 pt-5 sm:px-6 lg:px-8', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {icon && (
            <span
              aria-hidden
              className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-theme-primary-soft text-secondary-foreground [&_svg]:h-5 [&_svg]:w-5"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0 space-y-1.5">
            {eyebrow && (
              <p className="text-sm text-muted-foreground">{eyebrow}</p>
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
      {nav && <div className="mt-4">{nav}</div>}
    </header>
  )
}

export interface PageContentProps {
  children: ReactNode
  className?: string
}

export function PageContent({ children, className }: PageContentProps): JSX.Element {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        // `relative` makes this the containing block for visually-hidden
        // (position:absolute) descendants. Without it, `sr-only` inputs inside
        // a page resolve against the shell column, escape this scroll box, and
        // stretch the document into a second scroll container.
        'relative flex-1 overflow-auto px-4 py-6 outline-none sm:px-6 lg:px-8',
        className,
      )}
    >
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
