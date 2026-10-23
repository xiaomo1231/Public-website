import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, ListChecks, Sparkles, Timer } from 'lucide-react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import type { ExamAiMockRow, ExamPaperRow, ExamWorkspaceView } from '@/services/studyPlanService'
import { useStudyPlanService } from '@/features/studyPlan/useStudyPlan'
import { useAiMockService } from '@/features/exam/useAiMockService'
import { AiMockDialog } from '@/widgets/exam/aiMock/AiMockDialog'
import { AiMockRows } from '@/widgets/exam/aiMock/AiMockRows'
import { ExamAnalysisContent } from '@/widgets/exam/ExamAnalysisContent'
import { useTranslation } from '@/i18n'
import { fromWorkspace } from './examLinks'
import { TabSection } from './TabSection'

/**
 * 考题: the past papers (picked for this exam first) with their professor
 * answers and 校对 status, mock exam / per-question practice / proofreading /
 * an AI 模拟卷 in a paper's style, the AI 模拟卷 written for this exam with
 * their results, and the 题型与覆盖分析 of the exam's papers.
 */
export function PapersTab({
  view,
  onChanged,
}: {
  view: ExamWorkspaceView
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const service = useStudyPlanService()
  const aiMockService = useAiMockService()
  const { exam } = view.context
  const [data, setData] = useState<{ papers: ExamPaperRow[]; aiMocks: ExamAiMockRow[] } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ templateSetId?: string; setId?: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await service.examPapers(exam.id))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [service, exam.id])
  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorState title={t('examWorkspace.tab.papers')} description={error} />
  if (!data) return <LoadingState label={t('common.loading')} />

  const picked = data.papers.filter((row) => row.picked)
  const analysisIds = picked.length > 0 ? picked.map((row) => row.set.id) : undefined
  const percents = new Map(data.aiMocks.map((row) => [row.set.id, row.lastPercent]))
  const pid = exam.projectId

  return (
    <div className="space-y-10" data-workspace-papers>
      <TabSection
        title={t('examWorkspace.papersTitle')}
        action={
          <Button asChild size="sm" variant="ghost">
            <Link to={`/projects/${pid}/homework`}>{t('examWorkspace.openHomework')}</Link>
          </Button>
        }
      >
        {data.papers.length === 0 ? (
          <EmptyState
            title={t('examWorkspace.papersNone')}
            description={t('examWorkspace.papersNoneHint')}
          />
        ) : (
          <ul className="divide-y rounded-md border lab:rounded-none">
            {data.papers.map((row) => {
              const ready = row.set.status === 'ready'
              return (
                <li
                  key={row.set.id}
                  className="space-y-2 px-3 py-3"
                  data-paper-row={row.set.id}
                  data-paper-picked={row.picked}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <TruncatedText
                      text={row.set.title}
                      className="min-w-0 max-w-full flex-1 text-sm font-medium"
                    />
                    {row.picked && <Badge>{t('examWorkspace.pickedBadge')}</Badge>}
                    {row.lastPercent !== undefined && (
                      <Badge variant="outline" data-paper-score>
                        {t('examWorkspace.lastScore', { percent: row.lastPercent })}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {t('homework.questionsCount', { count: row.questions })}
                    {' · '}
                    {row.set.answerDocumentId
                      ? t('examWorkspace.answersPaired', {
                          matched: row.answered,
                          total: row.questions,
                        })
                      : t('examWorkspace.answersNone')}
                    {' · '}
                    {t('examWorkspace.proofread', { done: row.verified, total: row.questions })}
                    {row.attempts > 0 &&
                      ` · ${t('examWorkspace.attempts', { count: row.attempts })}`}
                  </p>
                  {ready ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button asChild size="sm">
                        <Link
                          to={fromWorkspace(exam, `/projects/${pid}/homework/${row.set.id}/exam`)}
                        >
                          <Timer className="h-4 w-4" aria-hidden />
                          {t('mockExam.start')}
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link to={fromWorkspace(exam, `/projects/${pid}/homework/${row.set.id}`)}>
                          <ListChecks className="h-4 w-4" aria-hidden />
                          {t('mockExam.openPractice')}
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link
                          to={fromWorkspace(
                            exam,
                            `/projects/${pid}/homework/${row.set.id}?view=proofread`,
                          )}
                        >
                          <ClipboardCheck className="h-4 w-4" aria-hidden />
                          {t('examWorkspace.proofreadOpen')}
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!aiMockService}
                        onClick={() => setDialog({ templateSetId: row.set.id })}
                        data-paper-ai-mock
                      >
                        <Sparkles className="h-4 w-4" aria-hidden />
                        {t('aiMock.generateFrom')}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('examWorkspace.paperNotReady')}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </TabSection>

      <TabSection
        title={t('examWorkspace.aiMocksTitle')}
        action={
          data.papers.some((row) => row.set.status === 'ready') && (
            <Button
              size="sm"
              variant="outline"
              disabled={!aiMockService}
              onClick={() => setDialog({})}
              data-workspace-ai-mock
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {t('aiMock.generate')}
            </Button>
          )
        }
      >
        {data.aiMocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('examWorkspace.aiMocksNone')}</p>
        ) : (
          <AiMockRows
            projectId={pid}
            sets={data.aiMocks.map((row) => row.set)}
            service={aiMockService}
            fromExam={exam.id}
            percentOf={(setId) => percents.get(setId)}
            onOpen={(setId) => setDialog({ setId })}
            onChanged={() => {
              void load()
              onChanged()
            }}
          />
        )}
      </TabSection>

      <TabSection title={t('examAnalysis.title')}>
        <ExamAnalysisContent
          projectId={pid}
          fromExam={exam.id}
          {...(analysisIds ? { setIds: analysisIds } : {})}
        />
      </TabSection>

      {dialog && aiMockService && (
        <AiMockDialog
          key={dialog.setId ?? dialog.templateSetId ?? 'new'}
          projectId={pid}
          service={aiMockService}
          open
          examId={exam.id}
          {...(dialog.templateSetId ? { templateSetId: dialog.templateSetId } : {})}
          {...(dialog.setId ? { setId: dialog.setId } : {})}
          onOpenChange={(open) => {
            if (!open) {
              setDialog(null)
              void load()
              onChanged()
            }
          }}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}
