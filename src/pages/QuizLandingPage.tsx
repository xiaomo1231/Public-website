import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Brain,
  ClipboardList,
  Clock,
  ListChecks,
  Play,
  Sparkles,
  Upload,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { QuizConfigDialog } from '@/widgets/quiz/QuizConfigDialog'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { buildAIServices, buildOfflineQuizService } from '@/services/aiServices'
import { QuizRepository } from '@/entities/quiz/repository'
import {
  QUIZ_STATUS_LABEL_KEYS,
  quizGenerationProgress,
  quizLength,
  type Quiz,
  type QuizConfig,
} from '@/entities/quiz/types'
import { Progress } from '@/shared/ui/Progress'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { formatDateTime } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export function QuizLandingPage(): JSX.Element {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null)
  /** The paused quiz whose remaining questions are being generated. */
  const [continuingId, setContinuingId] = useState<string | null>(null)
  const generation = useGenerationRun()
  const [searchParams, setSearchParams] = useSearchParams()
  const configRef = useRef<HTMLDivElement>(null)

  /** Bring the setup panel into view and move focus to it. */
  function focusConfig() {
    const el = configRef.current
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }

  const reload = useCallback(async () => {
    if (!projectId) return
    setQuizzes(await new QuizRepository().listByProject(projectId))
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        // A quiz left `generating` by a closed tab becomes paused (or failed).
        await buildOfflineQuizService()
          .recoverInterruptedQuizzes(projectId)
          .catch(() => undefined)
        const rows = await new QuizRepository().listByProject(projectId)
        if (!cancelled) setQuizzes(rows)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  /** A paused run keeps its questions: say so and list it with 「继续出题」. */
  function reportPaused(quiz: Quiz) {
    toast({
      variant: 'info',
      title: t('generation.pausedShort'),
      description: t('quiz.paused.saved', { count: quizGenerationProgress(quiz).done }),
    })
  }

  async function handleContinue(quizId: string) {
    if (!projectId || busy) return
    setBusy(true)
    setContinuingId(quizId)
    setProgress({ stage: 'starting', progress: 5 })
    const run = generation.start()
    try {
      const bundle = await buildAIServices()
      if (!bundle) {
        toast({
          variant: 'error',
          title: t('quiz.noProvider'),
          description: t('quiz.noProviderHint'),
        })
        return
      }
      const quiz = await bundle.quiz.continueQuiz(quizId, {
        control: run,
        onProgress: (stage, value) => setProgress({ stage, progress: value }),
      })
      if (quiz.status === 'paused') {
        reportPaused(quiz)
        return
      }
      await bundle.quiz.startQuiz(quiz.id)
      navigate(`/projects/${projectId}/quiz/${quiz.id}`)
    } catch (err) {
      if (!isGenerationInterruption(err, run)) {
        toast({
          variant: 'error',
          title: t('quiz.generateFailed'),
          description: friendlyAIError(err),
        })
      }
    } finally {
      run.finish()
      generation.reset()
      setBusy(false)
      setContinuingId(null)
      setProgress(null)
      await reload().catch(() => undefined)
    }
  }

  // 「继续出题」 from an unfinished quiz's own page lands here with ?continue=<id>.
  const continueParam = searchParams.get('continue')
  useEffect(() => {
    if (!continueParam || loading) return
    setSearchParams(
      (params) => {
        params.delete('continue')
        return params
      },
      { replace: true },
    )
    if (quizzes.some((quiz) => quiz.id === continueParam && quiz.status === 'paused')) {
      void handleContinue(continueParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueParam, loading])

  async function handleStart(config: QuizConfig) {
    if (!projectId) return
    setBusy(true)
    setProgress({ stage: 'starting', progress: 5 })
    const run = generation.start()
    try {
      const bundle = await buildAIServices()
      if (!bundle) {
        toast({
          variant: 'error',
          title: t('quiz.noProvider'),
          description: t('quiz.noProviderHint'),
        })
        return
      }
      const quiz = await bundle.quiz.generateQuiz(projectId, config, {
        control: run,
        onProgress: (stage, value) => setProgress({ stage, progress: value }),
      })
      if (quiz.status === 'paused') {
        reportPaused(quiz)
        return
      }
      await bundle.quiz.startQuiz(quiz.id)
      toast({
        variant: 'success',
        title: t('quiz.ready'),
        description: t('quiz.readyBody', { count: quizLength(quiz) }),
      })
      navigate(`/projects/${projectId}/quiz/${quiz.id}`)
    } catch (err) {
      if (!isGenerationInterruption(err, run)) {
        const msg = friendlyAIError(err)
        toast({ variant: 'error', title: t('quiz.generateFailed'), description: msg })
      }
    } finally {
      run.finish()
      generation.reset()
      setBusy(false)
      setProgress(null)
      await reload().catch(() => undefined)
    }
  }

  const controls = (
    <GenerationControls
      kind="parts"
      state={generation.state}
      stopRequested={generation.run?.stopRequested ?? false}
      onPause={generation.requestPause}
      onStopNow={generation.stopNow}
    />
  )

  if (!projectId) return <div />

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('quiz.backToProject')}>
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <ListChecks className="h-4 w-4" />
            {t('quiz.title')}
          </div>
        }
        description={t('quiz.subtitle')}
        nav={<ProjectFlowNav projectId={projectId} active="quiz" />}
        actions={
          <Button variant="outline" asChild>
            <Link to={`/projects/${projectId}/mastery`}>
              <Brain className="h-4 w-4" />
              {t('quiz.mastery')}
            </Link>
          </Button>
        }
      />
      <PageContent className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {t('practice.title')}
            </CardTitle>
            <CardDescription>{t('practice.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to={`/projects/${projectId}/practice`}>
                <Upload className="h-4 w-4" />
                {t('practice.upload')}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <div ref={configRef} tabIndex={-1} className="scroll-mt-4 rounded-2xl outline-none">
          <QuizConfigDialog
            projectId={projectId}
            onStart={handleStart}
            busy={busy}
            progress={continuingId ? null : progress}
            controls={controls}
          />
        </div>

        {loading ? (
          <LoadingState label={t('quiz.loading')} />
        ) : quizzes.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="h-10 w-10" />}
            title={t('quiz.empty')}
            description={t('quiz.emptyHint')}
            action={
              <Button variant="outline" onClick={focusConfig}>
                <Sparkles className="h-4 w-4" />
                {t('quiz.setup')}
              </Button>
            }
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('quiz.previous')}</CardTitle>
              <CardDescription>
                {t('quiz.previousCount', { count: quizzes.length })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 lab:space-y-0 lab:pt-px">
              {quizzes.map((q) =>
                q.status === 'paused' ? (
                  <PausedQuizRow
                    key={q.id}
                    quiz={q}
                    busy={busy}
                    continuing={continuingId === q.id}
                    progress={continuingId === q.id ? progress : null}
                    controls={controls}
                    onContinue={() => void handleContinue(q.id)}
                  />
                ) : (
                  <Link
                    key={q.id}
                    to={
                      q.status === 'completed'
                        ? `/projects/${projectId}/quiz/${q.id}/result`
                        : `/projects/${projectId}/quiz/${q.id}`
                    }
                    className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors duration-150 ease-out hover:bg-accent/50 lecture:rounded-xl lecture:px-4 lecture:py-2.5 lab:-mt-px lab:rounded-none lab:hover:bg-background"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium lecture:font-heading">
                      {q.title}
                    </span>
                    <Badge
                      variant={
                        q.status === 'completed'
                          ? 'default'
                          : q.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {t(QUIZ_STATUS_LABEL_KEYS[q.status])}
                    </Badge>
                    {q.score && (
                      <Badge variant="outline" className="data-num lab:font-mono">
                        {q.score.percentage}%
                      </Badge>
                    )}
                    <span className="data-num flex items-center gap-1 text-xs text-muted-foreground lab:font-mono">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(q.startedAt)}
                    </span>
                  </Link>
                ),
              )}
            </CardContent>
          </Card>
        )}
      </PageContent>
    </PageContainer>
  )
}

/**
 * An unfinished quiz: its questions so far are kept, it cannot be taken yet,
 * and 「继续出题」 generates only the remaining planned questions.
 */
function PausedQuizRow({
  quiz,
  busy,
  continuing,
  progress,
  controls,
  onContinue,
}: {
  quiz: Quiz
  busy: boolean
  continuing: boolean
  progress: { stage: string; progress: number } | null
  controls: JSX.Element
  onContinue: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { done, total } = quizGenerationProgress(quiz)
  return (
    <div className="space-y-2 rounded-lg border px-3 py-2 text-sm lecture:rounded-xl lecture:px-4 lecture:py-2.5 lab:-mt-px lab:rounded-none">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-medium lecture:font-heading">
          {quiz.title}
        </span>
        <Badge variant="outline">{t(QUIZ_STATUS_LABEL_KEYS[quiz.status])}</Badge>
        <span className="data-num text-xs text-muted-foreground lab:font-mono">
          {t('quiz.paused.progress', { done, total })}
        </span>
        {!continuing && (
          <Button type="button" size="sm" variant="outline" onClick={onContinue} disabled={busy}>
            <Play className="h-4 w-4" aria-hidden />
            {t('quiz.paused.continue')}
          </Button>
        )}
      </div>
      {continuing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Progress value={progress?.progress ?? 5} className="h-1.5" />
            <p className="text-xs text-muted-foreground">{t('quiz.paused.continuing')}</p>
          </div>
          {controls}
        </div>
      ) : (
        quiz.errorMessage && <p className="text-xs text-muted-foreground">{quiz.errorMessage}</p>
      )}
    </div>
  )
}
