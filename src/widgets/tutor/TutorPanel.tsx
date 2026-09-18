import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronRight, Lightbulb, Loader2, Sparkles, XCircle } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { Textarea } from '@/shared/ui/Textarea'
import { LoadingState } from '@/shared/ui/LoadingState'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast } from '@/features/toast/toastStore'
import { cn } from '@/shared/lib/utils'
import { buildAIServices } from '@/services/aiServices'
import type { DifficultyLevel, TutorEvaluation } from '@/infrastructure/ai/prompts/types'
import type { TutorQuestion, TutorSession } from '@/entities/tutorSession/types'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import type { TutorService } from '@/services/tutorService'

export interface TutorPanelProps {
  projectId: string
  topicId: string
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
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
  const [session, setSession] = useState<TutorSession | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealedHints, setRevealedHints] = useState(0)
  const [lastQuestion, setLastQuestion] = useState<TutorQuestion | undefined>()
  const [lastEvaluation, setLastEvaluation] = useState<TutorEvaluation | undefined>()
  const [intro, setIntro] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setBusy(true)
        const bundle = await buildTutorBundle()
        if (!bundle) {
          setError('Configure AI provider first.')
          return
        }
        const s = await bundle.tutor.startSession({
          projectId: props.projectId,
          topicId: props.topicId,
          topicName: props.topicName,
          topicDescription: props.topicDescription,
          language: props.language,
          ...(props.difficulty ? { difficulty: props.difficulty } : {}),
        })
        if (cancelled) return
        setSession(s)
        // A single AI call: the introduction is streamed to the UI and the
        // exact same text is persisted as the first turn.
        const next = await bundle.tutor.beginTopic(s.id, {
          onDelta: (text) => setIntro((prev) => prev + text),
        })
        if (cancelled) return
        setSession(next.session)
        setLastQuestion(next.session.pendingQuestion)
        setRevealedHints(0)
        setLastEvaluation(undefined)
      } catch (err) {
        if (!cancelled) setError(friendlyAIError(err))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function nextQuestion() {
    if (!session) return
    const bundle = await buildTutorBundle()
    if (!bundle) return
    setBusy(true)
    setError(null)
    setAnswer('')
    setRevealedHints(0)
    setLastEvaluation(undefined)
    try {
      const result = await bundle.tutor.askQuestion(session.id)
      setSession(result.session)
      setLastQuestion(result.session.pendingQuestion)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  async function revealHint() {
    if (!session) return
    const bundle = await buildTutorBundle()
    if (!bundle) return
    setBusy(true)
    try {
      const { session: next, hint } = await bundle.tutor.requestHint(session.id)
      setSession(next)
      setRevealedHints((c) => c + 1)
      toast({ variant: 'info', title: 'Hint released', description: hint })
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!session || !lastQuestion) return
    if (!answer.trim()) {
      toast({ variant: 'warning', title: 'Please enter an answer first.' })
      return
    }
    const bundle = await buildTutorBundle()
    if (!bundle) return
    setBusy(true)
    setError(null)
    try {
      const result = await bundle.tutor.submitAnswer(session.id, answer.trim())
      setSession(result.session)
      setLastEvaluation(result.turn.evaluation as TutorEvaluation | undefined)
      setLastQuestion(undefined)
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tutor unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          {props.onClose && (
            <Button variant="outline" onClick={props.onClose}>
              Close
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  if (!session) {
    return <LoadingState label="Preparing tutor session" />
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            {props.topicName}
            <Badge variant="outline">{session.currentDifficulty}</Badge>
            <Badge variant="outline">Mastery {Math.round(session.mastery * 100)}%</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {intro ? (
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground dark:prose-invert">
              {intro}
            </div>
          ) : (
            <div className="text-muted-foreground">Loading introduction…</div>
          )}
        </CardContent>
      </Card>

      {lastEvaluation && <FeedbackCard evaluation={lastEvaluation} />}

      {lastQuestion && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Question</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="whitespace-pre-wrap text-sm font-medium">{lastQuestion.prompt}</p>
            {lastQuestion.options && (
              <ul className="ml-5 list-disc text-sm">
                {lastQuestion.options.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            )}
            <Textarea
              rows={4}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer here…"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Submit answer
              </Button>
              <Button variant="outline" onClick={revealHint} disabled={busy || revealedHints >= (lastQuestion.hints?.length ?? 0)}>
                <Lightbulb className="h-4 w-4" />
                {revealedHints > 0 ? `Hint ${revealedHints + 1}` : 'Hint'}
              </Button>
              <span className="text-xs text-muted-foreground">
                {lastQuestion.hints?.length ?? 0} hints available · knowledge point: {lastQuestion.knowledgePoint}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {!lastQuestion && lastEvaluation && (
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="text-sm text-muted-foreground">Ready for the next question?</div>
            <Button onClick={nextQuestion} disabled={busy}>
              Next question
              <ChevronRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {!lastQuestion && !lastEvaluation && busy && (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Working on your question…
          </CardContent>
        </Card>
      )}

      {!lastQuestion && !lastEvaluation && !busy && intro && (
        <EmptyState title="Thinking…" description="Generating your first question." />
      )}
    </div>
  )
}

function FeedbackCard({ evaluation }: { evaluation: TutorEvaluation }) {
  const correct = evaluation.isCorrect
  return (
    <Card
      className={cn(
        'border',
        correct ? 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-destructive/40 bg-destructive/5',
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {correct ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
          {correct ? 'Looks good' : 'Not quite'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{evaluation.feedback}</p>
        {evaluation.partialCredit && (
          <p className="text-xs text-muted-foreground">Partial credit: {evaluation.partialCredit}</p>
        )}
        <div className="rounded-md border bg-card p-3 text-sm">
          <p className="mb-1 font-medium">Explanation</p>
          <p className="whitespace-pre-wrap">{evaluation.groundedExplanation}</p>
          {evaluation.isSupplementary && (
            <p className="mt-2 rounded bg-amber-100/60 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              Supplementary explanation — not from your course material.
            </p>
          )}
        </div>
        {evaluation.breakdown.length > 0 && (
          <ul className="ml-5 list-disc text-xs text-muted-foreground">
            {evaluation.breakdown.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Next: {evaluation.nextSteps}</p>
      </CardContent>
    </Card>
  )
}

