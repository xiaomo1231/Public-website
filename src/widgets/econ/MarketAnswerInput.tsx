import type { MarketQuestion } from '@/entities/econ/graphQuestion'
import type { PracticeGrader } from '@/entities/homework/practice/types'
import { readPartAnswers, writePartAnswer, type PartLike } from '@/entities/econ/partAnswers'
import { useTranslation } from '@/i18n'
import { MathField } from '@/widgets/mathInput/MathField'
import { MarketDrawInput } from './MarketDrawInput'
import { MarketQuestionFigure } from './MarketQuestionFigure'
import { ShiftIdInput } from './ShiftIdInput'

/** The answer control of one graph question (segmented choices, a number, or the drawing). */
export function MarketAnswerInput({
  question,
  value,
  onChange,
  disabled,
  onSubmit,
}: {
  question: MarketQuestion
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  onSubmit?: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  switch (question.kind) {
    case 'shift_id':
      return <ShiftIdInput value={value} onChange={onChange} disabled={disabled} />
    case 'draw_diagram':
      return (
        <MarketDrawInput
          question={question}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )
    case 'area_read':
      return (
        <div className="space-y-1">
          <MathField
            mode="number"
            subject="economics"
            value={value}
            onChange={onChange}
            disabled={disabled}
            {...(onSubmit ? { onSubmit } : {})}
          />
          <p className="text-xs text-muted-foreground">{t('marketQ.input.valueHint')}</p>
        </div>
      )
  }
}

/**
 * The graph parts of a practice / mock-exam / variant question: the shared
 * figure once, then each graph part's control. The answers are written into
 * the question's draft (`(a) …`), next to whatever is typed for other parts.
 */
export function MarketPartsAnswer({
  parts,
  value,
  onChange,
  disabled,
  showFigure = true,
}: {
  parts: readonly PartLike[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  showFigure?: boolean
}): JSX.Element | null {
  const labels = parts.map((part) => part.label)
  const answers = readPartAnswers(value, labels)
  const graphs = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.grader.kind === 'market')
  if (graphs.length === 0) return null
  const first = graphs[0]!.part.grader as Extract<PracticeGrader, { kind: 'market' }>
  return (
    <div className="space-y-4" data-market-parts>
      {showFigure && <MarketQuestionFigure figure={first.question.figure} />}
      {graphs.map(({ part, index }) => {
        const grader = part.grader as Extract<PracticeGrader, { kind: 'market' }>
        return (
          <div key={index} className="space-y-1.5" data-market-part={part.label ?? ''}>
            {part.label && <p className="text-sm font-medium">({part.label})</p>}
            <MarketAnswerInput
              question={grader.question}
              value={answers[index] ?? ''}
              onChange={(next) => onChange(writePartAnswer(value, labels, index, next))}
              disabled={disabled}
            />
          </div>
        )
      })}
    </div>
  )
}
