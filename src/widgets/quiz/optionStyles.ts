import { cn } from '@/shared/lib/utils'

/**
 * Answer rows for choice questions, in both interface styles.
 *
 * lecture — tall rounded rows on paper, a serif letter; selected = accent
 *           border + soft accent fill.
 * lab     — stacked hairline rows sharing borders, a small square key box
 *           that fills with the accent when selected.
 */
export const optionListClass = 'space-y-2 lecture:space-y-2.5 lab:space-y-0 lab:pt-px'

export interface OptionState {
  selected: boolean
  /** Graded and this row is a correct answer. */
  correct?: boolean
  /** Graded and this row was chosen but is wrong. */
  wrong?: boolean
}

export function optionRowClass({ selected, correct, wrong }: OptionState): string {
  return cn(
    'relative flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm focus-ring',
    'transition-[color,background-color,border-color,transform] duration-press ease-out motion-safe:active:scale-[0.98] disabled:active:scale-100',
    'lecture:rounded-xl lecture:bg-card lecture:px-[18px] lecture:py-3.5 lecture:text-base lecture:leading-relaxed',
    'lab:-mt-px lab:rounded-none lab:bg-card lab:px-3.5 lab:py-2.5 lab:text-[15px]',
    selected
      ? 'z-[1] border-primary bg-theme-primary-soft lab:border-primary/60 lab:bg-theme-primary-soft'
      : 'border-border hover:border-foreground/30 lab:hover:border-border lab:hover:bg-background',
    correct &&
      'z-[1] border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20 lab:border-emerald-500/60 lab:bg-emerald-50/50 lab:dark:bg-emerald-950/20',
    wrong &&
      'z-[1] border-destructive/60 bg-destructive/5 lab:border-destructive/60 lab:bg-destructive/5',
  )
}

/** The A / B / C key at the start of a row. `square` marks multi-select rows. */
export function optionKeyClass(selected: boolean, square = false): string {
  return cn(
    'data-num grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition-[color,background-color,border-color] duration-press ease-out',
    'lecture:font-heading lecture:text-base lecture:font-bold lecture:text-muted-foreground',
    'lab:rounded-sm lab:border lab:border-input lab:font-mono lab:text-muted-foreground',
    square && 'lecture:rounded-md lecture:border lecture:border-input lecture:text-sm',
    selected &&
      'lecture:text-primary lab:border-primary-strong lab:bg-primary-strong lab:text-primary-foreground',
    selected &&
      square &&
      'lecture:border-primary-strong lecture:bg-primary-strong lecture:text-primary-foreground',
  )
}
