import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mic,
  MicOff,
  Send,
  Timer,
  TimerOff,
  XCircle,
} from 'lucide-react'
import type { Question } from '@/entities/question/types'
import type { Quiz } from '@/entities/quiz/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import {
  oralGroups,
  oralNextStep,
  oralResumePoint,
  oralTopicScores,
  type OralPosition,
} from '@/entities/question/oral'
import { buildAIServices } from '@/services/aiServices'
import type { QuizService } from '@/services/quizService'
import { loadProjectSubjectContext } from '@/services/projectSubject'
import { appendSpeechText, useSpeechInput } from '@/features/homework/useSpeechInput'
import { toast } from '@/features/toast/toastStore'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent } from '@/shared/ui/Card'
import { Label } from '@/shared/ui/Label'
import { RichText } from '@/shared/ui/RichText'
import { Textarea } from '@/shared/ui/Textarea'
import { highlightEvidence } from '@/shared/lib/evidenceHighlight'
import { cn } from '@/shared/lib/utils'
import { QuestionSource } from './QuestionSource'
import { ShortAnswerFeedback } from './ShortAnswerFeedback'
import { useTranslation } from '@/i18n'
import { isAbortError } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { GenerationControls } from '@/shared/ui/GenerationControls'

export interface OralExamSessionProps {
  projectId: string
  quiz: Quiz
  questions: Question[]
  /** Offline service: attempts, disputes. Grading uses the configured AI. */
  service: QuizService
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds)
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

/**
 * Oral-exam rehearsal: one drawn topic at a time. The student answers the
 * examiner's question (spoken or typed, optional countdown), then each
 * follow-up; every answer is graded by its scoring points. After the topic's
 * last answer: covered / missed points, the model outline, the transcript
 * with the quoted evidence marked, and a dispute button per judgement.
 */
export function OralExamSession({
  projectId,
  quiz,
  questions,
  service,
}: OralExamSessionProps): JSX.Element {
  const { t, language: uiLanguage } = useTranslation()
  const navigate = useNavigate()
  const groups = useMemo(() => oralGroups(questions), [questions])
  const [attempts, setAttempts] = useState<Map<string, QuestionAttempt>>(() => new Map())
  const [position, setPosition] = useState<OralPosition | null>(null)
  const [stage, setStage] = useState<'answer' | 'feedback'>('answer')
  const [loaded, setLoaded] = useState(false)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const checkRun = useGenerationRun({ abortOnUnmount: true })
  const [disputing, setDisputing] = useState<string | null>(null)
  const [international, setInternational] = useState(false)
  const timerSeconds = quiz.config.oral?.timerSeconds
  const [timerOn, setTimerOn] = useState(Boolean(timerSeconds))
  const [remaining, setRemaining] = useState(timerSeconds ?? 0)
  const startedAt = useRef(Date.now())

  // International medicine is examined in English; otherwise the UI language.
  const speechLanguage = international || uiLanguage !== 'zh-CN' ? 'en-US' : 'zh-CN'
  const speech = useSpeechInput(speechLanguage, (text) =>
    setAnswer((previous) => appendSpeechText(previous, text)),
  )
  const speechActive =
    speech.state === 'starting' || speech.state === 'listening' || speech.state === 'stopping'

  useEffect(() => {
    let cancelled = false
    void Promise.all([service.getAttempts(quiz.id), loadProjectSubjectContext(projectId)])
      .then(([rows, subject]) => {
        if (cancelled) return
        const byQuestion = new Map<string, QuestionAttempt>()
        for (const row of [...rows].sort((a, b) => a.createdAt - b.createdAt))
          byQuestion.set(row.questionId, row)
        setAttempts(byQuestion)
        setPosition(oralResumePoint(groups, new Set(byQuestion.keys())))
        setInternational(subject?.subject === 'medicine' && subject.examStyle === 'international')
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [service, quiz.id, projectId, groups])

  const group = position ? groups[position.groupIndex] : undefined
  const current = group && position ? [group.main, ...group.followUps][position.step] : undefined
  const onMain = position?.step === 0
  const counting = stage === 'answer' && onMain && timerOn && Boolean(timerSeconds)

  // A fresh countdown for each drawn topic's main question.
  useEffect(() => {
    setRemaining(timerSeconds ?? 0)
  }, [current?.id, timerSeconds])
  useEffect(() => {
    if (!counting || remaining <= 0) return
    const id = window.setTimeout(() => setRemaining((value) => value - 1), 1000)
    return () => window.clearTimeout(id)
  }, [counting, remaining])
  const timeUp = counting && remaining <= 0
  useEffect(() => {
    if (timeUp && speechActive) speech.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp])

  async function submit() {
    if (!current || !position || busy) return
    if (speechActive) speech.cancel()
    setBusy(true)
    try {
      // Graded point by point when an AI is configured; otherwise kept, not scored.
      const graded = (await buildAIServices())?.quiz ?? null
      // The AI check can be stopped; a stopped check submits nothing.
      const run = graded ? checkRun.start() : null
      let result
      try {
        result = await (graded ?? service).submitAnswer(quiz.id, current.id, answer, {
          durationMs: Date.now() - startedAt.current,
          ...(timeUp ? { timedOut: true } : {}),
          ...(graded ? { gradeShortAnswer: true } : {}),
          ...(run ? { signal: run.signal } : {}),
        })
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
      setAttempts((previous) => new Map(previous).set(current.id, result.attempt))
      setAnswer('')
      startedAt.current = Date.now()
      const next = oralNextStep(groups, position)
      if (next === 'feedback') setStage('feedback')
      else setPosition(next)
    } catch (err) {
      toast({ variant: 'error', title: t('quiz.gradeFailed'), description: friendlyAIError(err) })
    } finally {
      setBusy(false)
    }
  }

  async function dispute(attempt: QuestionAttempt) {
    setDisputing(attempt.id)
    try {
      const updated = await service.disputeAttempt(attempt.id)
      setAttempts((previous) => new Map(previous).set(updated.questionId, updated))
    } catch (err) {
      toast({
        variant: 'error',
        title: t('shortAnswer.disputeFailed'),
        description: (err as Error).message,
      })
    } finally {
      setDisputing(null)
    }
  }

  function nextTopic() {
    const next = oralResumePoint(groups, new Set(attempts.keys()))
    if (!next) {
      navigate(`/projects/${projectId}/quiz/${quiz.id}/result`)
      return
    }
    setPosition(next)
    setStage('answer')
    startedAt.current = Date.now()
  }

  if (!loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('quiz.loadingQuiz')}
      </p>
    )
  }
  if (!group || !position || !current) {
    return (
      <Button onClick={() => navigate(`/projects/${projectId}/quiz/${quiz.id}/result`)}>
        {t('oral.seeResults')}
      </Button>
    )
  }

  const topicHeader = (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="data-num lab:font-mono">
        {t('oral.topicOf', { index: position.groupIndex + 1, total: groups.length })}
      </span>
      <span aria-hidden>·</span>
      <span className="break-words font-medium text-foreground">{group.topic}</span>
      {group.main.origin === 'ai_without_source' && (
        <Badge variant="outline">{t('oral.aiWithoutSource')}</Badge>
      )}
    </div>
  )

  if (stage === 'feedback') {
    const score = oralTopicScores([group.main, ...group.followUps], [...attempts.values()])[0]
    const isLast = oralResumePoint(groups, new Set(attempts.keys())) === null
    return (
      <div className="space-y-5">
        {topicHeader}
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-sm font-medium">{t('oral.feedbackTitle')}</p>
            {score && score.percentage !== null ? (
              <p className="data-num text-2xl font-semibold lecture:font-heading lab:font-mono">
                {t('oral.topicScore', {
                  earned: score.earned,
                  total: score.total,
                  percent: score.percentage,
                })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('oral.notScored')}</p>
            )}
            {score && score.unscored > 0 && score.percentage !== null && (
              <p className="text-xs text-muted-foreground">
                {t('oral.unscored', { count: score.unscored })}
              </p>
            )}
          </CardContent>
        </Card>

        {[group.main, ...group.followUps].map((question, i) => {
          const attempt = attempts.get(question.id)
          const evaluation = attempt?.evaluation
          const evidence = (evaluation?.rubric ?? [])
            .map((point) => point.evidence)
            .filter((item): item is string => Boolean(item))
          return (
            <section
              key={question.id}
              aria-label={i === 0 ? t('oral.mainQuestion') : t('oral.followUpN', { index: i })}
              className="space-y-3 border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground lab:font-mono">
                {i === 0 ? t('oral.mainQuestion') : t('oral.followUpN', { index: i })}
              </p>
              <RichText
                text={question.prompt}
                format="markdown"
                paragraphClassName="text-sm font-medium leading-[1.7]"
              />
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t('oral.transcript')}</p>
                <p className="whitespace-pre-wrap break-words rounded-lg border bg-card p-3 text-sm leading-relaxed lab:rounded-none">
                  {attempt?.userAnswer.trim()
                    ? highlightEvidence(attempt.userAnswer, evidence).map((segment, index) =>
                        segment.mark ? (
                          <mark
                            key={index}
                            className="rounded-sm bg-primary/15 px-0.5 text-foreground"
                          >
                            {segment.text}
                          </mark>
                        ) : (
                          <span key={index}>{segment.text}</span>
                        ),
                      )
                    : attempt?.timedOut
                      ? t('quiz.timedOutBlank')
                      : t('quizResult.blank')}
                </p>
                {evidence.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t('oral.evidenceLegend')}</p>
                )}
              </div>
              {evaluation && (
                <ShortAnswerFeedback
                  evaluation={evaluation}
                  {...(attempt && evaluation.method === 'rubric_ai' && !evaluation.disputed
                    ? { onDispute: () => void dispute(attempt) }
                    : {})}
                  disputing={disputing === attempt?.id}
                />
              )}
              {i === 0 && (
                <QuestionSource
                  sourceRefs={question.sourceRefs}
                  projectId={projectId}
                  aiWithoutSource={question.origin === 'ai_without_source'}
                />
              )}
            </section>
          )
        })}

        <div className="flex justify-end">
          <Button onClick={nextTopic}>
            {isLast ? t('oral.seeResults') : t('oral.nextTopic')}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  const answerId = `oral-answer-${current.id}`
  return (
    <div className="space-y-5">
      {topicHeader}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground lab:font-mono">
              {onMain
                ? t('oral.mainQuestion')
                : t('oral.followUpOf', { index: position.step, total: group.followUps.length })}
            </p>
            {onMain && timerSeconds ? (
              <div className="flex items-center gap-2">
                {timerOn && (
                  <span
                    role="timer"
                    aria-live="off"
                    className={cn(
                      'data-num font-mono text-sm tabular-nums',
                      remaining <= 30 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {formatClock(remaining)}
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setTimerOn((on) => !on)}
                  aria-pressed={!timerOn}
                >
                  {timerOn ? <TimerOff className="h-4 w-4" /> : <Timer className="h-4 w-4" />}
                  {timerOn ? t('oral.timerOff') : t('oral.timerOn')}
                </Button>
              </div>
            ) : null}
          </div>
          <RichText
            text={current.prompt}
            format="markdown"
            paragraphClassName="text-base font-medium leading-[1.7] lecture:font-heading lecture:text-lg"
          />
          {timeUp && (
            <p role="status" className="text-sm text-destructive">
              {t('oral.timeUp')}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor={answerId}>{t('oral.answerLabel')}</Label>
            <Textarea
              id={answerId}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void submit()
                }
              }}
              rows={onMain ? 12 : 5}
              placeholder={onMain ? t('oral.answerPlaceholder') : t('oral.followUpPlaceholder')}
              disabled={busy}
              lang={speechLanguage}
              className="text-base leading-relaxed"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => (speechActive ? speech.stop() : speech.start())}
                disabled={!speech.supported || busy || speech.state === 'stopping'}
                aria-pressed={speechActive}
              >
                {speechActive ? <MicOff aria-hidden /> : <Mic aria-hidden />}
                {speechActive ? t('oral.speechStop') : t('oral.speechStart')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('oral.speechLanguage', {
                  language: speechLanguage === 'en-US' ? 'English' : '中文',
                })}
              </span>
              <Button
                type="button"
                className="ml-auto"
                onClick={() => void submit()}
                disabled={busy || speechActive}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {busy ? t('oral.grading') : t('oral.submit')}
              </Button>
              <GenerationControls
                kind="single"
                state={checkRun.state}
                onStopNow={checkRun.stopNow}
              />
            </div>
            <p
              role="status"
              className={cn('text-xs', speech.error ? 'text-destructive' : 'text-muted-foreground')}
            >
              {!speech.supported
                ? t('oral.speechUnsupported')
                : speech.error
                  ? t(`homework.speechError.${speech.error}`)
                  : speech.state === 'listening'
                    ? t('oral.speechListening')
                    : speech.state === 'starting'
                      ? t('homework.speechStarting')
                      : speech.state === 'stopping'
                        ? t('homework.speechStopping')
                        : t('oral.hint')}
            </p>
          </div>
        </CardContent>
      </Card>
      {/* Answered parts of this topic so far, without their grades. */}
      {!onMain && (
        <ol className="space-y-1 text-xs text-muted-foreground">
          {[group.main, ...group.followUps].slice(0, position.step).map((question) => (
            <li key={question.id} className="flex items-center gap-1.5">
              {attempts.get(question.id) ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <span className="truncate">{question.prompt}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
