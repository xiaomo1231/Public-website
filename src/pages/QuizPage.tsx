import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ListChecks } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent } from '@/shared/ui/Card'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { QuestionCard } from '@/widgets/quiz/QuestionCard'
import { OralExamSession } from '@/widgets/quiz/OralExamSession'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { buildAIServices, buildOfflineQuizService } from '@/services/aiServices'
import type { Question } from '@/entities/question/types'
import { quizGenerationProgress, quizLength, type Quiz } from '@/entities/quiz/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { isAbortError } from '@/shared/lib/generationControl'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { GenerationControls } from '@/shared/ui/GenerationControls'

export function QuizPage(): JSX.Element {
  const { id: projectId, quizId } = useParams<{ id: string; quizId: string }>()
  const navigate = useNavigate()
  const service = useMemo(() => buildOfflineQuizService(), [])
  const { t } = useTranslation()

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  /** Questions that already have an attempt, so a reopened quiz resumes. */
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(() => new Set())
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState<QuestionEvaluation | null>(null)
  /** The attempt behind `evaluation`, so a short-answer judgement can be disputed. */
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [disputing, setDisputing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number>(Date.now())
  const [unfinished, setUnfinished] = useState<Quiz | null>(null)
  const checkRun = useGenerationRun({ abortOnUnmount: true })

  useEffect(() => {
    if (!quizId) return
    let cancelled = false
    void (async () => {
      try {
        let q = await service.getQuiz(quizId, projectId)
        // A bank quiz closed between an answer and its next question serves it now.
        if (q.bank?.entries.length && q.status !== 'completed') {
          q = await service.resumeQuestionBank(quizId)
        }
        const qs = await service.getQuestions(quizId)
        const attempts = q.status === 'completed' ? [] : await service.getAttempts(quizId)
        if (cancelled) return
        if (q.status === 'completed') {
          navigate(`/projects/${projectId}/quiz/${quizId}/result`, { replace: true })
          return
        }
        // An unfinished quiz is completed first (「继续出题」 on the quiz page).
        if (q.status === 'paused' || q.status === 'generating') {
          setUnfinished(q)
          return
        }
        const done = new Set(attempts.map((a) => a.questionId))
        const firstOpen = qs.findIndex((question) => !done.has(question.id))
        if (qs.length > 0 && firstOpen === -1) {
          // Every question was answered but the quiz was never closed.
          await service.completeQuiz(quizId)
          if (!cancelled)
            navigate(`/projects/${projectId}/quiz/${quizId}/result`, { replace: true })
          return
        }
        setQuiz(q)
        setQuestions(qs)
        setAnsweredIds(done)
        setIndex(Math.max(0, firstOpen))
      } catch (err) {
        if (!cancelled) setError(isAppError(err) ? err.message : (err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quizId, projectId, navigate, service])

  const current = questions[index]

  async function submit(hintsUsed: number) {
    if (!quizId || !current) return
    setBusy(true)
    try {
      // Every type grades locally except short answers, which are checked
      // point by point by AI when one is configured (otherwise: not scored).
      const needsAi = current.type === 'short_answer' || current.type === 'fill_blank'
      const graded = needsAi ? ((await buildAIServices())?.quiz ?? null) : null
      // The AI check can be stopped; a stopped check submits nothing.
      const run = graded ? checkRun.start() : null
      try {
        const result = await (graded ?? service).submitAnswer(quizId, current.id, answer, {
          durationMs: Date.now() - startedAt,
          hintsUsed,
          ...(graded ? { gradeShortAnswer: true } : {}),
          ...(run ? { signal: run.signal } : {}),
        })
        setEvaluation(result.evaluation)
        setAttemptId(result.attempt.id)
        setAnsweredIds((prev) => new Set(prev).add(current.id))
        // A bank quiz: the adaptive model picked the next question.
        const following = result.nextQuestion
        if (following) {
          setQuestions((prev) =>
            prev.some((question) => question.id === following.id) ? prev : [...prev, following],
          )
        }
      } catch (err) {
        if (run && isAbortError(err, run.signal)) {
          toast({ variant: 'info', title: t('quiz.checkStopped') })
          return
        }
        throw err
      } finally {
        run?.finish()
        checkRun.reset()
      }
    } catch (err) {
      toast({ variant: 'error', title: t('quiz.gradeFailed'), description: friendlyAIError(err) })
    } finally {
      setBusy(false)
    }
  }

  async function dispute() {
    if (!attemptId) return
    setDisputing(true)
    try {
      const updated = await service.disputeAttempt(attemptId)
      setEvaluation(updated.evaluation)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('shortAnswer.disputeFailed'),
        description: (err as Error).message,
      })
    } finally {
      setDisputing(false)
    }
  }

  function next() {
    setEvaluation(null)
    setAttemptId(null)
    setAnswer('')
    setStartedAt(Date.now())
    const following = nextOpenIndex(questions, answeredIds, index)
    if (following === -1) {
      navigate(`/projects/${projectId}/quiz/${quizId}/result`)
      return
    }
    setIndex(following)
  }

  const answeredCount = questions.filter((question) => answeredIds.has(question.id)).length
  /** A bank quiz serves its questions one at a time; the length is fixed. */
  const total = quiz ? Math.max(quizLength(quiz), questions.length) : questions.length

  if (!projectId) return <div />

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('quiz.loadingQuiz')} />
        </PageContent>
      </PageContainer>
    )
  }

  if (unfinished) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={unfinished.title}
            description={`${t('quiz.paused.notTakeable')} ${t(
              'quiz.paused.progress',
              quizGenerationProgress(unfinished),
            )}`}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/quiz?continue=${unfinished.id}`}>
                  {t('quiz.paused.continue')}
                </Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  if (error || !quiz || questions.length === 0) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('quiz.unavailable')}
            description={error ?? t('quiz.noQuestions')}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/quiz`}>{t('quiz.backToQuizzes')}</Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('quiz.backToQuizzes')}>
              <Link to={`/projects/${projectId}/quiz`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <ListChecks className="h-4 w-4" />
            {quiz.title}
          </div>
        }
        description={quiz.config.mode === 'oral' ? t('oral.instructions') : t('quiz.instructions')}
        nav={<ProjectFlowNav projectId={projectId} active="quiz" />}
      />
      <PageContent className="space-y-4">
        {/* lecture: one centred column. lab: the instrument panel, a little wider. */}
        {quiz.config.mode === 'oral' ? (
          <div className="mx-auto w-full lecture:max-w-[720px] lab:max-w-[860px]">
            <OralExamSession
              projectId={projectId}
              quiz={quiz}
              questions={questions}
              service={service}
            />
          </div>
        ) : (
          <div className="mx-auto w-full space-y-4 lecture:max-w-[720px] lecture:space-y-8 lab:max-w-[860px]">
            <div className="space-y-1.5">
              {/* lecture: a thin line. lab: one tick per question. */}
              <Progress
                value={(answeredCount / Math.max(1, total)) * 100}
                className="lecture:h-0.5 lecture:rounded-none lab:hidden"
              />
              <ol
                aria-hidden
                className="hidden gap-[3px] lab:grid"
                style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: total }, (_, i) => questions[i]).map((question, i) => (
                  <li
                    key={question?.id ?? `pending-${i}`}
                    className={cn(
                      'h-1 transition-colors duration-200 ease-out',
                      // Answered is neutral: the tick shows progress, not correctness.
                      i === index
                        ? 'bg-primary'
                        : question && answeredIds.has(question.id)
                          ? 'bg-foreground/60'
                          : 'bg-border',
                    )}
                  />
                ))}
              </ol>
              <p className="data-num text-xs text-muted-foreground lab:font-mono lab:text-[11.5px]">
                {t('quiz.progress', {
                  answered: answeredCount,
                  total,
                })}
              </p>
            </div>

            {current && (
              <QuestionCard
                key={current.id}
                question={current}
                index={index}
                total={total}
                difficulty={current.difficulty}
                value={answer}
                onChange={setAnswer}
                onSubmit={submit}
                onNext={next}
                busy={busy}
                evaluation={evaluation}
                isLast={nextOpenIndex(questions, answeredIds, index) === -1}
                {...(evaluation?.method === 'rubric_ai' && !evaluation.disputed && attemptId
                  ? { onDispute: () => void dispute() }
                  : {})}
                disputing={disputing}
              />
            )}

            <GenerationControls
              kind="single"
              state={checkRun.state}
              onStopNow={checkRun.stopNow}
              className="justify-end"
            />

            {evaluation?.isCorrect === null && current?.type !== 'short_answer' && (
              <Card>
                <CardContent className="p-4 text-xs text-muted-foreground">
                  {t('quiz.unverifiedNote')}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </PageContent>
    </PageContainer>
  )
}

/** The next question after `from` that has no attempt yet, or -1. */
function nextOpenIndex(questions: Question[], answered: Set<string>, from: number): number {
  for (let i = from + 1; i < questions.length; i++) {
    if (!answered.has(questions[i]!.id)) return i
  }
  return -1
}
