import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import type { TeachingBlockSpec } from '@/shared/lib/teachingBlocks'

/**
 * Presentation for a recognised teaching block.
 *
 * Restraint is deliberate: only the formal blocks the lesson prompt asks for
 * (Definition, Example, Key Idea, Important, Warning, Note, Common Mistake) get
 * a container. Ordinary sections such as Explanation or Summary stay plain
 * headings so the page reads like a textbook rather than a dashboard of cards.
 */

const BOXED_TONE: Record<string, string> = {
  definition: 'border-border bg-muted/25',
  keyIdea: 'border-primary/30 bg-primary/[0.04]',
  example: 'border-border bg-muted/25',
  workedExample: 'border-border bg-muted/25',
  important: 'border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20',
  warning: 'border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20',
  note: 'border-border bg-muted/20',
  commonMistake: 'border-destructive/35 bg-destructive/5',
}

const ICON_TONE: Record<string, string> = {
  important: 'text-amber-600 dark:text-amber-400',
  warning: 'text-amber-600 dark:text-amber-400',
  commonMistake: 'text-destructive',
}

export interface TeachingBlockProps {
  spec: TeachingBlockSpec
  /** Heading level from the source Markdown, preserved for screen readers. */
  level: number
  children: ReactNode
}

export function TeachingBlock({ spec, level, children }: TeachingBlockProps): JSX.Element {
  const { t } = useTranslation()
  const Icon = spec.icon
  const label = t(spec.labelKey)
  const Heading = (level <= 2 ? 'h2' : 'h3') as 'h2' | 'h3'

  if (!spec.boxed) {
    return (
      <section className="space-y-3">
        <Heading className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">
          {label}
        </Heading>
        <div className="space-y-3">{children}</div>
      </section>
    )
  }

  return (
    <section
      className={cn('rounded-lg border px-4 py-3.5', BOXED_TONE[spec.kind] ?? 'border-border')}
      aria-label={label}
    >
      <Heading className="flex items-center gap-2 text-[17px] font-semibold leading-snug text-foreground">
        <Icon
          className={cn('h-4 w-4 shrink-0', ICON_TONE[spec.kind] ?? 'text-muted-foreground')}
          aria-hidden
        />
        {label}
      </Heading>
      <div className="mt-2.5 space-y-3">{children}</div>
    </section>
  )
}
