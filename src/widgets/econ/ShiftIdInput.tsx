import { useId } from 'react'
import {
  CURVE_MOVE_OPTIONS,
  OUTCOME_MOVE_OPTIONS,
  decodeShiftAnswer,
  encodeShiftAnswer,
  type ShiftAnswer,
  type ShiftComponent,
} from '@/entities/econ/graphQuestion'
import { onRadioKeyDown } from '@/shared/lib/radioGroupKeys'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

const ROWS: Array<{ key: ShiftComponent; label: TranslationKey; curve: boolean }> = [
  { key: 'demand', label: 'marketQ.input.demand', curve: true },
  { key: 'supply', label: 'marketQ.input.supply', curve: true },
  { key: 'price', label: 'marketQ.input.price', curve: false },
  { key: 'quantity', label: 'marketQ.input.quantity', curve: false },
]

/**
 * 曲线移动题的作答: four segmented choices — each curve (left / no shift /
 * right) and the equilibrium price and quantity (falls / unchanged / rises /
 * ambiguous). Radio groups with the arrow-key pattern; every choice ≥ 44 px.
 * The answer is stored as `shift: demand=…; supply=…; price=…; quantity=…`.
 */
export function ShiftIdInput({
  value,
  onChange,
  disabled,
  expected,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** After grading: the expected answer, to mark each row. */
  expected?: ShiftAnswer
}): JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const answer = decodeShiftAnswer(value) ?? {}
  const set = (key: ShiftComponent, option: string) =>
    onChange(encodeShiftAnswer({ ...answer, [key]: option } as Partial<ShiftAnswer>))
  return (
    <div className="space-y-3" data-shift-input>
      <p className="text-xs text-muted-foreground">{t('marketQ.input.shiftHint')}</p>
      {ROWS.map((row) => {
        const options = row.curve ? CURVE_MOVE_OPTIONS : OUTCOME_MOVE_OPTIONS
        const selected = answer[row.key]
        const selectedIndex = selected ? (options as readonly string[]).indexOf(selected) : -1
        const labelId = `${id}-shift-${row.key}`
        return (
          <div key={row.key} className="space-y-1.5">
            <p id={labelId} className="text-sm font-medium">
              {t(row.label)}
            </p>
            <div
              role="radiogroup"
              aria-labelledby={labelId}
              className="flex flex-wrap gap-1.5"
              data-shift-row={row.key}
            >
              {options.map((option, index) => {
                const checked = selected === option
                const right = expected && expected[row.key] === option
                const wrong = expected && checked && !right
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked || (selectedIndex < 0 && index === 0) ? 0 : -1}
                    disabled={disabled}
                    onClick={() => set(row.key, option)}
                    onKeyDown={(event) =>
                      onRadioKeyDown(
                        event,
                        options as readonly string[],
                        Math.max(0, selectedIndex),
                        (next) => set(row.key, next),
                      )
                    }
                    data-option={option}
                    data-expected={right ? 'true' : undefined}
                    className={cn(
                      'focus-ring min-h-11 rounded-md border px-3 text-sm transition-colors disabled:cursor-default',
                      checked
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border/80 text-muted-foreground hover:bg-accent',
                      right && 'border-emerald-600 dark:border-emerald-400',
                      wrong && 'border-destructive',
                    )}
                  >
                    {t(
                      `marketQ.input.${row.curve ? 'curve' : 'outcome'}.${option}` as TranslationKey,
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
