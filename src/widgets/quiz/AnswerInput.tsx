import { targetLanguageOf } from '@/shared/lib/language'
import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { optionLetter, type Question } from '@/entities/question/types'
import { Textarea } from '@/shared/ui/Textarea'
import { cn } from '@/shared/lib/utils'
import { useProject } from '@/features/project/useProjects'
import { MathField } from '@/widgets/mathInput/MathField'
import { expressionQuickItems } from '@/services/quickInputs'
import { OrderingInput } from './OrderingInput'
import { FillBlankInput, MatchingInput, MultipleSelectInput } from './ExamFormatInputs'
import { ArticleGenderInput, ParadigmTableInput } from './LanguageDrillInputs'
import { ForceListInput, NomenclatureInput, VectorInput } from './ScienceAnswerInputs'
import {
  gradedOptionStatusKey,
  optionKeyClass,
  optionListClass,
  optionRowClass,
} from './optionStyles'
import { useTranslation, type TranslationKey } from '@/i18n'

export interface AnswerInputProps {
  question: Question
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** When true, show which option was correct (used after grading). */
  revealed?: boolean
  /** Enter (Ctrl+Enter in multi-line fields) submits the answer. */
  onSubmit?: () => void
}

export function AnswerInput({
  question,
  value,
  onChange,
  disabled,
  revealed,
  onSubmit,
}: AnswerInputProps): JSX.Element {
  const { t } = useTranslation()
  const { project } = useProject(question.projectId)
  const subject = project?.subject
  const language = targetLanguageOf(project)
  if (question.type === 'multiple_choice') {
    return (
      <MultipleChoiceInput
        question={question}
        value={value}
        onChange={onChange}
        disabled={disabled}
        revealed={revealed}
      />
    )
  }
  if (question.type === 'true_false') {
    return (
      <TrueFalseInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        revealed={revealed}
        correctAnswer={question.correctAnswer}
      />
    )
  }
  if (question.type === 'numeric' && question.unit) {
    // A physical quantity: the unit is part of the answer, so it is typed
    // with the value (and never shown here — choosing it is the task).
    return (
      <div className="space-y-1">
        <MathField
          mode="quantity"
          subject={subject}
          language={language}
          value={value}
          onChange={onChange}
          placeholder={t('answerInput.quantityPlaceholder')}
          disabled={disabled}
          {...(onSubmit ? { onSubmit } : {})}
        />
        <p className="text-xs text-muted-foreground">{t('answerInput.quantityHint')}</p>
      </div>
    )
  }
  if (question.type === 'vector') {
    return (
      <VectorInput
        question={question}
        value={value}
        onChange={onChange}
        disabled={disabled}
        {...(subject ? { subject } : {})}
        {...(onSubmit ? { onSubmit } : {})}
      />
    )
  }
  if (question.type === 'nomenclature') {
    return (
      <NomenclatureInput
        question={question}
        value={value}
        onChange={onChange}
        disabled={disabled}
        {...(subject ? { subject } : {})}
        {...(onSubmit ? { onSubmit } : {})}
      />
    )
  }
  if (question.type === 'force_list') {
    return (
      <ForceListInput question={question} value={value} onChange={onChange} disabled={disabled} />
    )
  }
  if (question.type === 'code_output') {
    return (
      <div className="space-y-1">
        <Textarea
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('answerInput.codeOutputPlaceholder')}
          disabled={disabled}
          spellCheck={false}
          className="font-mono text-[13px]"
        />
        <p className="text-xs text-muted-foreground">{t('answerInput.codeOutputHint')}</p>
      </div>
    )
  }
  if (question.type === 'multiple_select') {
    return (
      <MultipleSelectInput
        question={question}
        value={value}
        onChange={onChange}
        disabled={disabled}
        revealed={revealed}
      />
    )
  }
  if (question.type === 'matching') {
    return (
      <MatchingInput
        question={question}
        value={value}
        onChange={onChange}
        disabled={disabled}
        revealed={revealed}
      />
    )
  }
  if (question.type === 'fill_blank') {
    return (
      <FillBlankInput
        question={question}
        value={value}
        onChange={onChange}
        disabled={disabled}
        language={language}
        {...(onSubmit ? { onSubmit } : {})}
      />
    )
  }
  if (question.type === 'article_gender') {
    return (
      <ArticleGenderInput
        question={question}
        value={value}
        onChange={onChange}
        disabled={disabled}
        revealed={revealed}
        {...(onSubmit ? { onSubmit } : {})}
      />
    )
  }
  if (question.type === 'paradigm_table') {
    return (
      <ParadigmTableInput
        question={question}
        value={value}
        onChange={onChange}
        disabled={disabled}
        revealed={revealed}
        language={language}
        {...(onSubmit ? { onSubmit } : {})}
      />
    )
  }
  if (question.type === 'ordering') {
    return (
      <OrderingInput question={question} value={value} onChange={onChange} disabled={disabled} />
    )
  }
  if (question.type === 'chem_equation') {
    return (
      <div className="space-y-1">
        <MathField
          mode="chemistry"
          subject={subject}
          language={language}
          value={value}
          onChange={onChange}
          placeholder={t('answerInput.chemEquationPlaceholder')}
          disabled={disabled}
          {...(onSubmit ? { onSubmit } : {})}
        />
        <p className="text-xs text-muted-foreground">{t('answerInput.chemEquationHint')}</p>
      </div>
    )
  }
  if (question.type === 'short_answer') {
    const characters = value.replace(/\s+/g, '').length
    return (
      <div className="space-y-1">
        <MathField
          mode="text"
          multiline
          rows={6}
          subject={subject}
          language={language}
          value={value}
          onChange={onChange}
          placeholder={t('answerInput.shortAnswerPlaceholder')}
          disabled={disabled}
          {...(onSubmit ? { onSubmit } : {})}
        />
        <p className="data-num text-right text-xs text-muted-foreground">
          {t('answerInput.charCount', { count: characters })}
        </p>
      </div>
    )
  }
  if (question.type === 'numeric') {
    return (
      <MathField
        mode="number"
        subject={subject}
        language={language}
        value={value}
        onChange={onChange}
        placeholder={t('answerInput.numberPlaceholder')}
        disabled={disabled}
        {...(onSubmit ? { onSubmit } : {})}
      />
    )
  }
  if (question.type === 'math_expr') {
    return (
      <div className="space-y-1">
        <MathField
          mode="expression"
          subject={subject}
          language={language}
          value={value}
          onChange={onChange}
          // The answer's variables and the common templates, always visible.
          quickItems={expressionQuickItems(question.correctAnswer)}
          placeholder={t('answerInput.expressionPlaceholder')}
          disabled={disabled}
          {...(onSubmit ? { onSubmit } : {})}
        />
        <p className="text-xs text-muted-foreground">
          {t('answerInput.expressionHint', { power: '^', multiply: '*' })}
        </p>
      </div>
    )
  }
  return (
    <MathField
      mode="text"
      subject={subject}
      language={language}
      multiline
      value={value}
      onChange={onChange}
      placeholder={t('answerInput.textPlaceholder')}
      disabled={disabled}
      {...(onSubmit ? { onSubmit } : {})}
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
  const { t } = useTranslation()
  const options = question.options ?? []
  return (
    <div className={optionListClass}>
      {options.map((option, i) => {
        const selected = value === option.id || value === option.label
        const isCorrect =
          option.id === question.correctAnswer || option.label === question.correctAnswer
        const status = gradedOptionStatusKey(revealed, selected, isCorrect)
        return (
          <button
            key={option.id}
            type="button"
            data-quiz-option
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={optionRowClass({
              selected,
              correct: Boolean(revealed && isCorrect),
              wrong: Boolean(revealed && selected && !isCorrect),
            })}
          >
            <span aria-hidden className={optionKeyClass(Boolean(selected && !revealed))}>
              {revealed && isCorrect ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : revealed && selected && !isCorrect ? (
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
    <div className="flex gap-2 lecture:gap-2.5 lab:gap-0">
      {options.map((o) => {
        const selected = local.toLowerCase() === o.value.toLowerCase()
        const isCorrect = revealed && correct === o.bool
        const status = gradedOptionStatusKey(revealed, selected, correct === o.bool)
        return (
          <button
            key={o.value}
            type="button"
            data-quiz-option
            disabled={disabled}
            onClick={() => {
              setLocal(o.value)
              onChange(o.value)
            }}
            aria-pressed={selected}
            className={cn(
              optionRowClass({
                selected,
                correct: Boolean(isCorrect),
                wrong: Boolean(revealed && selected && !isCorrect),
              }),
              'flex-1 justify-center lab:-ml-px lab:mt-0 lab:first:ml-0',
            )}
          >
            {t(o.labelKey)}
            {status && <span className="sr-only">{` (${t(status)})`}</span>}
          </button>
        )
      })}
    </div>
  )
}
