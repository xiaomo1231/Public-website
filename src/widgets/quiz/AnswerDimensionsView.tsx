import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import type { AnswerDimensions } from '@/entities/question/answerDimensions'
import { sigFigOutcomeText, sigFigRuleText } from '@/services/answerDimensionsFeedback'
import { useTranslation } from '@/i18n'

type Tone = 'ok' | 'bad' | 'unknown'

function figures(given: { min: number; max: number } | undefined): string {
  if (!given) return '?'
  return given.min === given.max ? String(given.min) : `${given.min}–${given.max}`
}

/**
 * Value · unit · significant figures, each with its own verdict, and the
 * course's significant-figure rule with its source (教授规则 / 平台拟定规则).
 * Renders nothing for answers that were not judged on these dimensions.
 */
export function AnswerDimensionsView({
  evaluation,
}: {
  evaluation: Pick<QuestionEvaluation, 'dimensions' | 'sigFigRule'>
}): JSX.Element | null {
  const { t } = useTranslation()
  const dimensions = evaluation.dimensions
  if (!dimensions) return null
  const rows: Array<{ label: string; tone: Tone; text: string }> = []
  rows.push({
    label: t('answerDims.row.value'),
    tone: dimensions.value === 'correct' ? 'ok' : dimensions.value === 'wrong' ? 'bad' : 'unknown',
    text: t(
      dimensions.value === 'correct'
        ? 'answerDims.status.correct'
        : dimensions.value === 'wrong'
          ? 'answerDims.status.wrong'
          : 'answerDims.status.unreadable',
    ),
  })
  if (dimensions.unit) rows.push(unitRow(dimensions.unit, t))
  if (dimensions.sigFigs) rows.push(sigFigRow(dimensions.sigFigs, t))
  const rule = evaluation.sigFigRule
  const slipped =
    dimensions.sigFigs?.status === 'too-many' || dimensions.sigFigs?.status === 'too-few'
  return (
    <div className="space-y-1 text-xs" data-answer-dimensions>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-1.5">
            {row.tone === 'ok' ? (
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-emerald-600" />
            ) : row.tone === 'bad' ? (
              <XCircle aria-hidden className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <AlertCircle aria-hidden className="h-3.5 w-3.5 text-amber-600" />
            )}
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium">{row.text}</span>
          </li>
        ))}
      </ul>
      {rule && (
        <p className="text-muted-foreground" data-sig-fig-rule={rule.source}>
          {sigFigRuleText(rule)}
          {slipped && dimensions.value === 'correct' ? ` · ${sigFigOutcomeText(rule)}` : ''}
        </p>
      )}
    </div>
  )
}

function unitRow(
  unit: NonNullable<AnswerDimensions['unit']>,
  t: ReturnType<typeof useTranslation>['t'],
): { label: string; tone: Tone; text: string } {
  const label = t('answerDims.row.unit')
  switch (unit.status) {
    case 'correct':
      return {
        label,
        tone: 'ok',
        text:
          unit.converted && unit.given
            ? t('answerDims.status.unitConverted', { given: unit.given })
            : t('answerDims.status.correct'),
      }
    case 'missing':
      return { label, tone: 'bad', text: t('answerDims.status.unitMissing') }
    case 'wrong-dimension':
      return { label, tone: 'bad', text: t('answerDims.status.unitWrongDimension') }
    case 'wrong-unit':
      return { label, tone: 'bad', text: t('answerDims.status.unitWrongUnit') }
    default:
      return { label, tone: 'unknown', text: t('answerDims.status.unreadable') }
  }
}

function sigFigRow(
  sigFigs: NonNullable<AnswerDimensions['sigFigs']>,
  t: ReturnType<typeof useTranslation>['t'],
): { label: string; tone: Tone; text: string } {
  const label = t('answerDims.row.sigFigs')
  if (sigFigs.status === 'correct')
    return {
      label,
      tone: 'ok',
      text: sigFigs.ambiguous
        ? t('answerDims.status.sigFigsAmbiguous', { required: sigFigs.required })
        : t('answerDims.status.sigFigsOk', { required: sigFigs.required }),
    }
  if (sigFigs.status === 'unreadable')
    return { label, tone: 'unknown', text: t('answerDims.status.unreadable') }
  return {
    label,
    tone: 'bad',
    text: t('answerDims.status.sigFigsMismatch', {
      required: sigFigs.required,
      given: figures(sigFigs.given),
    }),
  }
}
