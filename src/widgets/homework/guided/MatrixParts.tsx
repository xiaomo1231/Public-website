import { useId, type KeyboardEvent } from 'react'
import type { Matrix } from '@/entities/homework/guidedMatrix'
import type { CellCheck } from '@/entities/homework/guidedMatrix'
import { cellLatex } from '@/entities/homework/walkthroughSteps'
import { Math as TeX } from '@/shared/ui/Math'
import { cn } from '@/shared/lib/utils'
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
    <div role="img" aria-label={label} className={cn('max-w-full overflow-x-auto', className)}>
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
 * The result matrix with a blank for every entry. Tab moves between cells,
 * Enter checks. Cells are at least 44 px tall for touch.
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
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmit()
    }
  }
  return (
    <div className="max-w-full overflow-x-auto pb-1">
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
                        id={`${id}-${r}-${c}`}
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={value}
                        disabled={disabled}
                        aria-label={t('guided.cellLabel', { row: r + 1, col: c + 1 })}
                        aria-invalid={bad || undefined}
                        data-status={status}
                        onChange={(event) => onChange(r, c, event.target.value)}
                        onKeyDown={onKeyDown}
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
