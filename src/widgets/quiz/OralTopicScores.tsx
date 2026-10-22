import { Mic } from 'lucide-react'
import type { Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import { oralTopicScores } from '@/entities/question/oral'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Progress } from '@/shared/ui/Progress'
import { useTranslation } from '@/i18n'
import { RubricSourceLabel } from '@/shared/ui/RubricSourceLabel'
import { rubricSourceOf } from '@/entities/question/origin'

/**
 * Oral-exam result per drawn topic: scoring points covered over all points of
 * the main question and its follow-ups. Unanswered, unchecked or disputed
 * answers are not scored and are counted separately.
 */
export function OralTopicScores({
  questions,
  attempts,
}: {
  questions: Question[]
  attempts: QuestionAttempt[]
}): JSX.Element | null {
  const { t } = useTranslation()
  const scores = oralTopicScores(questions, attempts)
  if (scores.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base lecture:font-heading">
          <Mic className="h-4 w-4" aria-hidden />
          {t('oral.result.title')}
        </CardTitle>
        <CardDescription>{t('oral.result.hint')}</CardDescription>
        <RubricSourceLabel
          source={rubricSourceOf(questions.find((question) => question.oral)?.rubricSource)}
        />
      </CardHeader>
      <CardContent className="space-y-2 lab:space-y-0">
        {scores.map((score) => (
          <div
            key={score.group}
            className="space-y-1 border-b border-border/70 pb-2 last:border-b-0 last:pb-0 lab:space-y-1.5 lab:border-border lab:py-2.5 lab:first:pt-0"
          >
            <div className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{score.topic}</span>
              <span className="data-num shrink-0 tabular-nums text-muted-foreground lab:font-mono lab:text-xs">
                {score.percentage !== null
                  ? t('oral.topicScore', {
                      earned: score.earned,
                      total: score.total,
                      percent: score.percentage,
                    })
                  : t('oral.notScored')}
              </span>
            </div>
            <Progress value={score.percentage ?? 0} className="h-1.5 lab:h-1 lab:rounded-none" />
            {score.unscored > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('oral.unscored', { count: score.unscored })}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
