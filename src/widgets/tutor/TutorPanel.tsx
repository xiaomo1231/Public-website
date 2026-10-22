import { targetLanguageOf } from '@/shared/lib/language'
import type { ContentLanguage } from '@/entities/user/types'
import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Lightbulb,
  Loader2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { MathField } from '@/widgets/mathInput/MathField'
import { ShortAnswerFeedback } from '@/widgets/quiz/ShortAnswerFeedback'
import { useProject } from '@/features/project/useProjects'
import { LoadingState } from '@/shared/ui/LoadingState'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { RichText } from '@/shared/ui/RichText'
import { toast } from '@/features/toast/toastStore'
import { cn } from '@/shared/lib/utils'
import { LESSON_PROSE_CLASS } from '@/widgets/tutor/lessonStyle'
import { useTranslation } from '@/i18n'
import { buildAIServices } from '@/services/aiServices'
import {
  difficultyLabelKey,
  type DifficultyLevel,
  type TutorEvaluation,
} from '@/infrastructure/ai/prompts/types'
import {
  TURN_KIND_LABEL_KEYS,
  type TutorQuestion,
  type TutorSession,
  type TutorTurn,
} from '@/entities/tutorSession/types'
import { findResumableSession, type TutorService } from '@/services/tutorService'
import { noProviderInfo, tutorErrorInfo, type TutorErrorInfo } from '@/features/tutor/tutorErrors'
import { TutorErrorNotice } from '@/widgets/tutor/TutorErrorNotice'
import { isAbortError } from '@/shared/lib/generationControl'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { formatPercent } from '@/shared/lib/percent'

export interface TutorPanelProps {
  projectId: string
  topicId: string
  topicName: string
  topicDescription: string
  language: ContentLanguage
  difficulty?: DifficultyLevel
  onClose?: () => void
}

interface TutorBundle {
  tutor: TutorService
}

async function buildTutorBundle(): Promise<TutorBundle | null> {
  const ai = await buildAIServices()
  if (!ai) return null
  return { tutor: ai.tutor }
}

export function TutorPanel(props: TutorPanelProps): JSX.Element {
  const { t } = useTranslation()
  const { project } = useProject(props.projectId)
  const [session, setSession] = useState<TutorSession | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  /** Fatal: the tutor itself could not open. */
  const [error, setError] = useState<TutorErrorInfo | null>(null)
  /** Non-fatal: the lesson is open but an action failed. */
  const [actionError, setActionErrorState] = useState<TutorErrorInfo | null>(null)
  /** What "Try again" re-runs for `actionError`. */
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null)
  /** Bumped by the fatal error's "Try again" to reopen the tutor. */
  const [attempt, setAttempt] = useState(0)
  /** Showing an earlier conversation without a configured AI provider. */
  const [noProvider, setNoProvider] = useState(false)
  /** Turns the resumed conversation already had when the page opened. */
  const [earlierTurns, setEarlierTurns] = useState<TutorTurn[]>([])
  const [revealedHints, setRevealedHints] = useState(0)
  const [lastQuestion, setLastQuestion] = useState<TutorQuestion | undefined>()
  const [lastEvaluation, setLastEvaluation] = useState<TutorEvaluation | undefined>()
  const [intro, setIntro] = useState('')
  /** The student stopped the last request; nothing was recorded for it. */
  const [stopped, setStopped] = useState(false)
  // Every tutor turn is one request: Stop aborts it, leaving the page aborts it.
  const generation = useGenerationRun({ abortOnUnmount: true })

  /**
   * One action at a time. Set synchronously, before the first await, so a
   * double click or a double Enter cannot start a second grading / question.
   */
  const actionInFlight = useRef(false)
  async function exclusive(action: () => Promise<void>): Promise<void> {
    if (actionInFlight.current) return
    actionInFlight.current = true
    try {
      await action()
    } finally {
      actionInFlight.current = false
    }
  }

  function setActionError(info: TutorErrorInfo | null, retry?: () => void): void {
    setActionErrorState(info)
    setRetryAction(() => (info && retry ? retry : null))
  }

  /** The AI is needed for this action; without a provider say so (with a Settings link). */
  async function requireBundle(): Promise<TutorBundle | null> {
    const bundle = await buildTutorBundle()
    if (!bundle) {
      setNoProvider(true)
      setActionError(noProviderInfo())
    }
    return bundle
  }

  useEffect(() => {
    let cancelled = false
    setError(null)
    // Unmounting (topic or language change) cancels the in-flight
    // introduction / first question instead of paying for a hidden run.
    const run = generation.start()
    void (async () => {
      try {
        setBusy(true)
        const bundle = await buildTutorBundle()
        if (cancelled) return
        if (!bundle) {
          // Reading an earlier conversation needs no AI: show it, and say
          // that continuing needs a provider.
          const earlier = await findResumableSession({
            projectId: props.projectId,
            topicId: props.topicId,
            language: props.language,
          })
          if (cancelled) return
          if (!earlier) {
            setError(noProviderInfo())
            return
          }
          setNoProvider(true)
          setSession(earlier)
          setEarlierTurns(previousTurns(earlier))
          setIntro(earlier.turns.find((turn) => turn.kind === 'introduction')?.content ?? '')
          setLastQuestion(earlier.pendingQuestion)
          setRevealedHints(earlier.pendingQuestion ? earlier.hintsRevealed : 0)
          return
        }
        setNoProvider(false)
        const { session: s, resumed } = await bundle.tutor.findOrStartSession({
          projectId: props.projectId,
          topicId: props.topicId,
          topicName: props.topicName,
          topicDescription: props.topicDescription,
          language: props.language,
          ...(props.difficulty ? { difficulty: props.difficulty } : {}),
        })
        if (cancelled) return
        setSession(s)

        if (resumed) {
          // Continue where the student left off — no AI call, no repeated
          // introduction.
          setEarlierTurns(previousTurns(s))
          setIntro(s.turns.find((turn) => turn.kind === 'introduction')?.content ?? '')
          setLastQuestion(s.pendingQuestion)
          // Hints already shown for the open question stay counted (and shown).
          setRevealedHints(s.pendingQuestion ? s.hintsRevealed : 0)
          return
        }

        // First visit for this topic: one AI call. The introduction is streamed
        // to the UI and the exact same text is persisted as the first turn. The
        // first question is generated on a best-effort basis — a failure here
        // must not hide the explanation the student just received.
        const next = await bundle.tutor.beginTopic(s.id, {
          onDelta: (text) => {
            if (!cancelled) setIntro((prev) => prev + text)
          },
          signal: run.signal,
        })
        if (cancelled) return
        setSession(next.session)
        setLastQuestion(next.session.pendingQuestion)
        setRevealedHints(0)
        setLastEvaluation(undefined)
        if (next.questionError) {
          setActionError({ message: next.questionError, needsSettings: false })
        }
        // Stopped while the first question was being written.
        if (run.signal.aborted && !next.session.pendingQuestion) setStopped(true)
      } catch (err) {
        if (cancelled) return
        if (isAbortError(err, run.signal)) {
          // Nothing of a stopped introduction was saved; drop the streamed part.
          setIntro('')
          setStopped(true)
        } else setError(tutorErrorInfo(err))
      } finally {
        run.finish()
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
      run.stopNow()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  function nextQuestion(): Promise<void> {
    return exclusive(nextQuestionNow)
  }

  async function nextQuestionNow() {
    if (!session) return
    const bundle = await requireBundle()
    if (!bundle) return
    setBusy(true)
    setActionError(null)
    setStopped(false)
    setAnswer('')
    setRevealedHints(0)
    setLastEvaluation(undefined)
    const run = generation.start()
    try {
      const result = await bundle.tutor.askQuestion(session.id, run.signal)
      setSession(result.session)
      setLastQuestion(result.session.pendingQuestion)
    } catch (err) {
      if (isAbortError(err, run.signal)) setStopped(true)
      else setActionError(tutorErrorInfo(err), () => void nextQuestion())
    } finally {
      run.finish()
      setBusy(false)
    }
  }

  /** Redo a stopped introduction (nothing of it was saved). */
  function beginAgain(): Promise<void> {
    return exclusive(beginAgainNow)
  }

  async function beginAgainNow() {
    if (!session) return
    const bundle = await requireBundle()
    if (!bundle) return
    setBusy(true)
    setStopped(false)
    setActionError(null)
    setIntro('')
    const run = generation.start()
    try {
      const next = await bundle.tutor.beginTopic(session.id, {
        onDelta: (text) => setIntro((prev) => prev + text),
        signal: run.signal,
      })
      setSession(next.session)
      setLastQuestion(next.session.pendingQuestion)
      if (next.questionError) {
        setActionError({ message: next.questionError, needsSettings: false })
      }
      if (run.signal.aborted && !next.session.pendingQuestion) setStopped(true)
    } catch (err) {
      if (isAbortError(err, run.signal)) {
        setIntro('')
        setStopped(true)
      } else setActionError(tutorErrorInfo(err), () => void beginAgain())
    } finally {
      run.finish()
      setBusy(false)
    }
  }

  function revealHint(): Promise<void> {
    return exclusive(revealHintNow)
  }

  async function revealHintNow() {
    if (!session) return
    const bundle = await requireBundle()
    if (!bundle) return
    setBusy(true)
    setActionError(null)
    try {
      const { session: next, hint } = await bundle.tutor.requestHint(session.id)
      setSession(next)
      setRevealedHints((c) => c + 1)
      toast({ variant: 'info', title: t('tutor.hintReleased'), description: hint })
    } catch (err) {
      setActionError(tutorErrorInfo(err))
    } finally {
      setBusy(false)
    }
  }

  function submit(): Promise<void> {
    return exclusive(submitNow)
  }

  async function submitNow() {
    if (!session || !lastQuestion) return
    if (!answer.trim()) {
      toast({ variant: 'warning', title: t('tutor.enterAnswer') })
      return
    }
    const bundle = await requireBundle()
    if (!bundle) return
    setBusy(true)
    setActionError(null)
    setStopped(false)
    const run = generation.start()
    try {
      const result = await bundle.tutor.submitAnswer(session.id, answer.trim(), run.signal)
      setSession(result.session)
      setLastEvaluation(result.turn.evaluation as TutorEvaluation | undefined)
      setLastQuestion(undefined)
    } catch (err) {
      // Stopped: the answer stays in the box and nothing was recorded.
      if (!isAbortError(err, run.signal)) setActionError(tutorErrorInfo(err))
    } finally {
      run.finish()
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="space-y-3">
        <TutorErrorNotice
          title={t('tutor.unavailable')}
          message={error.message}
          needsSettings={error.needsSettings}
          onRetry={() => setAttempt((n) => n + 1)}
          retrying={busy}
        />
        {props.onClose && (
          <Button variant="outline" onClick={props.onClose}>
            {t('common.close')}
          </Button>
        )}
      </div>
    )
  }

  if (!session) {
    return <LoadingState label={t('tutor.preparing')} />
  }

  // Prefer the streamed text so the explanation appears as it arrives; fall
  // back to the persisted turn so it survives a remount.
  const persistedIntro = session.turns.find((turn) => turn.kind === 'introduction')?.content ?? ''
  const introText = intro || persistedIntro
  const stopControl = (
    <GenerationControls kind="single" state={generation.state} onStopNow={generation.stopNow} />
  )

  return (
    <div className="space-y-4 lecture:space-y-6">
      {/* lecture: the introduction is prose on the paper, not a card.
          lab: a hairline cell with mono metadata. */}
      <Card className="lecture:rounded-none lecture:border-0 lecture:bg-transparent lecture:shadow-none">
        <CardHeader className="lecture:px-0 lecture:pt-0 lab:border-b lab:px-5 lab:py-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base lecture:text-sm lecture:font-normal lecture:text-muted-foreground lab:text-sm">
            <GraduationCap className="h-4 w-4 shrink-0" />
            <TruncatedText text={props.topicName} className="min-w-0 max-w-full" />
            <Badge variant="outline" className="shrink-0 lab:font-mono lab:text-[11px]">
              {t(difficultyLabelKey(session.currentDifficulty))}
            </Badge>
            <Badge
              variant="outline"
              className="shrink-0 tabular-nums lab:font-mono lab:text-[11px]"
            >
              {t('tutor.mastery', { value: formatPercent(session.mastery) })}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 lecture:px-0 lab:px-5 lab:pt-5">
          {introText ? (
            // Rendered through the shared reading renderer so paragraphs are
            // separated, LaTeX typesets, and any Markdown structure the model
            // wrote becomes real headings/lists instead of one text wall.
            // The measure and leading make it read like lecture notes.
            <RichText
              text={introText}
              format="markdown"
              className={cn('space-y-5 [&_ol]:space-y-2 [&_ul]:space-y-2', LESSON_PROSE_CLASS)}
              paragraphClassName="text-[17px] leading-[1.8] lecture:leading-[1.9] lab:text-[15px] lab:leading-[1.85]"
            />
          ) : (
            <div className="text-[15px] text-muted-foreground">{t('tutor.loadingIntro')}</div>
          )}
        </CardContent>
      </Card>

      {earlierTurns.length > 0 && <EarlierTurns turns={earlierTurns} />}

      {noProvider && !actionError && (
        <TutorErrorNotice tone="warning" message={t('tutor.noProviderSession')} needsSettings />
      )}

      {actionError && (
        <TutorErrorNotice
          message={actionError.message}
          needsSettings={actionError.needsSettings}
          {...(retryAction
            ? { onRetry: retryAction }
            : !lastQuestion && !noProvider
              ? { onRetry: () => void nextQuestion(), retryLabel: t('tutor.retryQuestion') }
              : {})}
          retrying={busy}
        />
      )}

      {lastEvaluation && <FeedbackCard evaluation={lastEvaluation} />}

      {lastQuestion && (
        <Card className="lecture:rounded-none lecture:border-x-0 lecture:border-b-0 lecture:bg-transparent lecture:shadow-none">
          <CardHeader className="lecture:px-0 lecture:pb-3 lab:border-b lab:px-5 lab:py-2.5">
            <CardTitle className="text-base lecture:text-xs lecture:font-normal lecture:tracking-[0.14em] lecture:text-muted-foreground lab:font-mono lab:text-[11px] lab:font-medium lab:uppercase lab:tracking-[0.06em] lab:text-muted-foreground">
              {t('tutor.question')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 lecture:px-0 lab:px-5 lab:pt-5">
            {/* Markdown + LaTeX, like every other question surface. */}
            <RichText
              text={lastQuestion.prompt}
              format="markdown"
              paragraphClassName="text-[17px] font-medium leading-[1.7] lecture:font-heading lecture:text-[19px] lecture:font-semibold lecture:leading-[1.75]"
            />
            {lastQuestion.options && (
              <ul className="ml-5 list-disc space-y-2 text-[16px] leading-[1.7]">
                {lastQuestion.options.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            )}
            {revealedHints > 0 && (lastQuestion.hints?.length ?? 0) > 0 && (
              // Hints stay with the question instead of vanishing with a toast.
              <ol className="space-y-1.5 rounded-lg border border-border/70 bg-muted/30 px-4 py-3 text-[15px] leading-[1.7] lab:rounded-none">
                {lastQuestion.hints.slice(0, revealedHints).map((hint, index) => (
                  <li key={index} className="min-w-0">
                    <span className="mr-1.5 text-xs font-medium text-muted-foreground">
                      {t('tutor.hintLabel', { number: index + 1 })}
                    </span>
                    <RichText text={hint} format="markdown" className="inline min-w-0" />
                  </li>
                ))}
              </ol>
            )}
            <MathField
              // An expression answer gets the maths keyboard and a "read as"
              // preview; everything else is free working with Unicode symbols.
              mode={
                lastQuestion.type === 'math_expr'
                  ? 'expression'
                  : lastQuestion.type === 'numeric'
                    ? 'number'
                    : 'text'
              }
              subject={project?.subject}
              language={targetLanguageOf(project)}
              multiline={lastQuestion.type !== 'math_expr' && lastQuestion.type !== 'numeric'}
              rows={4}
              inputClassName="text-[16px] leading-[1.7]"
              value={answer}
              onChange={setAnswer}
              placeholder={t('tutor.answerPlaceholder')}
              onSubmit={() => {
                if (!busy) void submit()
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submit} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {t('tutor.submitAnswer')}
              </Button>
              {busy && stopControl}
              <Button
                variant="outline"
                onClick={revealHint}
                disabled={busy || revealedHints >= (lastQuestion.hints?.length ?? 0)}
              >
                <Lightbulb className="h-4 w-4" />
                {revealedHints > 0
                  ? t('tutor.hintLabel', { number: revealedHints + 1 })
                  : t('tutor.hint')}
              </Button>
              <span className="text-xs text-muted-foreground lab:ml-auto lab:font-mono lab:text-[11px]">
                {t('tutor.hintsAvailable', {
                  count: Math.max(0, (lastQuestion.hints?.length ?? 0) - revealedHints),
                  point: lastQuestion.knowledgePoint,
                })}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {!lastQuestion && lastEvaluation && (
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="text-[15px] text-muted-foreground">{t('tutor.readyNext')}</div>
            <Button onClick={nextQuestion} disabled={busy}>
              {t('tutor.nextQuestion')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {!lastQuestion && !lastEvaluation && busy && (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-[15px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('tutor.workingOnQuestion')}
            <span className="ml-auto">{stopControl}</span>
          </CardContent>
        </Card>
      )}

      {stopped && !busy && !lastQuestion && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
            <p role="status" className="text-[15px] text-muted-foreground">
              {t('generation.stoppedKept')}
            </p>
            <Button
              variant="outline"
              onClick={() => void (persistedIntro ? nextQuestion() : beginAgain())}
            >
              {persistedIntro ? t('tutor.retryQuestion') : t('common.retry')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Nothing open and nothing running (e.g. a resumed conversation whose
          last question was answered, or whose first question never came):
          offer the next question instead of a "thinking" message that never ends. */}
      {!lastQuestion &&
        !lastEvaluation &&
        !busy &&
        introText &&
        !actionError &&
        !stopped &&
        !noProvider && (
          <Card>
            <CardContent className="flex items-center justify-between gap-2 p-4">
              <div className="text-[15px] text-muted-foreground">{t('tutor.readyNext')}</div>
              <Button onClick={() => void nextQuestion()} disabled={busy}>
                {t('tutor.nextQuestion')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}
    </div>
  )
}

/**
 * The turns a resumed conversation already had (after the introduction, minus
 * the question still waiting for an answer, which is shown below as usual).
 */
function previousTurns(session: TutorSession): TutorTurn[] {
  const pendingId = session.pendingQuestion?.id
  return session.turns.filter(
    (turn) =>
      turn.kind !== 'introduction' &&
      !(pendingId && turn.kind === 'question' && turn.question?.id === pendingId),
  )
}

/** The earlier part of a resumed conversation, folded so it never buries the current question. */
function EarlierTurns({ turns }: { turns: TutorTurn[] }) {
  const { t } = useTranslation()
  return (
    <details className="rounded-lg border border-border/70 lecture:rounded-none lecture:border-x-0 lab:rounded-none">
      <summary className="focus-ring cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground lecture:px-0 lab:font-mono lab:text-[12px]">
        {t('tutor.earlierTurns', { count: turns.length })}
      </summary>
      <ol className="space-y-3 border-t border-border/60 px-4 py-3 lecture:px-0">
        {turns.map((turn, index) => (
          <li key={`${turn.createdAt}-${index}`} className="min-w-0 space-y-1">
            <p className="text-xs text-muted-foreground lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-[0.06em]">
              {turn.role === 'student' ? t('tutor.you') : t(TURN_KIND_LABEL_KEYS[turn.kind])}
            </p>
            <RichText
              text={turn.content}
              format="markdown"
              className="min-w-0 space-y-2 break-words"
              paragraphClassName="text-[15px] leading-[1.7]"
            />
          </li>
        ))}
      </ol>
    </details>
  )
}

function FeedbackCard({ evaluation }: { evaluation: TutorEvaluation }) {
  const { t } = useTranslation()
  const correct = evaluation.isCorrect
  // Short answers show their scoring points, the same view as in quizzes.
  if (evaluation.scoring) {
    return (
      <ShortAnswerFeedback
        evaluation={{
          isCorrect: evaluation.isCorrect,
          method: 'rubric_ai',
          confidence: 0.8,
          score: { earned: evaluation.scoring.earned, total: evaluation.scoring.total },
          rubric: evaluation.scoring.rubric,
          ...(evaluation.scoring.contradictions
            ? { contradictions: evaluation.scoring.contradictions }
            : {}),
          ...(evaluation.feedback ? { explanation: evaluation.feedback } : {}),
          expected: evaluation.groundedExplanation,
        }}
      />
    )
  }
  return (
    <Card
      className={cn(
        'border',
        correct
          ? 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20'
          : 'border-destructive/40 bg-destructive/5',
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {correct ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
          {correct ? t('tutor.looksGood') : t('tutor.notQuite')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-[16px] leading-[1.8]">
        <p>{evaluation.feedback}</p>
        {evaluation.partialCredit && (
          <p className="text-[15px] text-muted-foreground">
            {t('tutor.partialCredit', { value: evaluation.partialCredit })}
          </p>
        )}
        <div className="rounded-lg border bg-card p-4">
          <p className="mb-1.5 font-medium">{t('tutor.explanation')}</p>
          <p className="whitespace-pre-wrap">{evaluation.groundedExplanation}</p>
          {evaluation.isSupplementary && (
            <p className="mt-2 rounded bg-amber-100/60 px-2 py-1 text-[13px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              {t('tutor.supplementary')}
            </p>
          )}
        </div>
        {evaluation.breakdown.length > 0 && (
          <ul className="ml-5 list-disc space-y-2 text-[15px] leading-[1.7] text-muted-foreground">
            {evaluation.breakdown.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        <p className="text-[15px] text-muted-foreground">
          {t('tutor.next', { value: evaluation.nextSteps })}
        </p>
      </CardContent>
    </Card>
  )
}
