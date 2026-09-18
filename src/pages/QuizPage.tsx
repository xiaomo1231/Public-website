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
import { buildOfflineQuizService } from '@/services/aiServices'
import type { Question } from '@/entities/question/types'
import type { Quiz } from '@/entities/quiz/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'
import { useTranslation } from '@/i18n'

export function QuizPage(): JSX.Element {
  const { id: projectId, quizId } = useParams<{ id: string; quizId: string }>()
  const navigate = useNavigate()
  const service = useMemo(() => buildOfflineQuizService(), [])
  const { t } = useTranslation()

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState<QuestionEvaluation | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number>(Date.now())

  useEffect(() => {
    if (!quizId) return
    let cancelled = false
    void (async () => {
      try {
        const q = await service.getQuiz(quizId)
        const qs = await service.getQuestions(quizId)
        if (cancelled) return
        setQuiz(q)
        setQuestions(qs)
        if (q.status === 'completed') {
          navigate(`/projects/${projectId}/quiz/${quizId}/result`, { replace: true })
        }
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

  async function submit() {
    if (!quizId || !current) return
    setBusy(true)
    try {
      const result = await service.submitAnswer(quizId, current.id, answer, {
        durationMs: Date.now() - startedAt,
      })
      setEvaluation(result.evaluation)
    } catch (err) {
      toast({ variant: 'error', title: t('quiz.gradeFailed'), description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  function next() {
    setEvaluation(null)
    setAnswer('')
    setStartedAt(Date.now())
    if (index + 1 >= questions.length) {
      navigate(`/projects/${projectId}/quiz/${quizId}/result`)
      return
    }
    setIndex((i) => i + 1)
  }

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('quiz.loadingQuiz')} />
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
        description={t('quiz.instructions')}
      />
      <PageContent className="space-y-4">
        <div className="space-y-1">
          <Progress value={((index + (evaluation ? 1 : 0)) / questions.length) * 100} />
          <p className="text-xs text-muted-foreground">
            {t('quiz.progress', {
              answered: index + (evaluation ? 1 : 0),
              total: questions.length,
            })}
          </p>
        </div>

        {current && (
          <QuestionCard
            question={current}
            index={index}
            total={questions.length}
            difficulty={quiz.difficultyPlan[index] ?? current.difficulty}
            value={answer}
            onChange={setAnswer}
            onSubmit={submit}
            onNext={next}
            busy={busy}
            evaluation={evaluation}
            isLast={index + 1 >= questions.length}
          />
        )}

        {evaluation?.isCorrect === null && (
          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground">
              {t('quiz.unverifiedNote')}
            </CardContent>
          </Card>
        )}
      </PageContent>
    </PageContainer>
  )
}