import { Link } from 'react-router-dom'
import { Badge } from '@/shared/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { RichText } from '@/shared/ui/RichText'
import type { MockExamAttempt, MockExamQuestionResult } from '@/entities/exam/types'
import { scoreMockExam } from '@/entities/exam/scoring'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import type { MockExamState } from '@/services/mockExamService'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'

const STATUS_KEYS: Record<string, TranslationKey> = {
  correct: 'mockExam.verdict.correct',
  partial: 'mockExam.verdict.partial',
  incorrect: 'mockExam.verdict.incorrect',
  uncertain: 'mockExam.verdict.uncertain',
  unanswered: 'mockExam.verdict.unanswered',
  failed: 'mockExam.verdict.failed',
}

function statusKey(result: MockExamQuestionResult | undefined): TranslationKey | null {
  if (!result) return null
  if (result.status === 'checked' && result.verdict) return STATUS_KEYS[result.verdict] ?? null
  return STATUS_KEYS[result.status] ?? null
}

/**
 * A checked mock exam. Two things are kept strictly apart:
 *   - 教授评分标准: marks printed on the paper and the marking-scheme lines of
 *     the professor's answer key, shown verbatim;
 *   - 平台估计: what the platform estimates the answer earned (local check or
 *     AI reading). Never presented as the teacher's marks.
 */
export function MockExamResults({
  projectId,
  state,
  attempt,
}: {
  projectId: string
  state: MockExamState
  attempt: MockExamAttempt
}): JSX.Element {
  const { t } = useTranslation()
  const results = new Map((attempt.results ?? []).map((item) => [item.questionId, item]))
  const ordered = state.questions.flatMap((view) => {
    const result = results.get(view.question.id)
    return result ? [result] : []
  })
  const score = scoreMockExam(ordered)
  const complete = ordered.length === state.questions.length

  return (
    <div className="space-y-4" data-mock-exam-results>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('mockExam.resultTitle')}</CardTitle>
          <CardDescription>
            {attempt.timedOut ? t('mockExam.timedOut') : t('mockExam.submitted')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="font-medium" data-platform-estimate>
            {t('mockExam.platformEstimate')}
            {': '}
            {score.marks
              ? t('mockExam.estimateMarks', {
                  earned: score.marks.estimated,
                  available: score.marks.available,
                })
              : score.fraction !== null
                ? t('mockExam.estimatePercent', { percent: Math.round(score.fraction * 100) })
                : '—'}
          </p>
          <p className="text-xs text-muted-foreground">
            {score.aiChecked ? t('mockExam.estimateAiNote') : t('mockExam.estimateLocalNote')}
          </p>
          {score.undecided > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {score.marks
                ? t('mockExam.undecidedMarks', {
                    count: score.undecided,
                    marks: score.marks.undecidedMarks,
                  })
                : t('mockExam.undecided', { count: score.undecided })}
            </p>
          )}
          {!complete && <p className="text-xs text-muted-foreground">{t('mockExam.incomplete')}</p>}
          <p className="text-xs text-muted-foreground">
            <Link to={`/projects/${projectId}/mistakes`} className="text-primary hover:underline">
              {t('mockExam.mistakesLink')}
            </Link>
          </p>
        </CardContent>
      </Card>

      <ol className="space-y-4">
        {state.questions.map((view, index) => {
          const result = results.get(view.question.id)
          const key = statusKey(result)
          const answer = attempt.answers[view.question.id] ?? ''
          const professor =
            view.question.answerStatus === 'matched' ? view.question.answerText : undefined
          const number = view.question.number ?? String(index + 1)
          return (
            <li key={view.question.id} className="space-y-2 border-b pb-4" data-exam-result>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t('mockExam.questionLabel', { number })}</span>
                {key && <Badge variant="outline">{t(key)}</Badge>}
                {result?.method && (
                  <Badge variant="secondary">
                    {t(result.method === 'ai' ? 'mockExam.methodAi' : 'mockExam.methodLocal')}
                  </Badge>
                )}
              </div>
              <RichText
                text={formatHomeworkQuestion(view.question.prompt)}
                format="markdown"
                className="space-y-2"
                paragraphClassName="text-sm"
              />
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-md border p-2" data-professor-scheme>
                  <dt className="text-xs font-medium">{t('mockExam.professorScheme')}</dt>
                  <dd className="space-y-1 text-xs text-muted-foreground">
                    {view.marks.total !== undefined ? (
                      <p>
                        {t('mockExam.paperStates', { marks: view.marks.total })}
                        {view.marks.parts.length > 0 &&
                          ` (${view.marks.parts
                            .map((part) => `(${part.label}) ${part.marks}`)
                            .join(', ')})`}
                      </p>
                    ) : (
                      <p>{t('mockExam.paperNoMarks')}</p>
                    )}
                    {view.scheme.length > 0 ? (
                      <ul className="list-disc pl-4">
                        {view.scheme.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>{t('mockExam.noScheme')}</p>
                    )}
                  </dd>
                </div>
                <div
                  className="rounded-md border border-dashed p-2"
                  data-platform-question-estimate
                >
                  <dt className="text-xs font-medium">{t('mockExam.platformEstimate')}</dt>
                  <dd className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      {result?.estimatedMarks !== undefined && result.marks !== undefined
                        ? t('mockExam.estimateMarks', {
                            earned: result.estimatedMarks,
                            available: result.marks,
                          })
                        : result?.fraction !== undefined
                          ? t('mockExam.estimatePercent', {
                              percent: Math.round(result.fraction * 100),
                            })
                          : '—'}
                    </p>
                    {result?.note && <p>{result.note}</p>}
                  </dd>
                </div>
              </dl>
              <div className="space-y-1 text-sm">
                <p className="text-xs font-medium">{t('mockExam.yourAnswer')}</p>
                <RichText
                  text={answer.trim() || t('quizResult.blank')}
                  format="markdown"
                  paragraphClassName="text-sm"
                />
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-medium">
                  {professor ? t('mockExam.professorAnswer') : t('mockExam.platformSolution')}
                </summary>
                <RichText
                  text={professor ?? view.question.solution ?? t('mockExam.noReference')}
                  format="markdown"
                  className="mt-2 space-y-2"
                  paragraphClassName="text-sm"
                />
              </details>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
