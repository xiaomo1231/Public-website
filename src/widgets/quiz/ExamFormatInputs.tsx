import { Check, X } from 'lucide-react'
import { optionLetter, type Question } from '@/entities/question/types'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/utils'
import {
  gradedOptionStatusKey,
  optionKeyClass,
  optionListClass,
  optionRowClass,
} from './optionStyles'
import { toggleOptionValue } from './quizKeyboard'
import { useTranslation } from '@/i18n'

interface InputProps {
  question: Question
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  revealed?: boolean
}

/** X-type: choose every correct option. Value: chosen option ids joined by ",". */
export function MultipleSelectInput({
  question,
  value,
  onChange,
  disabled,
  revealed,
}: InputProps): JSX.Element {
  const { t } = useTranslation()
  const options = question.options ?? []
  const chosen = new Set(value.split(',').filter(Boolean))
  // Keep option order so the stored answer is stable.
  const toggle = (id: string) => onChange(toggleOptionValue(question, value, id))
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('answerInput.multipleSelectHint')}</p>
      <div className={optionListClass}>
        {options.map((option, i) => {
          const selected = chosen.has(option.id)
          const status = gradedOptionStatusKey(revealed, selected, Boolean(option.isCorrect))
          return (
            <button
              key={option.id}
              type="button"
              role="checkbox"
              data-quiz-option
              aria-checked={selected}
              disabled={disabled}
              onClick={() => toggle(option.id)}
              className={optionRowClass({
                selected,
                correct: Boolean(revealed && option.isCorrect),
                wrong: Boolean(revealed && selected && !option.isCorrect),
              })}
            >
              <span aria-hidden className={optionKeyClass(selected && !revealed, true)}>
                {revealed && option.isCorrect ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : revealed && selected ? (
                  <X className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  optionLetter(i)
                )}
              </span>
              <span className="min-w-0 break-words">{option.label}</span>
              {status && <span className="sr-only">{` (${t(status)})`}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** B-type: one shared option per stem. Value: option ids per stem joined by ",". */
export function MatchingInput({
  question,
  value,
  onChange,
  disabled,
  revealed,
}: InputProps): JSX.Element {
  const { t } = useTranslation()
  const options = question.options ?? []
  const items = question.matchItems ?? []
  const picks = items.map((_, i) => value.split(',')[i] ?? '')
  const expected = question.correctAnswer.split(' | ')
  const pick = (item: number, id: string) => {
    const next = [...picks]
    next[item] = id
    onChange(next.join(','))
  }
  return (
    <div className="space-y-3">
      <ol
        className="space-y-1 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm"
        aria-label={t('answerInput.matchingOptions')}
      >
        {options.map((option, i) => (
          <li key={option.id}>
            <span className="mr-2 font-semibold">{optionLetter(i)}.</span>
            {option.label}
          </li>
        ))}
      </ol>
      {items.map((item, itemIndex) => (
        <div key={itemIndex} className="space-y-1.5">
          <p className="text-sm">
            <span className="mr-1.5 font-medium">{itemIndex + 1}.</span>
            {item}
          </p>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label={t('answerInput.matchingItem', { n: itemIndex + 1 })}
          >
            {options.map((option, i) => {
              const selected = picks[itemIndex] === option.id
              const right = revealed && option.label === expected[itemIndex]
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${optionLetter(i)}. ${option.label}`}
                  disabled={disabled}
                  onClick={() => pick(itemIndex, option.id)}
                  className={cn(
                    'focus-ring grid h-8 w-9 place-items-center rounded-md border text-sm font-semibold transition-[color,background-color,border-color,transform] duration-press ease-out lecture:font-heading lab:font-mono motion-safe:active:scale-[0.97]',
                    selected
                      ? 'border-primary-strong bg-primary-strong text-primary-foreground'
                      : 'border-border/80 hover:bg-accent',
                    right && 'border-emerald-500 ring-2 ring-emerald-500/40',
                    revealed &&
                      selected &&
                      !right &&
                      'border-destructive bg-destructive text-destructive-foreground',
                  )}
                >
                  {optionLetter(i)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Fill-blank: one field per ____ in the prompt. Value: answers joined by newlines. */
export function FillBlankInput({
  question,
  value,
  onChange,
  disabled,
  onSubmit,
}: InputProps & { onSubmit?: () => void }): JSX.Element {
  const { t } = useTranslation()
  const count = question.blanks?.length ?? 1
  const answers = Array.from({ length: count }, (_, i) => value.split('\n')[i] ?? '')
  const set = (i: number, text: string) => {
    const next = [...answers]
    next[i] = text.replace(/\n/g, ' ')
    onChange(next.join('\n'))
  }
  return (
    <div className="space-y-2">
      {answers.map((answer, i) => (
        <label key={i} className="flex items-center gap-2 text-sm">
          <span className="data-num w-12 shrink-0 text-muted-foreground">
            {t('answerInput.blankLabel', { n: i + 1 })}
          </span>
          <Input
            value={answer}
            disabled={disabled}
            onChange={(event) => set(i, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && onSubmit && i === count - 1) {
                event.preventDefault()
                onSubmit()
              }
            }}
            placeholder={t('answerInput.blankPlaceholder')}
          />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">{t('answerInput.fillBlankHint')}</p>
    </div>
  )
}
