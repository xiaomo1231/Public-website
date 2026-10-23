import { useMemo, useState } from 'react'
import { CheckCircle2, Eye, Lightbulb } from 'lucide-react'
import type {
  GuidedBlank,
  GuidedBlankKind,
  GuidedBlankStepProgress,
  GuidedTextStep,
} from '@/entities/homework/guided'
import { stepTextWithAnswers, stepTextWithGaps } from '@/entities/homework/guidedSteps'
import { gradeBlank, stepComplete, type BlankGrade } from '@/services/guidedGrading'
import { blankQuickItems } from '@/services/quickInputs'
import type { MathInputMode } from '@/shared/lib/mathInput'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { RichText } from '@/shared/ui/RichText'
import { MathField } from '@/widgets/mathInput/MathField'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

const FIELD_MODE: Record<GuidedBlankKind, MathInputMode> = {
  expression: 'expression',
  number: 'number',
  quantity: 'quantity',
  chemistry: 'chemistry',
  text: 'text',
  exact: 'text',
}

const KIND_KEYS: Record<GuidedBlankKind, TranslationKey> = {
  expression: 'guided.kind.expression',
  number: 'guided.kind.number',
  quantity: 'guided.kind.quantity',
  chemistry: 'guided.kind.chemistry',
  text: 'guided.kind.text',
  exact: 'guided.kind.exact',
}

// Inside a formula the gap is plain LaTeX (another `$…$` would end it).
const gap = (index: number, insideMath: boolean) =>
  insideMath ? `\\boxed{\\,${index + 1}\\,}` : `$\\boxed{\\,${index + 1}\\,}$`

export interface GuidedBlankPracticeProps {
  steps: GuidedTextStep[]
  progress: GuidedBlankStepProgress[]
  subject?: string
  /** Target language of a language course (its letters for written blanks). */
  language?: string
  onChange: (index: number, next: GuidedBlankStepProgress) => void
}

/** Steps with blanks, one at a time; each blank graded by its kind's local grader. */
export function GuidedBlankPractice({
  steps,
  progress,
  subject,
  language,
  onChange,
}: GuidedBlankPracticeProps): JSX.Element {
  const { t } = useTranslation()
  const active = progress.findIndex((item) => !item.done)
  return (
    <ol className="space-y-4">
      {steps.map((step, index) => {
        const record = progress[index] ?? { values: {} }
        if (active >= 0 && index > active) return null
        return (
          <li key={index} data-guided-step={index + 1}>
            {record.done ? (
              <div className="space-y-1.5 border-l-2 border-border pl-3 lab:border-l">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground lab:font-mono">
                    {t('guided.stepN', { index: index + 1 })}
                    {step.title ? ` · ${step.title}` : ''}
                  </span>
                  <CheckCircle2
                    className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                    aria-label={t('guided.stepDone')}
                  />
                  {record.hintViewed && <Badge variant="outline">{t('guided.badge.hint')}</Badge>}
                  {record.answerViewed && (
                    <Badge variant="outline">{t('guided.badge.answer')}</Badge>
                  )}
                </div>
                <RichText
                  text={stepTextWithAnswers(step)}
                  format="markdown"
                  paragraphClassName="text-[15px] leading-relaxed"
                />
              </div>
            ) : (
              <ActiveBlankStep
                step={step}
                index={index}
                record={record}
                {...(subject ? { subject } : {})}
                {...(language ? { language } : {})}
                onChange={(next) => onChange(index, next)}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function ActiveBlankStep({
  step,
  index,
  record,
  subject,
  language,
  onChange,
}: {
  step: GuidedTextStep
  index: number
  record: GuidedBlankStepProgress
  subject?: string
  language?: string
  onChange: (next: GuidedBlankStepProgress) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [grades, setGrades] = useState<Record<string, BlankGrade> | null>(null)

  const check = (): void => {
    if (step.blanks.length === 0) {
      onChange({ ...record, done: true })
      return
    }
    const next = Object.fromEntries(
      step.blanks.map((blank) => [
        blank.id,
        gradeBlank(blank, record.values[blank.id] ?? '', {
          economics: subject === 'economics',
        }),
      ]),
    )
    setGrades(next)
    if (stepComplete(Object.values(next))) onChange({ ...record, done: true })
  }

  const showAnswer = (): void => {
    onChange({
      ...record,
      values: Object.fromEntries(step.blanks.map((blank) => [blank.id, blank.answer])),
      answerViewed: true,
      done: true,
    })
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 lecture:rounded-none lecture:border-x-0 lecture:border-b-0 lecture:bg-transparent lecture:px-0 lab:rounded-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-heading text-[15px] font-semibold text-foreground lab:font-mono lab:text-[13px]">
          {t('guided.stepN', { index: index + 1 })}
          {step.title ? ` · ${step.title}` : ''}
        </h4>
        <div className="flex flex-wrap gap-2">
          {step.explanation && (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              aria-pressed={Boolean(record.hintViewed)}
              onClick={() => onChange({ ...record, hintViewed: true })}
            >
              <Lightbulb className="h-4 w-4" aria-hidden />
              {t('guided.hint')}
            </Button>
          )}
          {step.blanks.length > 0 && (
            <Button type="button" variant="outline" className="h-11" onClick={showAnswer}>
              <Eye className="h-4 w-4" aria-hidden />
              {t('guided.showStepAnswer')}
            </Button>
          )}
        </div>
      </div>

      <RichText
        text={stepTextWithGaps(step, gap)}
        format="markdown"
        paragraphClassName="text-[15px] leading-relaxed"
      />

      {record.hintViewed && step.explanation && (
        <div className="rounded-lg bg-muted/40 p-3 lab:rounded-sm" data-guided-hint>
          <RichText
            text={step.explanation}
            format="markdown"
            paragraphClassName="text-sm leading-relaxed"
          />
        </div>
      )}

      {step.blanks.length > 0 ? (
        <div className="space-y-3">
          {step.blanks.map((blank, position) => (
            <BlankField
              key={blank.id}
              blank={blank}
              position={position}
              value={record.values[blank.id] ?? ''}
              grade={grades?.[blank.id]}
              {...(subject ? { subject } : {})}
              {...(language ? { language } : {})}
              onChange={(value) => {
                setGrades((previous) => {
                  if (!previous) return previous
                  const { [blank.id]: _dropped, ...rest } = previous
                  return rest
                })
                onChange({ ...record, values: { ...record.values, [blank.id]: value } })
              }}
              onSubmit={check}
            />
          ))}
          <Button type="button" className="h-11" onClick={check}>
            {t('guided.checkBlanks')}
          </Button>
        </div>
      ) : (
        <Button type="button" className="h-11" onClick={check}>
          {t('guided.continue')}
        </Button>
      )}
    </div>
  )
}

const REASON_KEYS: Record<NonNullable<BlankGrade['reason']>, TranslationKey> = {
  'missing-unit': 'guided.blank.missingUnit',
  'wrong-dimension': 'guided.blank.wrongDimension',
  unbalanced: 'guided.blank.unbalanced',
  species: 'guided.blank.species',
  coefficients: 'guided.blank.coefficients',
  unreadable: 'guided.blank.unreadable',
}

function BlankField({
  blank,
  position,
  value,
  grade,
  subject,
  language,
  onChange,
  onSubmit,
}: {
  blank: GuidedBlank
  position: number
  value: string
  grade: BlankGrade | undefined
  subject?: string
  language?: string
  onChange: (value: string) => void
  onSubmit: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const id = `guided-blank-${blank.id}`
  // Only what this blank needs: its variables / units / equation arrows.
  const quickItems = useMemo(
    () => blankQuickItems(blank, subject, language),
    [blank, subject, language],
  )
  return (
    <div className="space-y-1.5" data-blank-kind={blank.kind}>
      <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {t('guided.blankLabel', { index: position + 1 })}
        <span className="text-xs font-normal text-muted-foreground">
          {t(KIND_KEYS[blank.kind])}
        </span>
      </label>
      <MathField
        id={id}
        mode={FIELD_MODE[blank.kind]}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        {...(subject ? { subject } : {})}
        {...(language ? { language } : {})}
        quickItems={quickItems}
        inputClassName="h-11 text-[15px]"
        aria-label={t('guided.blankLabel', { index: position + 1 })}
      />
      {grade && grade.verdict !== 'empty' && (
        <p
          role={grade.verdict === 'wrong' ? 'alert' : 'status'}
          className={cn(
            'text-sm',
            grade.verdict === 'correct' && 'text-emerald-700 dark:text-emerald-300',
            grade.verdict === 'wrong' && 'text-destructive',
            grade.verdict === 'unverified' && 'text-muted-foreground',
          )}
        >
          {grade.verdict === 'correct'
            ? t('guided.blank.correct')
            : grade.verdict === 'unverified'
              ? t('guided.blank.unverified')
              : grade.reason
                ? t(REASON_KEYS[grade.reason])
                : t('guided.blank.wrong')}
        </p>
      )}
      {grade?.verdict === 'empty' && (
        <p className="text-sm text-muted-foreground">{t('guided.blank.empty')}</p>
      )}
    </div>
  )
}
