import type { ReactNode } from 'react'

/**
 * A group of settings sections under one heading that says how its changes
 * apply: at once, or with the save bar.
 */
export function SettingsGroup({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note: string
  children: ReactNode
}): JSX.Element {
  return (
    <section aria-labelledby={id} className="space-y-4 lecture:space-y-0">
      <header className="pt-2 first:pt-0 lecture:border-b lecture:border-border lecture:pb-3 lecture:pt-8 lab:pt-4">
        <h2
          id={id}
          className="text-sm font-semibold lecture:font-heading lecture:text-lg lecture:font-bold lab:font-mono lab:text-[11px] lab:font-medium lab:uppercase lab:tracking-wider lab:text-muted-foreground"
        >
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{note}</p>
      </header>
      {children}
    </section>
  )
}
