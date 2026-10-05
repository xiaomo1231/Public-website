import { CheckCircle2, Circle, Flag, Loader2, XCircle } from 'lucide-react'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import { Button } from '@/shared/ui/Button'
import { RichText } from '@/shared/ui/RichText'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export interface ShortAnswerFeedbackProps {
  evaluation: QuestionEvaluation
  /** Offered only for an AI judgement that has not been disputed yet. */
  onDispute?: () => void
  disputing?: boolean
}

/**
 * The scoring-point view of a short answer: score as covered / total and a
 * percentage, each point with the student's own words as evidence, any
 * statements that disagree with the reference, the reference answer, and a
 * way to dispute the judgement.
 */
export function ShortAnswerFeedback({
  evaluation,
  onDispute,
  disputing,
}: ShortAnswerFeedbackProps): JSX.Element {
  const { t } = useTranslation()
  const graded = evaluation.method === 'rubric_ai'
  const score = evaluation.score
  const percent = score && score.total > 0 ? Math.round((score.earned / score.total) * 100) : 0
  const full = score !== undefined && score.total > 0 && score.earned === score.total

  return (
    <div className="space-y-3 rounded-lg border border-border/80 bg-card p-3 text-sm">
      {graded && score ? (
        <div className="flex flex-wrap items-center gap-2">
          {full ? (
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="data-num font-semibold">
            {t('shortAnswer.score', { earned: score.earned, total: score.total, percent })}
          </span>
          <span
            aria-hidden
            className="ml-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted"
          >
            <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </span>
        </div>
      ) : null}
      {evaluation.note && <p className="text-xs text-muted-foreground">{evaluation.note}</p>}

      {evaluation.rubric && evaluation.rubric.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{t('shortAnswer.points')}</p>
          <ul className="space-y-2">
            {evaluation.rubric.map((point) => (
              <li key={point.pointId} className="flex gap-2">
                {graded ? (
                  point.covered ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label={t('shortAnswer.covered')} />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label={t('shortAnswer.missing')} />
                  )
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 space-y-0.5">
                  <p className={cn(graded && !point.covered && 'text-muted-foreground')}>{point.text}</p>
                  {point.evidence && (
                    <p className="break-words text-xs text-muted-foreground">
                      {t('shortAnswer.evidence', { text: point.evidence })}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.contradictions && evaluation.contradictions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('shortAnswer.contradictions')}</p>
          <ul className="ml-4 list-disc space-y-0.5 text-xs">
            {evaluation.contradictions.map((item) => (
              <li key={item} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {evaluation.explanation && <p className="leading-relaxed">{evaluation.explanation}</p>}

      {evaluation.expected && (
        <div className="space-y-1 border-t border-border/70 pt-2">
          <p className="text-xs font-medium text-muted-foreground">{t('shortAnswer.reference')}</p>
          <RichText text={evaluation.expected} format="markdown" paragraphClassName="text-sm leading-relaxed" />
        </div>
      )}

      {graded &&
        (evaluation.disputed ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t('shortAnswer.disputed')}
          </p>
        ) : onDispute ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDispute} disabled={disputing}>
            {disputing ? <Loader2 className="animate-spin" /> : <Flag />}
            {t('shortAnswer.dispute')}
          </Button>
        ) : null)}
    </div>
  )
}
