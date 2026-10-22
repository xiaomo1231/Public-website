import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import type { HomeworkQuestion, HomeworkSet, ReanalysisSummary } from '@/entities/homework/types'
import { isPracticeSet } from '@/entities/homework/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/DropdownMenu'
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
import { GuidedPracticeView } from '@/widgets/homework/guided/GuidedPracticeView'
import { HomeworkWalkthroughPanel } from '@/widgets/homework/walkthrough/HomeworkWalkthroughPanel'
import { practiceSourceFor } from '@/widgets/homework/practice/practiceSource'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { useHomeworkService } from '@/features/homework/useHomeworkService'
import { startHomeworkRun, useHomeworkRun } from '@/features/homework/homeworkRuns'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { effectiveEvalRole, heldOutQuestions } from '@/entities/evaluation/evalRole'
import { HomeworkProofreadService } from '@/services/homeworkProofreadService'
import { ProofreadView } from '@/widgets/homework/proofread/ProofreadView'
import { SelfTestView } from '@/widgets/homework/selfTest/SelfTestView'
import { QuestionWindowLayer } from '@/widgets/homework/QuestionWindowLayer'
import { EvaluationPanel } from '@/widgets/evaluation/EvaluationPanel'

type HomeworkView = 'questions' | 'walkthrough' | 'guided' | 'proofread' | 'selftest' | 'evaluate'
const EXTRA_VIEWS: readonly string[] = [
  'walkthrough',
  'guided',
  'proofread',
  'selftest',
  'evaluate',
]

/** Per-viewer: the 「建议先校对」 banner was dismissed for this assignment. */
function proofreadBannerDismissed(setId: string): boolean {
  try {
    return localStorage.getItem(`ai-learning:proofread-banner:${setId}`) === '1'
  } catch {
    return false
  }
}

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
  const { t, language } = useTranslation()
  const checkLanguage = language === 'zh-CN' ? 'zh' : 'en'
  const { id: projectId, assignmentId } = useParams<{ id: string; assignmentId: string }>()
  const service = useHomeworkService()
  const proofread = useMemo(() => new HomeworkProofreadService(), [])
  const [bannerHidden, setBannerHidden] = useState(() =>
    assignmentId ? proofreadBannerDismissed(assignmentId) : false,
  )

  const [set, setSet] = useState<HomeworkSet | null>(null)
  const [questions, setQuestions] = useState<HomeworkQuestion[]>([])
  const [retired, setRetired] = useState<HomeworkQuestion[]>([])
  /** Practice sets: the assignment they were made from, and its questions. */
  const [parent, setParent] = useState<{
    set: HomeworkSet | null
    questions: HomeworkQuestion[]
  } | null>(null)
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
  /**
   * One question at a time, the whole assignment's walkthrough, or 引导练习
   * (one question, step by step from its walkthrough).
   */
  const view: HomeworkView =
    viewParam && EXTRA_VIEWS.includes(viewParam) ? (viewParam as HomeworkView) : 'questions'
  const showView = useCallback(
    (next: 'practice' | 'review' | Exclude<HomeworkView, 'questions'>) =>
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
    // Knowledge points + exam-scope links are matched locally (no AI) and
    // only rewritten when their inputs changed.
    await proofread.refreshMeta(assignmentId).catch(() => 0)
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
    if (owned && isPracticeSet(owned) && owned.parentSetId) {
      const [parentSet, parentQuestions] = await Promise.all([
        service.getSet(owned.parentSetId),
        service.listQuestions(owned.parentSetId),
      ])
      const ownedParent = parentSet && parentSet.projectId === projectId ? parentSet : null
      setParent({ set: ownedParent, questions: ownedParent ? parentQuestions : [] })
    } else setParent(null)
    setActiveId((prev) =>
      prev && ownedQuestions.some((q) => q.id === prev) ? prev : (ownedQuestions[0]?.id ?? null),
    )
  }, [service, assignmentId, projectId, proofread])

  // The question view seeds its state from the list entry once, and its own
  // saves (draft, hints, chat) do not update this list — so re-read the row
  // before showing a question again, or it would show (and later overwrite)
  // stale data.
  const selectQuestion = useCallback(
    (id: string | null) => {
      if (!id || !service) {
        setActiveId(id)
        return
      }
      void service
        .getQuestion(id)
        .catch(() => undefined)
        .then((fresh) => {
          if (fresh) setQuestions((list) => list.map((q) => (q.id === fresh.id ? fresh : q)))
          setActiveId(id)
        })
    },
    [service],
  )

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

  // Questions held out for independent evaluation are only done in 自测:
  // no hints, walkthrough, guided steps or AI chat for them.
  const heldOut = useMemo(() => (set ? heldOutQuestions(set, questions) : []), [set, questions])
  const shown = useMemo(
    () => (set ? questions.filter((q) => effectiveEvalRole(q, set) !== 'independent') : questions),
    [set, questions],
  )
  const unverified = questions.filter((q) => !q.verifiedAt).length
  const index = useMemo(() => shown.findIndex((q) => q.id === activeId), [shown, activeId])
  const active = index >= 0 ? shown[index] : (shown[0] ?? null)

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
  const canReanalyze = set?.status === 'ready' && questions.length > 0 && set.kind !== 'practice'

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
                  variant={view === 'guided' ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={view === 'guided'}
                  onClick={() => showView('guided')}
                >
                  {t('homework.mode.guided')}
                </Button>
                <Button
                  variant={view === 'walkthrough' ? 'default' : 'ghost'}
                  size="sm"
                  aria-pressed={view === 'walkthrough'}
                  onClick={() => showView('walkthrough')}
                >
                  {t('homework.mode.walkthrough')}
                </Button>
                {set.kind !== 'practice' && (
                  <Button
                    variant={view === 'proofread' ? 'default' : 'ghost'}
                    size="sm"
                    aria-pressed={view === 'proofread'}
                    onClick={() => showView('proofread')}
                  >
                    {t('homework.mode.proofread')}
                  </Button>
                )}
                {heldOut.length > 0 && (
                  <Button
                    variant={view === 'selftest' ? 'default' : 'ghost'}
                    size="sm"
                    aria-pressed={view === 'selftest'}
                    onClick={() => showView('selftest')}
                  >
                    {t('homework.mode.selfTest')}
                  </Button>
                )}
              </div>
            )}
            {canReanalyze && (
              <Button
                variant="outline"
                className="hidden xl:inline-flex"
                onClick={() => void retrySet()}
                disabled={retrying}
              >
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
            {set?.status === 'ready' && set.kind !== 'practice' && (
              <Button
                variant={view === 'evaluate' ? 'default' : 'outline'}
                className="hidden xl:inline-flex"
                aria-pressed={view === 'evaluate'}
                onClick={() => showView('evaluate')}
              >
                {t('evaluation.menu')}
              </Button>
            )}
            <Button asChild variant="outline" className="hidden xl:inline-flex">
              <Link to={`/projects/${projectId}/homework`}>
                <ArrowLeft className="h-4 w-4" />
                {t('homework.back')}
              </Link>
            </Button>
            {/* Narrower screens: the secondary actions sit in one menu, so the
                header stays one tidy row next to the title. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="xl:hidden"
                  aria-label={t('homework.menu.label')}
                  title={t('homework.menu.label')}
                >
                  {retrying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canReanalyze && (
                  <DropdownMenuItem disabled={retrying} onSelect={() => void retrySet()}>
                    <RefreshCw className="h-4 w-4" />
                    {t('homework.reanalyze')}
                  </DropdownMenuItem>
                )}
                {set?.status === 'ready' && set.kind !== 'practice' && (
                  <DropdownMenuItem onSelect={() => showView('evaluate')}>
                    <ClipboardList className="h-4 w-4" />
                    {t('evaluation.menu')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link to={`/projects/${projectId}/homework`}>
                    <ArrowLeft className="h-4 w-4" />
                    {t('homework.back')}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

            {set.status === 'ready' &&
              set.kind !== 'practice' &&
              unverified > 0 &&
              !bannerHidden &&
              view !== 'proofread' &&
              questions.length > 0 && (
                <Card className="border-amber-500/40 bg-amber-500/5" data-proofread-banner>
                  <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <AlertTriangle
                      className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden
                    />
                    <span className="flex-1">{t('proofread.banner', { count: unverified })}</span>
                    <Button size="sm" className="min-h-11" onClick={() => showView('proofread')}>
                      {t('homework.mode.proofread')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => {
                        setBannerHidden(true)
                        try {
                          localStorage.setItem(`ai-learning:proofread-banner:${set.id}`, '1')
                        } catch {
                          // Per-viewer convenience only.
                        }
                      }}
                    >
                      {t('proofread.bannerDismiss')}
                    </Button>
                  </CardContent>
                </Card>
              )}

            {heldOut.length > 0 && view === 'questions' && (
              <p className="text-sm text-muted-foreground" data-held-out-note>
                {t('selfTest.heldOutNote', { count: heldOut.length })}{' '}
                <button
                  type="button"
                  className="focus-ring min-h-11 rounded px-1 text-primary underline"
                  onClick={() => showView('selftest')}
                >
                  {t('homework.mode.selfTest')}
                </button>
              </p>
            )}

            {view === 'proofread' && questions.length > 0 ? (
              <ProofreadView
                setId={set.id}
                projectId={projectId}
                onChanged={() => void load()}
                onOpenView={(next) => showView(next)}
              />
            ) : view === 'selftest' ? (
              <SelfTestView
                set={set}
                questions={questions}
                homework={service}
                language={checkLanguage}
                onChanged={() => void load()}
              />
            ) : view === 'evaluate' ? (
              <EvaluationPanel
                set={set}
                questions={questions}
                language={checkLanguage}
                onChanged={() => void load()}
              />
            ) : view === 'walkthrough' && questions.length > 0 ? (
              <HomeworkWalkthroughPanel
                set={set}
                mode={mode}
                onPractice={() => showView('practice')}
              />
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
                      onClick={() => selectQuestion(shown[Math.max(0, index - 1)]?.id ?? null)}
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
                        {shown.map((question, position) => {
                          const isActive = question.id === active?.id
                          return (
                            <li key={question.id} className="shrink-0">
                              <button
                                type="button"
                                ref={isActive ? activeChipRef : undefined}
                                onClick={() => selectQuestion(question.id)}
                                aria-current={isActive ? 'true' : undefined}
                                aria-label={`${position + 1}. ${question.number ?? question.prompt}${question.verifiedAt ? ` · ${t('proofread.verified')}` : ''}`}
                                data-verified={question.verifiedAt ? 'true' : 'false'}
                                title={question.number ?? question.prompt}
                                className={cn(
                                  'focus-ring relative grid h-9 min-w-9 place-items-center rounded-full px-2.5 text-xs font-medium transition-colors duration-150 lab:h-8 lab:rounded-sm motion-safe:active:scale-[0.97]',
                                  isActive
                                    ? 'bg-theme-primary-soft text-foreground lecture:rounded-none lecture:bg-transparent lecture:text-foreground lecture:shadow-[inset_0_-2px_0_hsl(var(--primary))] lab:shadow-[inset_0_-2px_0_hsl(var(--primary))]'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                              >
                                <span className="data-num font-mono">
                                  {String(position + 1).padStart(2, '0')}
                                </span>
                                {question.verifiedAt && (
                                  <CheckCircle2
                                    className="absolute -right-0.5 -top-0.5 h-3 w-3 text-emerald-600 dark:text-emerald-400"
                                    aria-hidden
                                  />
                                )}
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
                      {t('homework.progress', { current: index + 1, total: shown.length })}
                    </Badge>

                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() =>
                        selectQuestion(shown[Math.min(shown.length - 1, index + 1)]?.id ?? null)
                      }
                      disabled={index >= shown.length - 1}
                    >
                      <span className="hidden sm:inline">{t('homework.next')}</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>

                {active && view === 'guided' ? (
                  <GuidedPracticeView
                    key={active.id}
                    setId={set.id}
                    question={active}
                    onOpenWalkthrough={() => showView('walkthrough')}
                  />
                ) : active ? (
                  <HomeworkQuestionView
                    key={active.id}
                    question={active}
                    service={service}
                    mode={mode}
                    onStartGuided={() => showView('guided')}
                    practiceSource={practiceSourceFor(
                      set,
                      parent?.set ?? null,
                      parent?.questions ?? [],
                      active,
                    )}
                    {...(set.answerDocumentId ? { answerDocumentId: set.answerDocumentId } : {})}
                  />
                ) : null}
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
      {/* Floating 原题 windows: stay across questions and views, close with the set. */}
      {set && <QuestionWindowLayer setId={set.id} />}
    </PageContainer>
  )
}
