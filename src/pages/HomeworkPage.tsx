import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ClipboardList, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import type { HomeworkQuestion, HomeworkSet, ReanalysisSummary } from '@/entities/homework/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { RichText } from '@/shared/ui/RichText'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { HomeworkQuestionView } from '@/widgets/homework/HomeworkQuestionView'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

/**
 * The dedicated walkthrough for one homework assignment: a question navigator
 * and the active question. Questions, drafts, revealed hints and the revealed
 * solution all restore from local storage on reload.
 *
 * Re-analysis never deletes records: matched questions keep their id and
 * student work, and questions that no longer match appear in the "removed"
 * section where they can be reviewed, restored or explicitly deleted.
 */
export function HomeworkPage(): JSX.Element {
  const { t } = useTranslation()
  const { id: projectId, assignmentId } = useParams<{ id: string; assignmentId: string }>()
  const service = useHomeworkService()

  const [set, setSet] = useState<HomeworkSet | null>(null)
  const [questions, setQuestions] = useState<HomeworkQuestion[]>([])
  const [retired, setRetired] = useState<HomeworkQuestion[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [summary, setSummary] = useState<ReanalysisSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!service || !assignmentId) return
    const [nextSet, nextQuestions, nextRetired] = await Promise.all([
      service.getSet(assignmentId),
      service.listQuestions(assignmentId),
      service.listRetiredQuestions(assignmentId),
    ])
    setSet(nextSet ?? null)
    setQuestions(nextQuestions)
    setRetired(nextRetired)
    setActiveId((prev) =>
      prev && nextQuestions.some((q) => q.id === prev) ? prev : (nextQuestions[0]?.id ?? null),
    )
  }, [service, assignmentId])

  useEffect(() => {
    let alive = true
    void load()
      .catch((err) => {
        if (alive) setError(friendlyAIError(err))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [load])

  const index = useMemo(
    () => questions.findIndex((q) => q.id === activeId),
    [questions, activeId],
  )
  const active = index >= 0 ? questions[index] : (questions[0] ?? null)

  async function retrySet(): Promise<void> {
    if (!service || !assignmentId) return
    setRetrying(true)
    setError(null)
    setSummary(null)
    try {
      const result = await service.retrySet(assignmentId)
      if (result) setSummary(result.summary)
      await load()
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setRetrying(false)
    }
  }

  async function restore(id: string): Promise<void> {
    if (!service) return
    await service.restoreQuestion(id)
    await load()
  }

  async function remove(id: string): Promise<void> {
    if (!service) return
    await service.deleteQuestion(id)
    await load()
  }

  if (!projectId) return <div />

  return (
    <PageContainer>
      <PageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title={set?.title ?? t('homework.title')}
        description={
          set && set.questionCount > 0
            ? t('homework.questionsCount', { count: set.questionCount })
            : t('homework.subtitle')
        }
        nav={<ProjectFlowNav projectId={projectId} active="homework" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {set?.status === 'ready' && questions.length > 0 && (
              <Button variant="outline" onClick={() => void retrySet()} disabled={retrying}>
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {t('homework.reanalyze')}
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to={`/projects/${projectId}/homework`}>
                <ArrowLeft className="h-4 w-4" />
                {t('homework.back')}
              </Link>
            </Button>
          </div>
        }
      />
      <PageContent className="space-y-5">
        {loading || !service ? (
          <LoadingState label={t('common.loading')} />
        ) : error && !set ? (
          <ErrorState title={t('homework.failedTitle')} description={error} />
        ) : !set ? (
          <EmptyState
            icon={<ClipboardList className="h-10 w-10" />}
            title={t('homework.empty')}
            description={t('homework.emptyHint')}
          />
        ) : set.status === 'failed' ? (
          <ErrorState
            title={t('homework.failedTitle')}
            description={set.errorMessage ?? t('homework.noQuestions')}
            action={
              <Button variant="outline" onClick={() => void retrySet()} disabled={retrying}>
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {t('homework.retryAnalyze')}
              </Button>
            }
          />
        ) : (
          <>
            {summary && (
              <Card className="blueprint-frame border-border/70">
                <CardHeader>
                  <CardTitle className="text-base">{t('homework.reanalysis.title')}</CardTitle>
                  <CardDescription>
                    {t('homework.reanalysis.summary', {
                      matched: summary.matched,
                      regenerated: summary.regenerated,
                      added: summary.added,
                      restored: summary.restored,
                      retired: summary.retired,
                    })}
                  </CardDescription>
                </CardHeader>
                {summary.failed > 0 && (
                  <CardContent className="pt-0 text-sm text-muted-foreground">
                    {t('homework.reanalysis.failed', { count: summary.failed })}
                  </CardContent>
                )}
              </Card>
            )}

            {questions.length === 0 ? (
              <Card>
                <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t('homework.analyzing')}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                <aside className="min-w-0">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('homework.nav')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                        {questions.map((question, position) => (
                          <li key={question.id} className="shrink-0">
                            <button
                              type="button"
                              onClick={() => setActiveId(question.id)}
                              aria-current={question.id === active?.id ? 'true' : undefined}
                              className={cn(
                                'focus-ring flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                                question.id === active?.id
                                  ? 'bg-theme-primary-soft text-foreground'
                                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                              )}
                            >
                              <span className="data-num shrink-0 font-mono text-xs text-muted-foreground">
                                {String(position + 1).padStart(2, '0')}
                              </span>
                              <TruncatedText
                                text={question.number ?? question.prompt}
                                className="hidden min-w-0 flex-1 lg:block"
                              />
                            </button>
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                </aside>

                <section className="min-w-0 space-y-4">
                  {active && <HomeworkQuestionView key={active.id} question={active} service={service} />}

                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveId(questions[Math.max(0, index - 1)]?.id ?? null)}
                      disabled={index <= 0}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      {t('homework.prev')}
                    </Button>
                    <Badge variant="outline" className="data-num font-mono">
                      {t('homework.progress', { current: index + 1, total: questions.length })}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setActiveId(questions[Math.min(questions.length - 1, index + 1)]?.id ?? null)
                      }
                      disabled={index >= questions.length - 1}
                    >
                      {t('homework.next')}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </section>
              </div>
            )}

            {retired.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('homework.retired.title')}</CardTitle>
                  <CardDescription>{t('homework.retired.hint')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {retired.map((question) => (
                    <div key={question.id} className="space-y-2 rounded-lg border border-border/70 p-3">
                      <RichText
                        text={question.prompt}
                        format="markdown"
                        paragraphClassName="text-sm leading-relaxed"
                      />
                      {question.draftText && (
                        <p className="text-xs text-muted-foreground">
                          {t('homework.draft')}: {question.draftText}
                        </p>
                      )}
                      {question.messages.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {t('homework.askTitle')}: {question.messages.length}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => void restore(question.id)}>
                          {t('homework.retired.restore')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void remove(question.id)}
                        >
                          {t('homework.retired.delete')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </PageContent>
    </PageContainer>
  )
}
