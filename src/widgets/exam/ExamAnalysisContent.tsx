import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ErrorState } from '@/shared/ui/ErrorState'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { withExamReturn } from '@/features/studyPlan/examReturn'
import { MockExamService } from '@/services/mockExamService'
import type { PastExamAnalysis } from '@/entities/exam/analysis'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'

const KIND_KEYS: Record<string, TranslationKey> = {
  multiple_choice: 'examAnalysis.kind.multiple_choice',
  true_false: 'examAnalysis.kind.true_false',
  fill_blank: 'examAnalysis.kind.fill_blank',
  calculation: 'examAnalysis.kind.calculation',
  proof: 'examAnalysis.kind.proof',
  explain: 'examAnalysis.kind.explain',
  other: 'examAnalysis.kind.other',
}

/**
 * 题型与覆盖分析: local statistics over the course's past papers (or the ones
 * picked for an exam) — question kinds, marks per course topic, and which
 * exam-scope topics the papers touched. It only describes past papers; it
 * never predicts the next exam.
 */
export function ExamAnalysisContent({
  projectId,
  setIds,
  fromExam,
}: {
  projectId: string
  /** Only these past papers (an exam's picked papers); absent = all. */
  setIds?: string[]
  /** Opened inside a 考试工作台: lesson links return there. */
  fromExam?: string | null
}): JSX.Element {
  const { t } = useTranslation()
  const homework = useHomeworkService()
  const service = useMemo(() => (homework ? new MockExamService({ homework }) : null), [homework])
  const [analysis, setAnalysis] = useState<PastExamAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setKey = setIds?.join(',') ?? ''

  useEffect(() => {
    if (!service || !projectId) return
    let alive = true
    void service
      .analysis(projectId, setKey ? { setIds: setKey.split(',') } : {})
      .then((result) => {
        if (alive) setAnalysis(result)
      })
      .catch((err) => {
        if (alive) setError(friendlyAIError(err))
      })
    return () => {
      alive = false
    }
  }, [service, projectId, setKey])

  const marksKnown = (analysis?.totalMarks ?? 0) > 0
  return (
    <div className="space-y-5" data-exam-analysis>
      <p
        className="rounded-md border border-amber-500/40 bg-amber-50/50 px-3 py-2 text-sm lab:rounded-none dark:bg-amber-950/20"
        data-exam-disclaimer
      >
        {t('examAnalysis.disclaimer')}
      </p>
      {error ? (
        <ErrorState title={t('examAnalysis.title')} description={error} />
      ) : !analysis ? (
        <LoadingState label={t('common.loading')} />
      ) : analysis.papers === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-10 w-10" />}
          title={t('examAnalysis.empty')}
          description={t('examAnalysis.emptyHint')}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t('examAnalysis.summary', {
              papers: analysis.papers,
              questions: analysis.questions,
            })}
            {marksKnown
              ? ` · ${t('examAnalysis.marksSummary', {
                  marked: analysis.questionsWithMarks,
                  marks: analysis.totalMarks,
                })}`
              : ` · ${t('examAnalysis.noMarks')}`}
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('examAnalysis.kinds')}</CardTitle>
              <CardDescription>{t('examAnalysis.kindsHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-1">
                      {t('examAnalysis.kind')}
                    </th>
                    <th scope="col">{t('examAnalysis.questions')}</th>
                    {marksKnown && <th scope="col">{t('examAnalysis.marks')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {analysis.byKind.map((row) => (
                    <tr key={row.kind} className="border-t">
                      <td className="py-1">{t(KIND_KEYS[row.kind]!)}</td>
                      <td>{row.questions}</td>
                      {marksKnown && <td>{row.marks}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('examAnalysis.topics')}</CardTitle>
              <CardDescription>{t('examAnalysis.topicsHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {analysis.byTopic.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('examAnalysis.noTopics')}</p>
              ) : (
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-1">
                        {t('examAnalysis.topic')}
                      </th>
                      <th scope="col">{t('examAnalysis.questions')}</th>
                      {marksKnown && <th scope="col">{t('examAnalysis.marks')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.byTopic.map((row) => (
                      <tr key={row.topicId} className="border-t">
                        <td className="py-1">
                          <Link
                            to={withExamReturn(
                              `/projects/${projectId}/tutor/${row.topicId}`,
                              fromExam,
                            )}
                            className="hover:underline"
                          >
                            {row.name}
                          </Link>
                        </td>
                        <td>{row.questions}</td>
                        {marksKnown && <td>{row.marks}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {analysis.unmatched.questions > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('examAnalysis.unmatched', {
                    count: analysis.unmatched.questions,
                    marks: analysis.unmatched.marks,
                  })}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('examAnalysis.scope')}</CardTitle>
              <CardDescription>{t('examAnalysis.scopeHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {analysis.scopes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('examAnalysis.noScope')}</p>
              ) : (
                analysis.scopes.map((scope) => (
                  <section key={scope.scopeId} className="space-y-1">
                    <h3 className="text-sm font-medium">
                      {scope.label}{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        {t('examAnalysis.scopeCount', {
                          covered: scope.covered.length,
                          total: scope.covered.length + scope.notSeen.length,
                        })}
                      </span>
                    </h3>
                    <ul className="space-y-0.5 text-sm">
                      {scope.covered.map((item) => (
                        <li key={item.id}>
                          ✓ {item.text}{' '}
                          <span className="text-xs text-muted-foreground">
                            {t('examAnalysis.seenIn', { count: item.questions })}
                          </span>
                        </li>
                      ))}
                      {scope.notSeen.map((item) => (
                        <li key={item.id} className="text-muted-foreground">
                          · {item.text} <span className="text-xs">{t('examAnalysis.notSeen')}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
