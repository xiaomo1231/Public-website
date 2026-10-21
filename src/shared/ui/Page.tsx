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
    <header className={cn('flex flex-col px-4 pb-3 pt-5 sm:px-6 lg:px-8', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {icon && (
            <span
              aria-hidden
              className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-theme-primary-soft text-secondary-foreground lecture:hidden lab:h-9 lab:w-9 lab:border lab:bg-card lab:text-foreground [&_svg]:h-5 [&_svg]:w-5 lab:[&_svg]:h-4 lab:[&_svg]:w-4"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0 space-y-1.5">
            {eyebrow && (
              <p className="text-sm text-muted-foreground lecture:text-xs lecture:tracking-[0.14em] lecture:text-primary lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-wider">
                {eyebrow}
              </p>
            )}
            <h1 className="break-words font-heading text-[26px] font-semibold leading-tight tracking-tight text-foreground lecture:font-bold lecture:tracking-normal lab:text-[22px] sm:text-[28px] sm:lecture:text-[30px] sm:lab:text-[22px]">
              {title}
            </h1>
            {description && (
              <p className="max-w-2xl text-balance text-sm text-muted-foreground sm:text-[15px]">
                {description}
              </p>
            )}
          </div>
        </div>
        {/* Actions may shrink (min-w-0), so a long button label truncates instead of squeezing the title. */}
        {actions && (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:max-w-[50%] sm:justify-end [&>*]:min-w-0 [&>*]:max-w-full">
            {actions}
          </div>
        )}
      </div>
      {/* Lecture: the course sections form a second bar under the top bar. */}
      {nav && (
        <div className="mt-4 lecture:order-first lecture:-mx-4 lecture:-mt-5 lecture:mb-6 lecture:border-b lecture:px-4 sm:lecture:-mx-6 sm:lecture:px-6 lg:lecture:-mx-8 lg:lecture:px-8">
          {nav}
        </div>
      )}
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
        // Lecture scrolls the whole page (header included) so the reading
        // column gets the full height; lab keeps the header pinned.
        'lecture:flex-none lecture:overflow-visible',
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
  return (
    <Comp className={cn('flex h-full min-h-0 flex-col lecture:overflow-y-auto', className)}>
      {children}
    </Comp>
  )
}
