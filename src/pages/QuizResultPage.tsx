import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  BookX,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { RichText } from '@/shared/ui/RichText'
import { EmptyState } from '@/shared/ui/EmptyState'
import { ErrorState } from '@/shared/ui/ErrorState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { buildOfflineQuizService, buildAIServices } from '@/services/aiServices'
import { scoreQuiz } from '@/services/quizService'
import { QuestionSource } from '@/widgets/quiz/QuestionSource'
import { OralTopicScores } from '@/widgets/quiz/OralTopicScores'
import { ProjectFlowNav } from '@/widgets/project/ProjectFlowNav'
import { knowledgeStatPercent, type Quiz } from '@/entities/quiz/types'
import {
  QUESTION_TYPE_LABEL_KEYS,
  displayAnswer,
  expectedAnswerText as expectedText,
  type Question,
} from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'
import { difficultyLabelKey } from '@/infrastructure/ai/prompts/types'

type MoreMode = 'same_topic' | 'similar' | 'harder' | 'easier' | 'weakness'

const MORE_OPTIONS: Array<{ mode: MoreMode; labelKey: TranslationKey; hintKey: TranslationKey }> = [
  {
    mode: 'same_topic',
    labelKey: 'quizResult.followUp.sameTopic',
    hintKey: 'quizResult.followUp.sameTopicHint',
  },
  {
    mode: 'similar',
    labelKey: 'quizResult.followUp.similar',
    hintKey: 'quizResult.followUp.similarHint',
  },
  {
    mode: 'harder',
    labelKey: 'quizResult.followUp.harder',
    hintKey: 'quizResult.followUp.harderHint',
  },
  {
    mode: 'easier',
    labelKey: 'quizResult.followUp.easier',
    hintKey: 'quizResult.followUp.easierHint',
  },
  {
    mode: 'weakness',
    labelKey: 'quizResult.followUp.weakness',
    hintKey: 'quizResult.followUp.weaknessHint',
  },
]

export function QuizResultPage(): JSX.Element {
  const { id: projectId, quizId } = useParams<{ id: string; quizId: string }>()
  const navigate = useNavigate()
  const service = useMemo(() => buildOfflineQuizService(), [])
  const { t } = useTranslation()
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
          service.getQuiz(quizId, projectId),
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
  }, [quizId, projectId, service])

  async function generateMore(mode: MoreMode) {
    if (!quizId || !projectId) return
    setMoreBusy(mode)
    try {
      const bundle = await buildAIServices()
      if (!bundle) {
        toast({ variant: 'error', title: t('quizResult.noProvider') })
        return
      }
      const next = await bundle.quiz.generateMore(quizId, mode)
      await bundle.quiz.startQuiz(next.id)
      toast({ variant: 'success', title: t('quizResult.newReady') })
      navigate(`/projects/${projectId}/quiz/${next.id}`)
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: t('quizResult.generateFailed'), description: msg })
    } finally {
      setMoreBusy(null)
    }
  }

  if (!projectId) return <div />

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('quizResult.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  if (error || !quiz || !quiz.score) {
    return (
      <PageContainer>
        <PageContent>
          <ErrorState
            title={t('quizResult.unavailable')}
            description={error ?? t('quizResult.notCompleted')}
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/quiz`}>{t('quizResult.backToQuizzes')}</Link>
              </Button>
            }
          />
        </PageContent>
      </PageContainer>
    )
  }

  // Recomputed from the attempts (pure, cheap): a score saved by an older
  // version — e.g. an oral quiz averaged per question — matches the details.
  const score = scoreQuiz(quiz, attempts)
  const attemptByQuestion = new Map(attempts.map((a) => [a.questionId, a]))
  // A disputed short answer is not scored: it is listed with the unverified ones.
  const mistakes = questions.filter((q) => {
    const a = attemptByQuestion.get(q.id)
    return a && a.evaluation.isCorrect === false && !a.evaluation.disputed
  })
  const unverified = questions.filter((q) => {
    const a = attemptByQuestion.get(q.id)
    return !a || a.evaluation.isCorrect === null || a.evaluation.disputed
  })

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('quizResult.backToQuizzes')}>
              <Link to={`/projects/${projectId}/quiz`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            {t('quizResult.title')}
          </div>
        }
        description={quiz.title}
        nav={<ProjectFlowNav projectId={projectId} active="quiz" />}
        actions={
          <Button variant="outline" asChild>
            <Link to={`/projects/${projectId}/mastery`}>{t('quizResult.mastery')}</Link>
          </Button>
        }
      />
      <PageContent className="space-y-6">
        {/*
          The result moment: the score rises in once, its bar sweeps to the score.
          lecture: a big serif figure beside a booktabs-ruled list.
          lab: a readout strip of hairline cells.
        */}
        <Card className="animate-rise overflow-hidden">
          <CardContent className="grid gap-6 p-6 lab:gap-0 lab:p-0 sm:grid-cols-[180px_1fr] sm:items-center lab:sm:grid-cols-[200px_1fr] lab:sm:items-stretch">
            <div className="text-center lab:flex lab:flex-col lab:border-b lab:p-4 lab:text-left lab:sm:border-b-0 lab:sm:border-r">
              <div className="data-num text-4xl font-semibold lecture:font-heading lecture:text-6xl lecture:font-bold lecture:tracking-tight lab:order-2 lab:mt-1.5 lab:font-mono lab:text-[32px] lab:font-medium">
                {score.percentage}
                <span className="lecture:text-3xl lecture:text-muted-foreground lab:text-base lab:text-muted-foreground">
                  %
                </span>
              </div>
              <div className="text-xs text-muted-foreground lecture:mt-1 lecture:text-sm lab:order-1 lab:font-mono lab:text-[10.5px] lab:uppercase lab:tracking-wider">
                {t('quizResult.score')}
              </div>
              <Progress
                value={score.percentage}
                reveal
                className="mt-3 hidden h-1 rounded-none lab:order-3 lab:block"
              />
            </div>
            <div className="space-y-3 lab:space-y-0">
              <Progress value={score.percentage} reveal className="lab:hidden" />
              <dl className="text-sm lecture:border-y-2 lecture:border-foreground/70 lab:grid lab:h-full lab:grid-cols-2 lab:sm:grid-cols-4">
                {[
                  {
                    key: 'correct',
                    icon: <CheckCircle2 className="h-4 w-4" />,
                    tone: 'text-emerald-600',
                    label: t('question.correct'),
                    value: score.correct,
                  },
                  {
                    key: 'wrong',
                    icon: <XCircle className="h-4 w-4" />,
                    tone: 'text-destructive',
                    label: t('question.incorrect'),
                    value: score.wrong,
                  },
                  {
                    key: 'unverified',
                    icon: <HelpCircle className="h-4 w-4" />,
                    tone: 'text-amber-600',
                    label: t('question.unverified'),
                    value: score.unverified,
                  },
                  score.rubricPoints
                    ? {
                        // Oral: the same pooled points as the per-topic scores.
                        key: 'points',
                        icon: null,
                        tone: 'text-muted-foreground',
                        label: t('quizResult.oralPointsLabel'),
                        value: t('quizResult.scoreLine', {
                          correct: score.rubricPoints.earned,
                          total: score.rubricPoints.total,
                        }),
                      }
                    : {
                        key: 'points',
                        icon: null,
                        tone: 'text-muted-foreground',
                        label: t('quizResult.pointsLabel'),
                        value: t('quizResult.scoreLine', {
                          // Partial credit from short answers (3 of 5 points → 0.6).
                          correct: Math.round((score.points ?? score.correct) * 100) / 100,
                          total: score.total,
                        }),
                      },
                ].map((row) => (
                  <div
                    key={row.key}
                    className="flex min-w-0 items-center justify-between gap-3 py-1.5 lecture:border-b lecture:border-border lecture:py-2 lecture:last:border-b-0 lab:flex-col lab:items-start lab:justify-start lab:gap-1.5 lab:border-b lab:p-4 lab:sm:border-b-0 lab:[&:not(:last-child)]:border-r"
                  >
                    <dt
                      className={cn(
                        'flex items-center gap-1.5 lab:font-mono lab:text-[10.5px] lab:uppercase lab:tracking-wider lab:text-muted-foreground',
                        row.tone,
                      )}
                    >
                      <span className="lab:hidden">{row.icon}</span>
                      {row.label}
                    </dt>
                    <dd className="data-num min-w-0 max-w-full break-words font-medium tabular-nums lecture:font-heading lab:font-mono lab:text-[clamp(15px,2.2vw,22px)] lab:leading-tight">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {score.unverified > 0 && (
                <p className="text-xs text-muted-foreground lab:border-t lab:px-4 lab:py-2.5">
                  {t('quizResult.unverifiedNote')}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t('quizResult.nextTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('quizResult.nextHint')}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {mistakes.length > 0 && (
                <Button asChild>
                  <Link to={`/projects/${projectId}/mistakes`}>
                    <BookX className="h-4 w-4" />
                    {t('quizResult.openMistakeBook')}
                  </Link>
                </Button>
              )}
              <Button asChild variant={mistakes.length > 0 ? 'outline' : 'default'}>
                <Link to={`/projects/${projectId}/tutor`}>
                  <Sparkles className="h-4 w-4" />
                  {t('quizResult.backToTutor')}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {quiz.config.mode === 'oral' && (
          <OralTopicScores questions={questions} attempts={attempts} />
        )}

        {score.weakKnowledgePoints.length > 0 && (
          <Card className="border-amber-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingDown className="h-4 w-4 text-amber-600" />
                {t('quizResult.weakPoints')}
              </CardTitle>
              <CardDescription>{t('quizResult.weakPointsHint')}</CardDescription>
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
              <CardTitle className="text-base lecture:font-heading">
                {t('quizResult.byKnowledgePoint')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 lab:space-y-0">
              {score.byKnowledgePoint.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('quizResult.noData')}</p>
              ) : (
                score.byKnowledgePoint.map((k) => {
                  // Same basis as the overall score (partial short-answer credit).
                  const pct = knowledgeStatPercent(k) ?? 0
                  return (
                    <div key={k.knowledgePoint} className={RULE_ROW}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{k.knowledgePoint}</span>
                        <span className="tabular-nums text-muted-foreground lab:font-mono lab:text-xs">
                          {pct}%
                        </span>
                      </div>
                      <Progress value={pct} className="h-1.5 lab:h-1 lab:rounded-none" />
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base lecture:font-heading">
                {t('quizResult.byDifficulty')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 lab:space-y-0">
              {quiz.bank && questions.length > 0 && (
                <div className="space-y-1 pb-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('quizResult.difficultyPath')}
                  </p>
                  <p className="text-sm lab:font-mono lab:text-xs">
                    {questions
                      .map((question) => t(difficultyLabelKey(question.difficulty)))
                      .join(' → ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('quizResult.difficultyPathHint')}
                  </p>
                </div>
              )}
              {Object.entries(score.byDifficulty).length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('quizResult.noData')}</p>
              ) : (
                Object.entries(score.byDifficulty).map(([difficulty, stat]) => {
                  const gradable = stat.correct + stat.wrong
                  const pct = gradable > 0 ? Math.round((stat.correct / gradable) * 100) : 0
                  return (
                    <div key={difficulty} className={RULE_ROW}>
                      <div className="flex items-center justify-between text-sm capitalize">
                        <span>{t(difficultyLabelKey(difficulty))}</span>
                        <span className="tabular-nums text-muted-foreground lab:font-mono lab:text-xs">
                          {stat.correct}/{stat.total}
                        </span>
                      </div>
                      <Progress value={pct} className="h-1.5 lab:h-1 lab:rounded-none" />
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
                <CardTitle className="text-base">
                  {t('quizResult.mistakes', { count: mistakes.length })}
                </CardTitle>
                <CardDescription>{t('quizResult.mistakesHint')}</CardDescription>
              </div>
              <Button variant="outline" onClick={() => setShowMistakes((s) => !s)}>
                {showMistakes ? t('quizResult.hide') : t('quizResult.reviewMistakes')}
              </Button>
            </CardHeader>
            {showMistakes && (
              <CardContent className="space-y-3">
                {mistakes.map((q) => {
                  const attempt = attemptByQuestion.get(q.id)!
                  return (
                    <div key={q.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{q.knowledgePoint}</Badge>
                        <Badge variant="outline">{t(QUESTION_TYPE_LABEL_KEYS[q.type])}</Badge>
                        <Badge variant="outline">{t(difficultyLabelKey(attempt.difficulty))}</Badge>
                      </div>
                      <RichText
                        text={q.prompt}
                        format="markdown"
                        className="mt-2"
                        paragraphClassName="text-sm font-medium leading-[1.7]"
                      />
                      {attempt.evaluation.score && attempt.evaluation.score.total > 0 && (
                        <p className="data-num mt-1 text-xs font-medium">
                          {t('shortAnswer.score', {
                            earned: attempt.evaluation.score.earned,
                            total: attempt.evaluation.score.total,
                            percent: Math.round(
                              (attempt.evaluation.score.earned / attempt.evaluation.score.total) *
                                100,
                            ),
                          })}
                        </p>
                      )}
                      <AnswerText
                        className="mt-1"
                        text={t('quizResult.yourAnswer', {
                          value: attempt.timedOut
                            ? t('quiz.timedOutBlank')
                            : displayAnswer(q, attempt.userAnswer) || t('quizResult.blank'),
                        })}
                      />
                      <AnswerText
                        text={t('quizResult.expected', {
                          value: attempt.evaluation.expected ?? expectedText(q),
                        })}
                      />
                      {q.solution && (
                        <AnswerText
                          className="mt-1"
                          text={t('quizResult.solution', { value: q.solution })}
                        />
                      )}
                      <div className="mt-2">
                        <QuestionSource
                          sourceRefs={q.sourceRefs}
                          projectId={q.projectId}
                          aiWithoutSource={q.origin === 'ai_without_source'}
                        />
                      </div>
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
                {t('quizResult.unverifiedAnswers', { count: unverified.length })}
              </CardTitle>
              <CardDescription>{t('quizResult.unverifiedAnswersHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {unverified.map((q) => {
                const attempt = attemptByQuestion.get(q.id)
                return (
                  <div key={q.id} className="rounded-lg border p-2">
                    <RichText
                      text={q.prompt}
                      format="markdown"
                      paragraphClassName="text-sm font-medium leading-[1.7]"
                    />
                    <AnswerText
                      text={t('quizResult.yourAnswer', {
                        value:
                          (attempt && displayAnswer(q, attempt.userAnswer)) ||
                          t('quizResult.blank'),
                      })}
                    />
                    <AnswerText text={t('quizResult.expected', { value: expectedText(q) })} />
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
              {t('quizResult.moreQuestions')}
            </CardTitle>
            <CardDescription>{t('quizResult.moreQuestionsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MORE_OPTIONS.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                disabled={moreBusy !== null}
                onClick={() => generateMore(opt.mode)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent/50 disabled:opacity-60',
                )}
              >
                <span className="flex w-full items-center gap-2 font-medium">
                  {t(opt.labelKey)}
                  {moreBusy === opt.mode ? (
                    <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{t(opt.hintKey)}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {questions.length === 0 && (
          <EmptyState
            title={t('quizResult.noQuestions')}
            description={t('quizResult.noQuestionsHint')}
          />
        )}
      </PageContent>
    </PageContainer>
  )
}

/**
 * An answer / reference line. Answers and references often carry `$…$` math
 * (matrices, fractions), so they go through RichText instead of plain text;
 * wide display math scrolls inside the line rather than being clipped.
 */
function AnswerText({ text, className }: { text: string; className?: string }): JSX.Element {
  return (
    <RichText
      text={text}
      format="markdown"
      className={cn('max-w-full space-y-1 overflow-x-auto', className)}
      paragraphClassName="text-xs leading-[1.7] text-muted-foreground"
    />
  )
}

/** A ruled row: booktabs-style rules in lecture, hairline table rows in lab. */
const RULE_ROW =
  'space-y-1 border-b border-border/70 pb-2 last:border-b-0 last:pb-0 lab:space-y-1.5 lab:border-border lab:py-2.5 lab:last:pb-0 lab:first:pt-0'
