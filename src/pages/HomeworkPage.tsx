import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import type { HomeworkQuestion, HomeworkSet, ReanalysisSummary } from '@/entities/homework/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { RichText } from '@/shared/ui/RichText'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
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
  /** Practice (answer hidden) or review (professor answer shown). */
  const [mode, setMode] = useState<'practice' | 'review'>('practice')

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

  // Keep the current question's chip visible in the horizontal navigator.
  const navRef = useRef<HTMLDivElement>(null)
  const activeChipRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const nav = navRef.current
    const chip = activeChipRef.current
    if (!nav || !chip) return
    const navRect = nav.getBoundingClientRect()
    const chipRect = chip.getBoundingClientRect()
    const delta = chipRect.left - navRect.left - (nav.clientWidth - chipRect.width) / 2
    nav.scrollLeft = Math.max(0, nav.scrollLeft + delta)
  }, [active?.id])

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
            {set?.answerDocumentId && (
              <div
                role="group"
                aria-label={t('homework.mode.label')}
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/30 p-1"
              >
                <Button
                  variant={mode === 'practice' ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={mode === 'practice'}
                  onClick={() => setMode('practice')}
                >
                  {t('homework.mode.practice')}
                </Button>
                <Button
                  variant={mode === 'review' ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={mode === 'review'}
                  onClick={() => setMode('review')}
                >
                  {t('homework.mode.review')}
                </Button>
              </div>
            )}
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
              <Card className="border-border/70">
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

            {set.analysisNote && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardContent className="flex items-start gap-2 p-3 text-sm text-foreground">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden
                  />
                  <span>{set.analysisNote}</span>
                </CardContent>
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
              <div className="space-y-4">
                {/* Compact question navigator: a single horizontal row so the
                    question and the working area are not squeezed into a third
                    column. The active chip scrolls itself into view. */}
                <Card className="border-border/70">
                  <CardContent className="flex items-center gap-2 p-2 sm:p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setActiveId(questions[Math.max(0, index - 1)]?.id ?? null)}
                      disabled={index <= 0}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('homework.prev')}</span>
                    </Button>

                    <div
                      ref={navRef}
                      className="min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      <ol
                        aria-label={t('homework.questionNavHint')}
                        className="flex items-center gap-1.5 py-1"
                      >
                        {questions.map((question, position) => {
                          const isActive = question.id === active?.id
                          return (
                            <li key={question.id} className="shrink-0">
                              <button
                                type="button"
                                ref={isActive ? activeChipRef : undefined}
                                onClick={() => setActiveId(question.id)}
                                aria-current={isActive ? 'true' : undefined}
                                aria-label={`${position + 1}. ${question.number ?? question.prompt}`}
                                title={question.number ?? question.prompt}
                                className={cn(
                                  'focus-ring grid h-9 min-w-9 place-items-center rounded-full px-2.5 text-xs font-medium transition-colors',
                                  isActive
                                    ? 'bg-theme-primary-soft text-foreground'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                              >
                                <span className="data-num font-mono">
                                  {String(position + 1).padStart(2, '0')}
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                    </div>

                    <Badge
                      variant="outline"
                      className="data-num hidden shrink-0 font-mono sm:inline-flex"
                      aria-live="polite"
                    >
                      {t('homework.progress', { current: index + 1, total: questions.length })}
                    </Badge>

                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() =>
                        setActiveId(questions[Math.min(questions.length - 1, index + 1)]?.id ?? null)
                      }
                      disabled={index >= questions.length - 1}
                    >
                      <span className="hidden sm:inline">{t('homework.next')}</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>

                {active && (
                  <HomeworkQuestionView
                    key={active.id}
                    question={active}
                    service={service}
                    mode={mode}
                    {...(set.answerDocumentId ? { answerDocumentId: set.answerDocumentId } : {})}
                  />
                )}
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
                        text={formatHomeworkQuestion(question.prompt)}
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
