import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Loader2,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { buildOfflineQuizService, buildAIServices } from '@/services/aiServices'
import type { Quiz } from '@/entities/quiz/types'
import type { Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'

type MoreMode = 'same_topic' | 'similar' | 'harder' | 'easier' | 'weakness'

const MORE_OPTIONS: Array<{ mode: MoreMode; label: string; hint: string }> = [
  { mode: 'same_topic', label: 'Same topic', hint: 'Another set on this topic' },
  { mode: 'similar', label: 'Similar questions', hint: 'Same knowledge points' },
  { mode: 'harder', label: 'Harder', hint: 'One level up' },
  { mode: 'easier', label: 'Easier', hint: 'One level down' },
  { mode: 'weakness', label: 'Weakness training', hint: 'Targets your weakest points' },
]

export function QuizResultPage(): JSX.Element {
  const { id: projectId, quizId } = useParams<{ id: string; quizId: string }>()
  const navigate = useNavigate()
  const service = useMemo(() => buildOfflineQuizService(), [])
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [attempts, setAttempts] = useState<QuestionAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMistakes, setShowMistakes] = useState(false)
  const [moreBusy, setMoreBusy] = useState<MoreMode | null>(null)

  useEffect(() => {
    if (!quizId) return
    let cancelled = false
    void (async () => {
      try {
        const [q, qs, at] = await Promise.all([
          service.getQuiz(quizId),
          service.getQuestions(quizId),
          service.getAttempts(quizId),
        ])
        if (cancelled) return
        setQuiz(q)
        setQuestions(qs)
        setAttempts(at)
      } catch (err) {
        if (!cancelled) setError(friendlyAIError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quizId, service])

  async function generateMore(mode: MoreMode) {
    if (!quizId || !projectId) return
    setMoreBusy(mode)
    try {
      const bundle = await buildAIServices()
      if (!bundle) {
        toast({ variant: 'error', title: 'Configure AI provider first' })
        return
      }
      const next = await bundle.quiz.generateMore(quizId, mode)
      await bundle.quiz.startQuiz(next.id)
      toast({ variant: 'success', title: 'New quiz ready' })
      navigate(`/projects/${projectId}/quiz/${next.id}`)
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: 'Could not generate more questions', description: msg })
    } finally {
      setMoreBusy(null)
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label="Loading results" />
        </PageContent>
      </PageContainer>
    )
  }

  if (error || !quiz || !quiz.score) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title="Results unavailable"
            description={error ?? 'This quiz has not been completed yet.'}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/quiz`}>Back to quizzes</Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  const score = quiz.score
  const attemptByQuestion = new Map(attempts.map((a) => [a.questionId, a]))
  const mistakes = questions.filter((q) => {
    const a = attemptByQuestion.get(q.id)
    return a && a.evaluation.isCorrect === false
  })
  const unverified = questions.filter((q) => {
    const a = attemptByQuestion.get(q.id)
    return !a || a.evaluation.isCorrect === null
  })

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label="Back to quizzes">
              <Link to={`/projects/${projectId}/quiz`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            Results
          </div>
        }
        description={quiz.title}
        actions={
          <Button variant="outline" asChild>
            <Link to={`/projects/${projectId}/mastery`}>Knowledge Mastery</Link>
          </Button>
        }
      />
      <PageContent className="space-y-6">
        <Card>
          <CardContent className="grid gap-6 p-6 sm:grid-cols-[160px_1fr] sm:items-center">
            <div className="text-center">
              <div className="text-4xl font-semibold tabular-nums">{score.percentage}%</div>
              <div className="text-xs text-muted-foreground">Score</div>
            </div>
            <div className="space-y-3">
              <Progress value={score.percentage} />
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> {score.correct} correct
                </span>
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="h-4 w-4" /> {score.wrong} wrong
                </span>
                <span className="flex items-center gap-1 text-amber-600">
                  <HelpCircle className="h-4 w-4" /> {score.unverified} unverified
                </span>
                <span className="text-muted-foreground">of {score.total}</span>
              </div>
              {score.unverified > 0 && (
                <p className="text-xs text-muted-foreground">
                  Unverified answers could not be graded automatically and are excluded from the score.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {score.weakKnowledgePoints.length > 0 && (
          <Card className="border-amber-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingDown className="h-4 w-4 text-amber-600" />
                Weak knowledge points
              </CardTitle>
              <CardDescription>Below 60% accuracy in this quiz — good candidates for review.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {score.weakKnowledgePoints.map((kp) => (
                <Badge key={kp} variant="outline">
                  {kp}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By knowledge point</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {score.byKnowledgePoint.length === 0 ? (
                <p className="text-xs text-muted-foreground">No data.</p>
              ) : (
                score.byKnowledgePoint.map((k) => {
                  const gradable = k.correct + k.wrong
                  const pct = gradable > 0 ? Math.round((k.correct / gradable) * 100) : 0
                  return (
                    <div key={k.knowledgePoint} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{k.knowledgePoint}</span>
                        <span className="tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By difficulty</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(score.byDifficulty).length === 0 ? (
                <p className="text-xs text-muted-foreground">No data.</p>
              ) : (
                Object.entries(score.byDifficulty).map(([difficulty, stat]) => {
                  const gradable = stat.correct + stat.wrong
                  const pct = gradable > 0 ? Math.round((stat.correct / gradable) * 100) : 0
                  return (
                    <div key={difficulty} className="space-y-1">
                      <div className="flex items-center justify-between text-sm capitalize">
                        <span>{difficulty}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {stat.correct}/{stat.total}
                        </span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        {mistakes.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Mistakes ({mistakes.length})</CardTitle>
                <CardDescription>Review what went wrong before moving on.</CardDescription>
              </div>
              <Button variant="outline" onClick={() => setShowMistakes((s) => !s)}>
                {showMistakes ? 'Hide' : 'Review mistakes'}
              </Button>
            </CardHeader>
            {showMistakes && (
              <CardContent className="space-y-3">
                {mistakes.map((q) => {
                  const attempt = attemptByQuestion.get(q.id)!
                  return (
                    <div key={q.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{q.knowledgePoint}</Badge>
                        <Badge variant="outline">{q.type.replace('_', ' ')}</Badge>
                        <Badge variant="outline">{attempt.difficulty}</Badge>
                      </div>
                      <p className="mt-2 font-medium">{q.prompt}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Your answer: <span className="font-mono">{attempt.userAnswer || '(blank)'}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Expected: <span className="font-mono">{attempt.evaluation.expected ?? q.correctAnswer}</span>
                      </p>
                      {q.solution && (
                        <p className="mt-1 text-xs text-muted-foreground">Solution: {q.solution}</p>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            )}
          </Card>
        )}

        {unverified.length > 0 && (
          <Card className="border-amber-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                Unverified answers ({unverified.length})
              </CardTitle>
              <CardDescription>
                The system could not grade these automatically. Compare your answer with the expected one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {unverified.map((q) => {
                const attempt = attemptByQuestion.get(q.id)
                return (
                  <div key={q.id} className="rounded-md border p-2">
                    <p className="font-medium">{q.prompt}</p>
                    <p className="text-xs text-muted-foreground">
                      Your answer: <span className="font-mono">{attempt?.userAnswer ?? '(blank)'}</span> · Expected:{' '}
                      <span className="font-mono">{q.correctAnswer}</span>
                    </p>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              More questions
            </CardTitle>
            <CardDescription>Keep practising with a follow-up quiz.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MORE_OPTIONS.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                disabled={moreBusy !== null}
                onClick={() => generateMore(opt.mode)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent/50 disabled:opacity-60',
                )}
              >
                <span className="flex w-full items-center gap-2 font-medium">
                  {opt.label}
                  {moreBusy === opt.mode ? (
                    <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{opt.hint}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {questions.length === 0 && (
          <EmptyState title="No questions" description="This quiz has no questions to review." />
        )}
      </PageContent>
    </PageContainer>
  )
}