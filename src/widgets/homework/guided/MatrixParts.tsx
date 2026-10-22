import { useId, type KeyboardEvent } from 'react'
import type { Matrix } from '@/entities/homework/guidedMatrix'
import type { CellCheck } from '@/entities/homework/guidedMatrix'
import { cellLatex } from '@/entities/homework/walkthroughSteps'
import { Math as TeX } from '@/shared/ui/Math'
import { cn } from '@/shared/lib/utils'
import { answerFieldAttrs } from '@/shared/lib/answerFieldAttrs'
import { useTranslation } from '@/i18n'

/** LaTeX of a matrix, with the augmented bar where the walkthrough had it. */
function matrixLatex(matrix: Matrix, bar?: number): string {
  const width = matrix[0]?.length ?? 0
  const spec =
    bar !== undefined && bar > 0 && bar < width
      ? `${'c'.repeat(bar)}|${'c'.repeat(width - bar)}`
      : 'c'.repeat(width)
  const body = matrix.map((row) => row.map(cellLatex).join(' & ')).join(' \\\\ ')
  return `\\left[\\begin{array}{${spec}} ${body} \\end{array}\\right]`
}

export function MatrixDisplay({
  matrix,
  bar,
  label,
  className,
}: {
  matrix: Matrix
  bar?: number
  label: string
  className?: string
}): JSX.Element {
  return (
    // Scrolls sideways only when the matrix is really wider than the column;
    // vertical overflow is padding, never a scrollbar (KaTeX brackets reach
    // past the line box by a pixel or two).
    <div
      role="img"
      aria-label={label}
      className={cn('max-w-full overflow-x-auto overflow-y-hidden py-1.5', className)}
    >
      <TeX latex={matrixLatex(matrix, bar)} />
    </div>
  )
}

export interface MatrixInputGridProps {
  values: string[][]
  bar?: number
  checks?: CellCheck[][] | null
  /** Rows the step leaves unchanged (shown quieter). */
  unchangedRows?: ReadonlySet<number>
  onChange: (row: number, col: number, value: string) => void
  /** Enter in any cell. */
  onSubmit: () => void
  disabled?: boolean
  label: string
}

/**
 * The result matrix with a blank for every entry. Tab moves between cells;
 * Enter moves to the next blank cell (the on-screen keyboard shows "next"),
 * and checks once none is left or from the last cell ("go"). Cells are at
 * least 44 px tall for touch.
 */
export function MatrixInputGrid({
  values,
  bar,
  checks,
  unchangedRows,
  onChange,
  onSubmit,
  disabled = false,
  label,
}: MatrixInputGridProps): JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const width = values[0]?.length ?? 0
  const height = values.length
  const cellId = (r: number, c: number): string => `${id}-${r}-${c}`
  const isLast = (r: number, c: number): boolean => r === height - 1 && c === width - 1
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, r: number, c: number): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    // On to the next blank cell (reading order, then from the top); with
    // none left, or from the last cell, check.
    const order = values.flatMap((row, rr) => row.map((_, cc) => ({ r: rr, c: cc })))
    const at = r * width + c
    const rest = [...order.slice(at + 1), ...order.slice(0, at)]
    const next = isLast(r, c) ? undefined : rest.find((cell) => !values[cell.r]![cell.c]!.trim())
    if (next) document.getElementById(cellId(next.r, next.c))?.focus()
    else onSubmit()
  }
  return (
    <div className="max-w-full overflow-x-auto overflow-y-hidden py-1">
      <div
        role="group"
        aria-label={label}
        className="relative inline-block px-2.5 py-1 before:absolute before:inset-y-0 before:left-0 before:w-2 before:border-y-2 before:border-l-2 before:border-foreground/70 after:absolute after:inset-y-0 after:right-0 after:w-2 after:border-y-2 after:border-r-2 after:border-foreground/70"
      >
        <table className="border-separate border-spacing-1">
          <tbody>
            {values.map((row, r) => (
              <tr key={r} data-unchanged={unchangedRows?.has(r) ? '' : undefined}>
                {row.map((value, c) => {
                  const status = checks?.[r]?.[c]?.status
                  const bad = status === 'wrong' || status === 'unreadable' || status === 'inexact'
                  return (
                    <td
                      key={c}
                      className={cn(
                        bar !== undefined &&
                          c === bar - 1 &&
                          'border-r-2 border-foreground/50 pr-1.5',
                        bar !== undefined && c === bar && 'pl-1.5',
                      )}
                    >
                      <input
                        id={cellId(r, c)}
                        type="text"
                        // Exact numbers (−3/2): a keyboard with − and / (see
                        // answerFieldAttrs), and Scribble writes straight in.
                        {...answerFieldAttrs('fraction')}
                        enterKeyHint={isLast(r, c) ? 'go' : 'next'}
                        value={value}
                        disabled={disabled}
                        aria-label={t('guided.cellLabel', { row: r + 1, col: c + 1 })}
                        aria-invalid={bad || undefined}
                        data-status={status}
                        onChange={(event) => onChange(r, c, event.target.value)}
                        onKeyDown={(event) => onKeyDown(event, r, c)}
                        className={cn(
                          'focus-ring h-11 w-[4.5rem] rounded-md border border-input bg-background px-1.5 text-center font-mono text-[15px] tabular-nums text-foreground transition-colors lab:rounded-sm',
                          unchangedRows?.has(r) && 'bg-muted/40',
                          status === 'correct' &&
                            'border-emerald-500/70 bg-emerald-500/10 dark:border-emerald-400/60',
                          bad && 'border-destructive bg-destructive/10 ring-1 ring-destructive',
                          disabled && 'opacity-80',
                          c === width - 1 && 'mr-0',
                        )}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
