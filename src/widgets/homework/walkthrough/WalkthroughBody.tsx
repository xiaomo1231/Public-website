import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import type { WalkthroughPart } from '@/entities/homework/walkthrough'
import {
  conclusionByPart,
  formatWalkthroughText,
  splitSubparts,
} from '@/entities/homework/walkthroughFormat'
import {
  cellLatex,
  entryArithmetic,
  entryText,
  splitSteps,
  type LatexMatrix,
  type WalkthroughStep,
} from '@/entities/homework/walkthroughSteps'
import { Math as TeX } from '@/shared/ui/Math'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import { EMULATED_MOUSE_WINDOW_MS, isTouchLike } from '@/shared/lib/pointerGesture'
import { useTranslation } from '@/i18n'
import { sharedColumnWidths } from './stepLayout'

/**
 * Reading width and type scale of walkthrough prose, in both interface
 * styles: lines of about 70 characters, four sizes (sub-part heading, step
 * heading, body, aside) and tabular figures. Display formulas are placed
 * under their sentence by the `[data-walkthrough-body]` rules in globals.css.
 */
export const WALKTHROUGH_PROSE = cn(
  'min-w-0 max-w-[70ch] space-y-4 tabular-nums',
  '[&_h3]:pt-4 [&_h3]:text-[19px] [&_h3]:font-semibold [&_h3]:leading-snug',
  'lecture:[&_h3]:font-heading lecture:[&_h3]:text-[21px] lecture:[&_h3]:font-bold',
  'lab:[&_h3]:text-[17px] lab:[&_h3]:tracking-tight',
  '[&_h4]:pt-2 [&_h4]:text-[16px] [&_h4]:font-semibold',
  '[&_blockquote_p]:text-[13.5px] [&_blockquote_p]:leading-relaxed',
)

/** Body text of the walkthrough (the third of the four sizes). */
export const WALKTHROUGH_PARAGRAPH =
  'text-[15px] leading-[1.8] lecture:text-[17px] lecture:leading-[1.9]'

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

function stepMark(number: number): string {
  return number >= 1 && number <= CIRCLED.length ? CIRCLED[number - 1]! : `(${number})`
}

export interface WalkthroughBodyProps {
  /** Markdown + LaTeX as stored. */
  text: string
  /** The section's conclusion, to box a sub-part's answer that was never boxed. */
  conclusion?: string
  /** Split question: each sub-part's own conclusion. */
  parts?: WalkthroughPart[]
  className?: string
}

/**
 * A worked section: the stored Markdown, tidied for display (no stray stop
 * after a box, `\dfrac` in matrices, terms bold only once), with row
 * operations shown as step cards and each sub-part closed by its boxed answer
 * when the text never boxed one. Anything not recognised renders as before.
 */
export function WalkthroughBody({
  text,
  conclusion,
  parts,
  className,
}: WalkthroughBodyProps): JSX.Element {
  const { t } = useTranslation()
  const segments = useMemo(
    () =>
      splitSubparts(formatWalkthroughText(text)).map((segment) => ({
        ...segment,
        chunks: splitSteps(segment.text),
      })),
    [text],
  )
  const answers = useMemo(
    () =>
      parts && parts.length > 0
        ? new Map(parts.map((part) => [part.label, part.conclusion]))
        : conclusionByPart(conclusion ?? ''),
    [parts, conclusion],
  )
  return (
    <div data-walkthrough-body className={cn(WALKTHROUGH_PROSE, className)}>
      {segments.map((segment, index) => {
        const answer = segment.label ? answers.get(segment.label) : undefined
        return (
          <Fragment key={index}>
            {segment.chunks.map((chunk, at) =>
              chunk.kind === 'text' ? (
                <RichText
                  key={at}
                  text={chunk.text}
                  format="markdown"
                  className="min-w-0 space-y-4"
                  paragraphClassName={WALKTHROUGH_PARAGRAPH}
                />
              ) : (
                <StepCard key={at} step={chunk.step} />
              ),
            )}
            {segment.label && answer && !segment.text.includes('\\boxed') && (
              <div
                data-walkthrough-final={segment.label}
                className="max-w-full rounded-md border-2 border-primary/70 px-4 py-2.5 lecture:rounded-none lab:rounded-none lab:border"
              >
                <span className="block text-[13px] text-muted-foreground lecture:tracking-[0.14em] lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-wider">
                  {t('homework.walkthrough.finalAnswer')} ({segment.label})
                </span>
                <RichText
                  text={formatWalkthroughText(answer)}
                  format="markdown"
                  paragraphClassName="text-[15px] font-semibold leading-relaxed lecture:text-[17px]"
                />
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

type Active = { row: number; col?: number } | null

/** One row-reduction step: operation, matrix before → after, local arithmetic. */
export function StepCard({ step }: { step: WalkthroughStep }): JSX.Element {
  const { t } = useTranslation()
  const [active, setActive] = useState<Active>(null)
  // Set when a finger / pen tap chose the entry: it stays until another tap.
  const [tapped, setTapped] = useState(false)
  const lastTouch = useRef(0)
  const cardRef = useRef<HTMLDivElement>(null)
  const id = useId()
  /** Mouse hover and keyboard focus, as before; ignored right after a tap. */
  const hoverActive = (next: Active): void => {
    if (tapped || Date.now() - lastTouch.current < EMULATED_MOUSE_WINDOW_MS) return
    setActive(next)
  }
  /** A tap on an entry shows its arithmetic; tapping it again hides it. */
  const tapActive = (next: { row: number; col: number }): void => {
    const same = tapped && active?.row === next.row && active.col === next.col
    setTapped(!same)
    setActive(same ? null : next)
  }
  // A tap outside the step card hides a tapped readout.
  useEffect(() => {
    if (!tapped) return
    const onDown = (event: Event): void => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return
      setTapped(false)
      setActive(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [tapped])
  // Both matrices share column widths, so their entries line up identically.
  const columnWidths = useMemo(
    () => sharedColumnWidths(step.before, step.after),
    [step.before, step.after],
  )
  const mismatchAt = (row: number, col: number) =>
    step.mismatches.find((item) => item.row === row && item.col === col)
  const arithmetic = (row: number, col: number) => {
    const origin = step.provenance[row]
    return origin ? entryArithmetic(origin, col, step.computed[row]![col]!) : null
  }
  const readout = (() => {
    if (!active) return null
    const width = step.after.rows[0]!.length
    const cols =
      active.col === undefined ? Array.from({ length: width }, (_, i) => i) : [active.col]
    return cols.map((col) => ({ col, math: arithmetic(active.row, col) }))
  })()
  return (
    <div
      ref={cardRef}
      data-walkthrough-step={step.number}
      onPointerDownCapture={(event) => {
        if (isTouchLike(event.pointerType)) lastTouch.current = Date.now()
      }}
      className="space-y-3 border-l-2 border-primary/50 py-1 pl-4 lab:border-dashed lab:border-primary/60"
    >
      <p className="text-[15px] font-semibold leading-relaxed lecture:text-[16px]">
        <span aria-hidden className="mr-2 text-primary">
          {stepMark(step.number)}
        </span>
        <span className="sr-only">
          {t('homework.walkthrough.step.title', { number: step.number })}{' '}
        </span>
        {step.ops.map((op, index) => (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden>, </span>}
            <TeX latex={op.latex} />
          </Fragment>
        ))}
      </p>
      {step.intro && (
        <RichText
          text={step.intro}
          format="markdown"
          className="min-w-0 space-y-2"
          paragraphClassName={WALKTHROUGH_PARAGRAPH}
        />
      )}
      <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 overflow-x-auto py-1">
        <MatrixView
          matrix={step.before}
          label={t('homework.walkthrough.step.beforeMatrix', { number: step.number })}
          columnWidths={columnWidths}
        />
        {/* The operations over the arrow, at a readable size (the heading
            above already names them for assistive technology). */}
        <div aria-hidden className="flex shrink-0 flex-col items-center gap-1 px-1">
          {step.ops.map((op, index) => (
            <TeX key={index} latex={op.latex} className="whitespace-nowrap text-[13px]" />
          ))}
          <span className="relative block h-px w-full min-w-12 bg-foreground/70">
            <span className="absolute -right-px -top-[4px] h-0 w-0 border-y-[4.5px] border-l-[8px] border-y-transparent border-l-foreground/70" />
          </span>
        </div>
        <MatrixView
          matrix={step.after}
          columnWidths={columnWidths}
          label={t('homework.walkthrough.step.matrix', { number: step.number })}
          changedRows={step.changedRows}
          active={active}
          onActive={hoverActive}
          onTap={(row, col) => {
            if (Date.now() - lastTouch.current < EMULATED_MOUSE_WINDOW_MS) tapActive({ row, col })
          }}
          describe={(row, col) => {
            const value = step.after.rows[row]![col]!
            const parts = [
              t('homework.walkthrough.step.cell', {
                row: row + 1,
                col: col + 1,
                value: entryText(value),
              }),
            ]
            const math = arithmetic(row, col)
            if (math) parts.push(math.text)
            const wrong = mismatchAt(row, col)
            if (wrong)
              parts.push(
                t('homework.walkthrough.step.expected', { value: entryText(wrong.expected) }),
              )
            return parts.join('；')
          }}
          wrongCell={(row, col) => Boolean(mismatchAt(row, col))}
          idPrefix={id}
        />
      </div>
      <div
        aria-hidden
        className="min-h-[1.75rem] text-[13.5px] text-muted-foreground"
        data-walkthrough-readout
      >
        {readout ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-muted/60 px-2 py-1 text-foreground lab:rounded-none">
            <span className="text-muted-foreground">
              {t('homework.walkthrough.step.row', { row: active!.row + 1 })}
            </span>
            {readout.map(({ col, math }) =>
              math ? (
                <span key={col} className="whitespace-nowrap">
                  <TeX latex={math.latex} />
                  {mismatchAt(active!.row, col) && (
                    <span className="ml-1 text-destructive">
                      {t('homework.walkthrough.step.expected', {
                        value: entryText(mismatchAt(active!.row, col)!.expected),
                      })}
                    </span>
                  )}
                </span>
              ) : null,
            )}
          </div>
        ) : (
          t('homework.walkthrough.step.hint')
        )}
      </div>
      {step.mismatches.length > 0 ? (
        <ul className="space-y-1 text-[13.5px] text-amber-700 dark:text-amber-300">
          {step.mismatches.map((item) => (
            <li key={`${item.row}:${item.col}`} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('homework.walkthrough.step.mismatch', {
                row: item.row + 1,
                col: item.col + 1,
                written: entryText(item.written),
                expected: entryText(item.expected),
              })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <ShieldCheck
            className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          {t('homework.walkthrough.step.checked')}
        </p>
      )}
    </div>
  )
}

interface MatrixViewProps {
  matrix: LatexMatrix
  label: string
  changedRows?: number[]
  active?: Active
  onActive?: (active: Active) => void
  /** A click on a changed entry (the step card keeps it only for finger / pen taps). */
  onTap?: (row: number, col: number) => void
  describe?: (row: number, col: number) => string
  wrongCell?: (row: number, col: number) => boolean
  idPrefix?: string
  /** Minimum width of each column, in em (shared by the matrices of one step). */
  columnWidths?: number[]
}

/** A bracketed matrix whose changed entries can be hovered or focused. */
function MatrixView({
  matrix,
  label,
  changedRows = [],
  active,
  onActive,
  onTap,
  describe,
  wrongCell,
  idPrefix,
  columnWidths,
}: MatrixViewProps): JSX.Element {
  return (
    <div className="relative inline-block shrink-0 px-2 py-0.5 before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:border-y before:border-l before:border-foreground/70 after:absolute after:inset-y-0 after:right-0 after:w-1.5 after:border-y after:border-r after:border-foreground/70">
      <table
        aria-label={label}
        className="border-separate border-spacing-0 text-[15px] tabular-nums"
      >
        <tbody>
          {matrix.rows.map((row, r) => {
            const changed = changedRows.includes(r)
            return (
              <tr
                key={r}
                data-changed={changed ? '' : undefined}
                className={cn(changed && 'bg-primary/10')}
                onMouseEnter={changed && onActive ? () => onActive({ row: r }) : undefined}
                onMouseLeave={changed && onActive ? () => onActive(null) : undefined}
              >
                {row.map((value, c) => {
                  const wrong = changed && (wrongCell?.(r, c) ?? false)
                  const focusable = changed && Boolean(describe)
                  const descId = idPrefix ? `${idPrefix}-${r}-${c}` : undefined
                  const isActive =
                    active?.row === r && (active.col === undefined || active.col === c)
                  return (
                    <td
                      key={c}
                      tabIndex={focusable ? 0 : undefined}
                      aria-describedby={focusable ? descId : undefined}
                      data-wrong={wrong ? '' : undefined}
                      onMouseEnter={focusable ? () => onActive?.({ row: r, col: c }) : undefined}
                      onClick={focusable && onTap ? () => onTap(r, c) : undefined}
                      onFocus={focusable ? () => onActive?.({ row: r, col: c }) : undefined}
                      onBlur={focusable ? () => onActive?.(null) : undefined}
                      className={cn(
                        'px-2 py-1 text-center align-middle outline-none',
                        matrix.bar !== undefined &&
                          c === matrix.bar - 1 &&
                          'border-r border-foreground/50',
                        focusable && 'cursor-default focus-visible:ring-2 focus-visible:ring-ring',
                        isActive && changed && 'bg-primary/20',
                        wrong && 'bg-destructive/10 ring-1 ring-inset ring-destructive',
                      )}
                    >
                      <span
                        className="inline-block"
                        style={
                          columnWidths?.[c] !== undefined
                            ? { minWidth: `${columnWidths[c]}em` }
                            : undefined
                        }
                      >
                        <TeX latex={cellLatex(value)} />
                      </span>
                      {focusable && descId && (
                        // Hidden from browsing; read as the cell's description on focus.
                        <span id={descId} hidden>
                          {describe!(r, c)}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
