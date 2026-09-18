import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { Question } from '@/entities/question/types'
import { Input } from '@/shared/ui/Input'
import { Textarea } from '@/shared/ui/Textarea'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

export interface AnswerInputProps {
  question: Question
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** When true, show which option was correct (used after grading). */
  revealed?: boolean
}

export function AnswerInput({ question, value, onChange, disabled, revealed }: AnswerInputProps): JSX.Element {
  const { t } = useTranslation()
  if (question.type === 'multiple_choice') {
    return <MultipleChoiceInput question={question} value={value} onChange={onChange} disabled={disabled} revealed={revealed} />
  }
  if (question.type === 'true_false') {
    return <TrueFalseInput value={value} onChange={onChange} disabled={disabled} revealed={revealed} correctAnswer={question.correctAnswer} />
  }
  if (question.type === 'numeric') {
    return (
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('answerInput.numberPlaceholder')}
        disabled={disabled}
        className="font-mono"
      />
    )
  }
  if (question.type === 'math_expr') {
    return (
      <div className="space-y-1">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('answerInput.expressionPlaceholder')}
          disabled={disabled}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          {t('answerInput.expressionHint', { power: '^', multiply: '*' })}
        </p>
      </div>
    )
  }
  return (
    <Textarea
      rows={3}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('answerInput.textPlaceholder')}
      disabled={disabled}
    />
  )
}

function MultipleChoiceInput({
  question,
  value,
  onChange,
  disabled,
  revealed,
}: AnswerInputProps): JSX.Element {
  const options = question.options ?? []
  return (
    <div className="space-y-2">
      {options.map((option) => {
        const selected = value === option.id || value === option.label
        const isCorrect = option.id === question.correctAnswer || option.label === question.correctAnswer
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
              selected ? 'border-foreground/40 bg-accent' : 'hover:bg-accent/50',
              revealed && isCorrect && 'border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20',
              revealed && selected && !isCorrect && 'border-destructive/60 bg-destructive/5',
            )}
          >
            <span
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px]',
                selected ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground/40',
              )}
            >
              {revealed && isCorrect ? (
                <Check className="h-3 w-3 text-emerald-600" />
              ) : revealed && selected && !isCorrect ? (
                <X className="h-3 w-3 text-destructive" />
              ) : null}
            </span>
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function TrueFalseInput({
  value,
  onChange,
  disabled,
  revealed,
  correctAnswer,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  revealed?: boolean
  correctAnswer: string
}): JSX.Element {
  const { t } = useTranslation()
  const [local, setLocal] = useState(value)
  useEffect(() => {
    setLocal(value)
  }, [value])
  const correct = correctAnswer.toLowerCase() === 'true' || correctAnswer.toLowerCase() === 'yes'
  const options: Array<{ labelKey: TranslationKey; value: string; bool: boolean }> = [
    { labelKey: 'answerInput.true', value: 'True', bool: true },
    { labelKey: 'answerInput.false', value: 'False', bool: false },
  ]
  return (
    <div className="flex gap-2">
      {options.map((o) => {
        const selected = local.toLowerCase() === o.value.toLowerCase()
        const isCorrect = revealed && correct === o.bool
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => {
              setLocal(o.value)
              onChange(o.value)
            }}
            className={cn(
              'flex-1 rounded-md border px-4 py-2 text-sm transition-colors',
              selected ? 'border-foreground/40 bg-accent' : 'hover:bg-accent/50',
              isCorrect && 'border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20',
              revealed && selected && !isCorrect && 'border-destructive/60 bg-destructive/5',
            )}
          >
            {t(o.labelKey)}
          </button>
        )
      })}
    </div>
  )
}