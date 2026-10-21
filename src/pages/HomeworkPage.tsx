import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
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
import { HomeworkWalkthroughPanel } from '@/widgets/homework/walkthrough/HomeworkWalkthroughPanel'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { startHomeworkRun, useHomeworkRun } from '@/features/homework/homeworkRuns'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { GenerationControls } from '@/shared/ui/GenerationControls'
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
  // The chosen view lives in the URL (?view=review|walkthrough), so a reload,
  // a dev-server hot update or the back button keeps it instead of falling
  // back to practice.
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  /** Practice (answer hidden) or review (professor answer shown). */
  const mode: 'practice' | 'review' = viewParam === 'review' ? 'review' : 'practice'
  /** One question at a time, or the whole assignment's walkthrough. */
  const view: 'questions' | 'walkthrough' =
    viewParam === 'walkthrough' ? 'walkthrough' : 'questions'
  const showView = useCallback(
    (next: 'practice' | 'review' | 'walkthrough') =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          if (next === 'practice') params.delete('view')
          else params.set('view', next)
          return params
        },
        { replace: true },
      ),
    [setSearchParams],
  )

  const load = useCallback(async () => {
    if (!service || !assignmentId) return
    const [nextSet, nextQuestions, nextRetired] = await Promise.all([
      service.getSet(assignmentId),
      service.listQuestions(assignmentId),
      service.listRetiredQuestions(assignmentId),
    ])
    // An assignment from another course is "not found" from this one.
    const owned = nextSet && nextSet.projectId === projectId ? nextSet : null
    const ownedQuestions = owned ? nextQuestions : []
    setSet(owned)
    setQuestions(ownedQuestions)
    setRetired(owned ? nextRetired : [])
    setActiveId((prev) =>
      prev && ownedQuestions.some((q) => q.id === prev) ? prev : (ownedQuestions[0]?.id ?? null),
    )
  }, [service, assignmentId, projectId])

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

  // The assignment's pausable run (re-read / continue), if one exists.
  const runHandle = useHomeworkRun(set?.documentId)
  const runLive = runHandle.state === 'running' || runHandle.state === 'pausing'

  const index = useMemo(() => questions.findIndex((q) => q.id === activeId), [questions, activeId])
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

  /** Re-read the assignment, or continue a paused run with only what is left. */
  async function runSet(kind: 'retry' | 'resume' = 'retry'): Promise<void> {
    if (!service || !assignmentId || !set) return
    setRetrying(true)
    setError(null)
    setSummary(null)
    const run = startHomeworkRun(set.documentId)
    runHandle.attach(run)
    try {
      const result =
        kind === 'retry'
          ? await service.retrySet(assignmentId, { control: run })
          : await service.resumeSet(assignmentId, { control: run })
      if (result && !result.paused && kind === 'retry') setSummary(result.summary)
      await load()
    } catch (err) {
      if (!isGenerationInterruption(err, run)) setError(friendlyAIError(err))
    } finally {
      run.finish()
      setRetrying(false)
      await load().catch(() => undefined)
    }
  }
  const retrySet = (): Promise<void> => runSet('retry')

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
              <div
                role="group"
                aria-label={t('homework.mode.label')}
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/30 p-1 lab:gap-0.5 lab:rounded-md lab:bg-card lab:p-0.5"
              >
                <Button
                  variant={view === 'questions' && mode === 'practice' ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={view === 'questions' && mode === 'practice'}
                  onClick={() => showView('practice')}
                >
                  {t('homework.mode.practice')}
                </Button>
                {set.answerDocumentId && (
                  <Button
                    variant={view === 'questions' && mode === 'review' ? 'default' : 'ghost'}
                    size="sm"
                    aria-pressed={view === 'questions' && mode === 'review'}
                    onClick={() => showView('review')}
                  >
                    {t('homework.mode.review')}
                  </Button>
                )}
                <Button
                  variant={view === 'walkthrough' ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={view === 'walkthrough'}
                  onClick={() => showView('walkthrough')}
                >
                  {t('homework.mode.walkthrough')}
                </Button>
              </div>
            )}
            {set?.status === 'ready' && questions.length > 0 && (
              <Button variant="outline" onClick={() => void retrySet()} disabled={retrying}>
                {retrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t('homework.reanalyze')}
              </Button>
            )}
            {runLive && runHandle.run && (
              <GenerationControls
                kind="parts"
                state={runHandle.state}
                stopRequested={runHandle.run.stopRequested}
                onPause={runHandle.requestPause}
                onStopNow={runHandle.stopNow}
              />
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
          // The assignment id is unknown (deleted, mistyped, or from another
          // course) — this is not an empty homework list.
          <EmptyState
            icon={<ClipboardList className="h-10 w-10" />}
            title={t('homework.assignmentNotFound')}
            description={t('homework.assignmentNotFoundHint')}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/homework`}>
                  <ArrowLeft className="h-4 w-4" />
                  {t('homework.back')}
                </Link>
              </Button>
            }
          />
        ) : set.status === 'failed' ? (
          <ErrorState
            title={t('homework.failedTitle')}
            description={set.errorMessage ?? t('homework.noQuestions')}
            action={
              <Button variant="outline" onClick={() => void retrySet()} disabled={retrying}>
                {retrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                {t('homework.retryAnalyze')}
              </Button>
            }
          />
        ) : (
          <>
            {summary && (
              <Card className="border-border/70">
                <CardHeader>
                  <CardTitle className="text-base lecture:font-heading lecture:font-bold">
                    {t('homework.reanalysis.title')}
                  </CardTitle>
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

            {set.status === 'paused' && !runLive && (
              <Card className="border-border/70">
                <CardContent className="p-3">
                  <GenerationControls
                    kind="parts"
                    state={runHandle.state === 'stopped' ? 'stopped' : 'paused'}
                    done={set.progress?.completed ?? 0}
                    {...(typeof set.progress?.total === 'number'
                      ? { total: set.progress.total }
                      : {})}
                    onResume={() => void runSet('resume')}
                    {...(set.progress?.stage !== 'generating'
                      ? { pausedHint: t('homework.pausedIdentifyingHint') }
                      : {})}
                  />
                </CardContent>
              </Card>
            )}

            {view === 'walkthrough' && questions.length > 0 ? (
              <HomeworkWalkthroughPanel set={set} mode={mode} />
            ) : questions.length === 0 && set.status === 'paused' ? null : questions.length ===
              0 ? (
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
                <Card className="border-border/70 lecture:rounded-none lecture:border-x-0 lecture:bg-transparent lecture:shadow-none">
                  <CardContent className="flex items-center gap-2 p-2 lecture:px-0 lab:p-1.5 sm:p-3 sm:lecture:px-0 sm:lab:p-1.5">
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
                                  'focus-ring grid h-9 min-w-9 place-items-center rounded-full px-2.5 text-xs font-medium transition-colors duration-150 lab:h-8 lab:rounded-sm motion-safe:active:scale-[0.97]',
                                  isActive
                                    ? 'bg-theme-primary-soft text-foreground lecture:rounded-none lecture:bg-transparent lecture:text-foreground lecture:shadow-[inset_0_-2px_0_hsl(var(--primary))] lab:shadow-[inset_0_-2px_0_hsl(var(--primary))]'
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
                        setActiveId(
                          questions[Math.min(questions.length - 1, index + 1)]?.id ?? null,
                        )
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
                  <CardTitle className="text-base lecture:font-heading lecture:font-bold">
                    {t('homework.retired.title')}
                  </CardTitle>
                  <CardDescription>{t('homework.retired.hint')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {retired.map((question) => (
                    <div
                      key={question.id}
                      className="space-y-2 rounded-lg border border-border/70 p-3"
                    >
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void restore(question.id)}
                        >
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
