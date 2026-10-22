import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Mic,
  MicOff,
  RotateCw,
  Send,
  Square,
  Volume2,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Badge } from '@/shared/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ErrorState } from '@/shared/ui/ErrorState'
import { Label } from '@/shared/ui/Label'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Textarea } from '@/shared/ui/Textarea'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { LetterBar } from '@/widgets/mathInput/LetterBar'
import { appendSpeechText, useSpeechInput } from '@/features/homework/useSpeechInput'
import { toast } from '@/features/toast/toastStore'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { canSpeak, hasVoiceFor, onVoicesChanged, speak } from '@/shared/lib/speech'
import { cn } from '@/shared/lib/utils'
import { buildAIServices } from '@/services/aiServices'
import { withUsageKind } from '@/services/aiService'
import { InterviewService } from '@/services/interviewService'
import {
  askedQuestionIds,
  courseScaleScore,
  speechLocaleFor,
  type InterviewSession,
} from '@/entities/interview/types'
import { useTranslation } from '@/i18n'

async function aiService(): Promise<InterviewService> {
  const bundle = await buildAIServices()
  return new InterviewService({ ai: withUsageKind(bundle?.ai ?? null, 'tutor') })
}

/** One interview: the conversation, the checklist, the summary and the result. */
export function InterviewRoom({
  projectId,
  sessionId,
  targetLanguage,
}: {
  projectId: string
  sessionId: string
  targetLanguage: string
}): JSX.Element {
  const { t } = useTranslation()
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(false)
    new InterviewService()
      .get(projectId, sessionId)
      .then((row) => {
        if (!cancelled) setSession(row)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, sessionId, reloadKey])

  if (error)
    return (
      <ErrorState
        title={t('interview.sessionLoadFailed')}
        action={
          <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
            {t('common.tryAgain')}
          </Button>
        }
      />
    )
  if (!session) return <LoadingState />

  const graded = session.status === 'graded'
  const revealed = !session.examMode || graded

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 break-words font-heading text-lg font-semibold">
          {session.scenario.title}
        </h2>
        <Badge variant={session.scenario.source === 'textbook' ? 'secondary' : 'outline'}>
          {session.scenario.source === 'textbook'
            ? t('interview.sourceTextbook')
            : t('interview.sourceGenerated')}
        </Badge>
        {session.examMode && <Badge variant="outline">{t('interview.examMode')}</Badge>}
      </div>
      {session.scenario.source === 'generated' && (
        <p className="text-xs text-muted-foreground">{t('interview.generatedNotice')}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('interview.rolePlayNotice')}</p>

      {graded && session.results && (
        <InterviewResultsCard projectId={projectId} session={session} />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <Conversation session={session} targetLanguage={targetLanguage} revealed={revealed} />
          {session.status === 'interviewing' && (
            <TurnComposer
              projectId={projectId}
              session={session}
              targetLanguage={targetLanguage}
              onChange={setSession}
            />
          )}
          {session.status === 'summarizing' && (
            <SummaryEditor projectId={projectId} session={session} onChange={setSession} />
          )}
          {graded && session.summary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('interview.yourSummary')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap break-words text-sm">{session.summary}</p>
              </CardContent>
            </Card>
          )}
        </div>
        <Checklist session={session} revealed={revealed} />
      </div>
    </div>
  )
}

function Conversation({
  session,
  targetLanguage,
  revealed,
}: {
  session: InterviewSession
  targetLanguage: string
  revealed: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const end = useRef<HTMLDivElement>(null)
  const count = session.turns.length

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' })
  }, [count])

  if (count === 0)
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground lecture:rounded-none lab:rounded-sm">
        {t('interview.emptyConversation')}
      </p>
    )

  return (
    <>
      <ol className="space-y-3" aria-label={t('interview.conversation')}>
        {session.turns.map((turn, index) => (
          <li
            key={`${turn.at}-${index}`}
            className={cn('flex', turn.role === 'student' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] space-y-1 rounded-2xl px-3.5 py-2 text-sm lecture:rounded-none lab:rounded-sm',
                turn.role === 'student'
                  ? 'bg-theme-primary-soft text-foreground'
                  : 'border bg-card text-card-foreground',
              )}
            >
              <p className="sr-only">
                {turn.role === 'student' ? t('interview.you') : t('interview.patient')}
              </p>
              <div className="flex items-start gap-2">
                <p lang={targetLanguage} className="whitespace-pre-wrap break-words">
                  {turn.text}
                </p>
                {turn.role === 'patient' && canSpeak() && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="-my-1 h-7 w-7 shrink-0"
                    aria-label={t('interview.readAloud')}
                    onClick={() => speak(turn.text, targetLanguage)}
                  >
                    <Volume2 aria-hidden />
                  </Button>
                )}
              </div>
              {turn.role === 'student' && revealed && turn.correction && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    {t('interview.correction')}
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap break-words">{turn.correction}</p>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div ref={end} />
    </>
  )
}

function TurnComposer({
  projectId,
  session,
  targetLanguage,
  onChange,
}: {
  projectId: string
  session: InterviewSession
  targetLanguage: string
  onChange: (session: InterviewSession) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const turnRun = useGenerationRun({ abortOnUnmount: true })
  const [ending, setEnding] = useState(false)
  const [autoRead, setAutoRead] = useState(false)
  const [voice, setVoice] = useState(() => hasVoiceFor(targetLanguage))
  const field = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const speech = useSpeechInput(speechLocaleFor(targetLanguage), (text) =>
    setDraft((previous) => appendSpeechText(previous, text)),
  )
  const speechActive =
    speech.state === 'starting' || speech.state === 'listening' || speech.state === 'stopping'

  useEffect(() => {
    setVoice(hasVoiceFor(targetLanguage))
    return onVoicesChanged(() => setVoice(hasVoiceFor(targetLanguage)))
  }, [targetLanguage])

  // The question being answered: shown as a bubble while the patient replies,
  // and kept with a resend button when no reply arrived.
  const [pending, setPending] = useState<{ text: string; failed: boolean } | null>(null)
  // A stored question without a reply (the last turn is the student's).
  const lastTurn = session.turns[session.turns.length - 1]
  const unanswered = !pending && lastTurn?.role === 'student' ? lastTurn : null

  const send = async (override?: { text: string } | 'stored') => {
    const text = override === 'stored' ? '' : (override?.text ?? draft).trim()
    if ((override !== 'stored' && !text) || sending) return
    speech.cancel()
    setSending(true)
    if (override !== 'stored') {
      setPending({ text, failed: false })
      if (!override) setDraft('')
    }
    const run = turnRun.start()
    try {
      const service = await aiService()
      const next =
        override === 'stored'
          ? await service.resendLast(projectId, session.id, { signal: run.signal })
          : await service.ask(projectId, session.id, text, { signal: run.signal })
      onChange(next)
      setPending(null)
      turnRun.reset()
      const last = next.turns[next.turns.length - 1]
      if (autoRead && last?.role === 'patient') speak(last.text, targetLanguage)
    } catch (err) {
      if (isGenerationInterruption(err, run)) {
        // A stopped turn stores nothing; the question goes back in the box.
        if (override !== 'stored') {
          setDraft((current) => current || text)
          setPending(null)
        }
      } else {
        if (override !== 'stored') setPending({ text, failed: true })
        toast({
          variant: 'error',
          title: t('interview.askFailed'),
          description: friendlyAIError(err),
        })
      }
    } finally {
      run.finish()
      setSending(false)
      field.current?.focus()
    }
  }

  const end = async () => {
    setEnding(true)
    try {
      speech.cancel()
      onChange(await new InterviewService().endInterview(session.id))
    } catch (err) {
      toast({
        variant: 'error',
        title: t('interview.saveFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setEnding(false)
    }
  }

  return (
    <div className="space-y-2">
      {pending && (
        <div className="flex justify-end">
          <div
            className={cn(
              'max-w-[85%] rounded-2xl bg-theme-primary-soft px-3.5 py-2 text-sm text-foreground lecture:rounded-none lab:rounded-sm',
              !pending.failed && 'opacity-80',
            )}
          >
            <p className="sr-only">{t('interview.you')}</p>
            <p lang={targetLanguage} className="whitespace-pre-wrap break-words">
              {pending.text}
            </p>
          </div>
        </div>
      )}
      {sending && (
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('interview.waitingReply')}
        </p>
      )}
      {!sending && (pending?.failed || unanswered) && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>{t('interview.noReply')}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void send(pending ? { text: pending.text } : 'stored')}
          >
            <RotateCw aria-hidden />
            {t('interview.resend')}
          </Button>
          {pending && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(pending.text)
                setPending(null)
                field.current?.focus()
              }}
            >
              {t('interview.editQuestion')}
            </Button>
          )}
        </div>
      )}
      <Label htmlFor="interview-turn">{t('interview.yourQuestion')}</Label>
      <Textarea
        id="interview-turn"
        ref={field}
        lang={targetLanguage}
        rows={2}
        value={draft}
        disabled={sending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void send()
          }
        }}
        placeholder={t('interview.turnPlaceholder')}
      />
      <LetterBar
        language={targetLanguage}
        field={() => field.current}
        value={() => draftRef.current}
        onChange={setDraft}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => (speechActive ? speech.stop() : speech.start())}
          disabled={!speech.supported || sending || speech.state === 'stopping'}
          aria-pressed={speechActive}
        >
          {speechActive ? <MicOff aria-hidden /> : <Mic aria-hidden />}
          {speechActive ? t('homework.speechStop') : t('homework.speechStart')}
        </Button>
        <Button
          type="button"
          onClick={() => void send()}
          disabled={sending || speechActive || !draft.trim()}
        >
          {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          {t('interview.send')}
        </Button>
        <GenerationControls kind="single" state={turnRun.state} onStopNow={turnRun.stopNow} />
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="focus-ring h-4 w-4 accent-primary"
            checked={autoRead}
            disabled={!canSpeak()}
            onChange={(event) => setAutoRead(event.target.checked)}
          />
          {t('interview.autoRead')}
        </label>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {!speech.supported
          ? t('homework.speechUnsupported')
          : speech.error
            ? t(`homework.speechError.${speech.error}`)
            : speech.state === 'listening'
              ? t('homework.speechListening')
              : ''}
      </p>
      {canSpeak() && !voice && (
        <p className="text-xs text-muted-foreground">{t('interview.noVoice')}</p>
      )}
      <div className="flex justify-end border-t pt-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void end()}
          disabled={ending || sending}
        >
          <Square aria-hidden />
          {t('interview.end')}
        </Button>
      </div>
    </div>
  )
}

function SummaryEditor({
  projectId,
  session,
  onChange,
}: {
  projectId: string
  session: InterviewSession
  onChange: (session: InterviewSession) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [summary, setSummary] = useState(session.summary)
  const [grading, setGrading] = useState(false)
  const gradeRun = useGenerationRun({ abortOnUnmount: true })

  const grade = async () => {
    setGrading(true)
    const run = gradeRun.start()
    try {
      onChange(
        await (await aiService()).grade(projectId, session.id, summary, { signal: run.signal }),
      )
      gradeRun.reset()
    } catch (err) {
      // A stopped check grades nothing; the summary stays as written.
      if (!isGenerationInterruption(err, run))
        toast({
          variant: 'error',
          title: t('interview.gradeFailed'),
          description: friendlyAIError(err),
        })
      // The draft was kept; reload it so a later visit shows it.
      void new InterviewService()
        .get(projectId, session.id)
        .then(onChange)
        .catch(() => undefined)
    } finally {
      run.finish()
      setGrading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('interview.summaryTitle')}</CardTitle>
        <CardDescription>{t('interview.summaryHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="interview-summary" className="sr-only">
          {t('interview.summaryTitle')}
        </Label>
        <Textarea
          id="interview-summary"
          lang="en"
          rows={6}
          value={summary}
          disabled={grading}
          onChange={(event) => setSummary(event.target.value)}
          onBlur={() => {
            if (summary !== session.summary)
              void new InterviewService().saveSummary(session.id, summary).catch(() => undefined)
          }}
          placeholder={t('interview.summaryPlaceholder')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void grade()} disabled={grading || !summary.trim()}>
            {grading && <Loader2 className="animate-spin" aria-hidden />}
            {t('interview.grade')}
          </Button>
          <GenerationControls kind="single" state={gradeRun.state} onStopNow={gradeRun.stopNow} />
        </div>
      </CardContent>
    </Card>
  )
}

function Checklist({
  session,
  revealed,
}: {
  session: InterviewSession
  revealed: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const [shown, setShown] = useState(!session.examMode)
  const visible = revealed && shown
  const asked = new Set(askedQuestionIds(session))

  return (
    <aside
      aria-labelledby="interview-checklist"
      className="h-fit space-y-3 rounded-lg border p-4 lecture:rounded-none lecture:border-x-0 lecture:border-b-0 lecture:border-t-[1.5px] lecture:border-t-foreground lecture:px-0 lab:rounded-sm lg:sticky lg:top-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="interview-checklist" className="text-sm font-semibold">
          {t('interview.checklist')}
        </h3>
        {revealed && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShown((value) => !value)}
            aria-expanded={shown}
          >
            {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            {shown ? t('interview.hideChecklist') : t('interview.showChecklist')}
          </Button>
        )}
      </div>
      {!revealed ? (
        <p className="text-xs text-muted-foreground">{t('interview.checklistHidden')}</p>
      ) : !visible ? (
        <p className="text-xs text-muted-foreground">
          {t('interview.checklistProgress', {
            asked: asked.size,
            total: session.scenario.questions.length,
          })}
        </p>
      ) : (
        <ul className="space-y-2">
          {session.scenario.questions.map((question) => {
            const done = asked.has(question.id)
            return (
              <li key={question.id} className="flex items-start gap-2 text-sm">
                {done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="sr-only">
                  {done ? t('interview.asked') : t('interview.notAsked')}
                </span>
                <span className="min-w-0">
                  <span lang={session.targetLanguage} className="block break-words">
                    {question.label}
                  </span>
                  {question.englishGloss !== question.label && (
                    <span lang="en" className="block break-words text-xs text-muted-foreground">
                      {question.englishGloss}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

function InterviewResultsCard({
  projectId,
  session,
}: {
  projectId: string
  session: InterviewSession
}): JSX.Element {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const results = session.results!
  const scale = courseScaleScore(results)
  const quotes = new Map(results.facts.evidence.map((item) => [item.factId, item.quote]))
  const missed = session.scenario.facts.filter((fact) => !quotes.has(fact.id))
  const corrections = session.turns.filter((turn) => turn.role === 'student' && turn.correction)
  const missedQuestions = session.scenario.questions.filter(
    (q) => !results.questions.askedIds.includes(q.id),
  )

  const addCards = async () => {
    setAdding(true)
    try {
      const added = await new InterviewService().addMissedToPhraseCards(projectId, session.id)
      toast({ variant: 'success', title: t('interview.cardsAdded', { count: added }) })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('interview.cardsFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card className="lecture:rounded-none lecture:border-x-0 lecture:border-b lecture:border-t-[1.5px] lecture:border-t-foreground lecture:bg-transparent lecture:shadow-none">
      <CardHeader className="lecture:px-0">
        <CardTitle className="text-base">{t('interview.resultsTitle')}</CardTitle>
        <CardDescription>{t('interview.resultsNote')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 lecture:px-0">
        {/* Three even columns: label, value, one line of detail each. */}
        <dl className="grid gap-4 sm:grid-cols-3 sm:gap-6">
          {[
            {
              key: 'questions',
              label: t('interview.questionsAsked'),
              value: `${results.questions.asked}/${results.questions.total}`,
              detail: t('interview.questionsDetail'),
            },
            {
              key: 'facts',
              label: t('interview.factsUnderstood'),
              value: `${results.facts.understood}/${results.facts.total}`,
              detail: t('interview.factsDetail'),
            },
            {
              key: 'communication',
              label: t('interview.communication'),
              value: results.communication ? `${results.communication.score}/3` : '—',
              detail: results.communication
                ? `${t('interview.estimate')} · ${results.communication.note}`
                : t('interview.noEstimate'),
            },
          ].map((stat) => (
            <div
              key={stat.key}
              className="flex min-w-0 flex-col gap-1 lecture:border-l lecture:pl-4 lecture:first:border-l-0 lecture:first:pl-0"
            >
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="font-mono text-2xl font-semibold tabular-nums">{stat.value}</dd>
              <dd
                className="line-clamp-2 break-words text-xs text-muted-foreground"
                title={stat.detail}
              >
                {stat.detail}
              </dd>
            </div>
          ))}
        </dl>
        {scale && (
          <p className="text-sm">
            {t('interview.courseScale', {
              questions: scale.questions,
              facts: scale.facts,
              understood: results.facts.understood,
              factsTotal: results.facts.total,
              communication: scale.communication,
              total: scale.total,
            })}
          </p>
        )}
        {results.feedback && <p className="text-sm text-muted-foreground">{results.feedback}</p>}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('interview.understoodFacts')}</h3>
          {results.facts.evidence.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('interview.noneUnderstood')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {session.scenario.facts
                .filter((fact) => quotes.has(fact.id))
                .map((fact) => (
                  <li key={fact.id} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span className="min-w-0 break-words">
                      <span lang={session.targetLanguage}>{fact.fact}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('interview.evidence', { quote: quotes.get(fact.id)! })}
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {missed.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t('interview.missedFacts')}</h3>
            <ul className="space-y-1.5 text-sm">
              {missed.map((fact) => (
                <li key={fact.id} className="flex items-start gap-2">
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">
                    <span lang={session.targetLanguage}>{fact.fact}</span>
                    {fact.englishGloss && fact.englishGloss !== fact.fact && (
                      <span lang="en" className="block text-xs text-muted-foreground">
                        {fact.englishGloss}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {corrections.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t('interview.corrections')}</h3>
            <ul className="space-y-2 text-sm">
              {corrections.map((turn, index) => (
                <li key={`${turn.at}-${index}`} className="break-words">
                  <span lang={session.targetLanguage} className="text-muted-foreground">
                    {turn.text}
                  </span>
                  <span className="block">{turn.correction}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {missedQuestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              {t('interview.missedQuestions', { count: missedQuestions.length })}
            </p>
            <Button variant="outline" size="sm" onClick={() => void addCards()} disabled={adding}>
              {adding ? <Loader2 className="animate-spin" aria-hidden /> : <Layers aria-hidden />}
              {t('interview.addMissedCards')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
