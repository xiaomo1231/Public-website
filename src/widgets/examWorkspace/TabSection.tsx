import type { ReactNode } from 'react'

/** A titled block inside a 考试工作台 tab (both UI styles). */
export function TabSection({
  title,
  action,
  children,
  ...rest
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
} & Record<`data-${string}`, string | boolean | undefined>): JSX.Element {
  return (
    <section className="space-y-3" {...rest}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold lecture:text-[19px] lab:text-[15px]">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}
