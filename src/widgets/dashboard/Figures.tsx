import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * Shared presentation for the two interface styles' "numbers at a glance".
 *
 * One markup, two looks (keyed off `<html data-ui-style>`):
 * - lecture — a "figures" row: a heavy rule on top, thin rules between,
 *   big serif numerals with the label underneath.
 * - lab — a "readout" strip: hairline cells on a card, a small mono LABEL on
 *   top, a mono value and a sub line, optionally a thin bar.
 *
 * Every value passed here must come from stored data; `null` renders an em
 * dash rather than a made-up zero.
 */
export interface FigureItem {
  /** Stable key and the label shown with the value. */
  label: string
  value: ReactNode
  /** Small trailing unit / denominator after the value (e.g. "/ 6", "%"). */
  unit?: ReactNode
  /** One extra line of context under the value. */
  sub?: ReactNode
  /** 0..1 — draws a thin bar (lab only); omit when there is no real ratio. */
  ratio?: number
  /** Colours the value with the accent (e.g. a status word). */
  tone?: 'default' | 'accent'
}

export function FigureStrip({
  items,
  label,
  className,
}: {
  items: FigureItem[]
  /** Accessible name for the group. */
  label: string
  className?: string
}): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <dl
      aria-label={label}
      className={cn(
        'data-num grid grid-cols-2',
        items.length >= 4 ? 'sm:grid-cols-4' : items.length === 3 ? 'sm:grid-cols-3' : '',
        // lecture: rules only, no box.
        'lecture:border-b lecture:border-t-[1.5px] lecture:border-b-border lecture:border-t-foreground',
        // lab: hairline cells on a card (gap-px over a border-coloured fill).
        'lab:gap-px lab:border lab:border-border lab:bg-border',
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            'flex min-w-0 flex-col',
            'lecture:py-4 lecture:pr-4',
            // Rules between cells: per row of two on phones, one row from sm.
            index % 2 === 1 && 'lecture:border-l lecture:pl-4',
            index >= 2 && 'lecture:border-t sm:lecture:border-t-0',
            index > 0 && 'sm:lecture:border-l sm:lecture:pl-4',
            'lab:bg-card lab:px-3.5 lab:py-3',
          )}
        >
          <dt
            className={cn(
              'min-w-0 break-words',
              'lecture:order-2 lecture:mt-0.5 lecture:text-[13.5px] lecture:text-muted-foreground',
              'lab:font-mono lab:text-[10.5px] lab:uppercase lab:tracking-[0.06em] lab:text-muted-foreground',
            )}
          >
            {item.label}
          </dt>
          <dd
            className={cn(
              'min-w-0 leading-tight',
              'lecture:order-1 lecture:font-heading lecture:text-[30px] lecture:font-bold',
              'lab:mt-1.5 lab:font-mono lab:text-[22px] lab:font-medium lab:tracking-[-0.01em]',
              item.tone === 'accent' ? 'text-primary' : 'text-foreground',
            )}
          >
            {item.value ?? '—'}
            {item.unit !== undefined && (
              <small className="ml-1 font-normal text-muted-foreground lecture:text-[15px] lab:text-xs">
                {item.unit}
              </small>
            )}
          </dd>
          {item.sub !== undefined && (
            <dd className="order-3 min-w-0 break-words text-xs text-muted-foreground lab:mt-0.5">
              {item.sub}
            </dd>
          )}
          {item.ratio !== undefined && (
            <dd aria-hidden className="order-4 hidden lab:mt-2.5 lab:block">
              <MiniBar value={item.ratio} />
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}

/** A thin, square progress bar for estimates (purely visual; pair it with text). */
export function MiniBar({ value, className }: { value: number; className?: string }): JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span aria-hidden className={cn('block h-1 overflow-hidden bg-border', className)}>
      <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
    </span>
  )
}

/**
 * Section heading in the style's voice: a serif title in lecture, a small mono
 * label in lab.
 */
export const SECTION_TITLE_CLASS =
  'font-heading text-[18px] font-bold text-foreground lab:font-mono lab:text-[11px] lab:font-medium lab:uppercase lab:tracking-[0.08em] lab:text-muted-foreground'

/** Header row of a lab hairline table. */
export const LAB_TABLE_HEAD_CLASS =
  'bg-muted/60 font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground'

/** Small mono chip used for roles / states in lab tables. */
export const LAB_CHIP_CLASS =
  'inline-flex max-w-full items-center whitespace-nowrap rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] leading-4 text-muted-foreground'
