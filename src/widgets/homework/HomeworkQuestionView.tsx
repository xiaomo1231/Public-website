import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUp,
  ClipboardCheck,
  ExternalLink,
  Eye,
  EyeOff,
  Lightbulb,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react'
import type { HomeworkMessage, HomeworkQuestion } from '@/entities/homework/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import { formatHomeworkQuestion } from '@/entities/homework/formatQuestion'
import type { HomeworkService } from '@/services/homeworkService'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { RichText } from '@/shared/ui/RichText'
import { Textarea } from '@/shared/ui/Textarea'
import { QuestionSource } from '@/widgets/quiz/QuestionSource'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export interface HomeworkQuestionViewProps {
  question: HomeworkQuestion
  service: HomeworkService
  /** `review` shows the professor answer; `practice` (default) hides it. */
  mode?: 'practice' | 'review'
  /** The linked answer document, for the "open original file" link. */
  answerDocumentId?: string
}

/**
 * One homework question: the prompt, the student's saved working, and the three
 * deliberate actions — progressive hints, the full AI solution, and a guided
 * help conversation. The question is rendered by the parent with a `key`, so
 * switching questions remounts this component and its local state resets.
 */
export function HomeworkQuestionView({
  question,
  service,
  mode = 'practice',
  answerDocumentId,
}: HomeworkQuestionViewProps): JSX.Element {
  const { t } = useTranslation()

  const [draft, setDraft] = useState(question.draftText)
  const [saved, setSaved] = useState(true)
  const [hints, setHints] = useState(question.hints)
  const [revealed, setRevealed] = useState(question.revealedHints)
  const [solution, setSolution] = useState(question.solution)
  const [solutionRevealed, setSolutionRevealed] = useState(question.solutionRevealed)
  const [status, setStatus] = useState(question.generationStatus)
  const [generationError, setGenerationError] = useState(question.generationError)
  const [messages, setMessages] = useState<HomeworkMessage[]>(question.messages)
  const [askOpen, setAskOpen] = useState(false)
  const [question_, setQuestionText] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sourcePages, setSourcePages] = useState<Array<{ page: number; url: string }>>([])
  const [displaySourceRefs, setDisplaySourceRefs] = useState<SourceReference[]>(question.sourceRefs)

  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let urls: string[] = []
    void service.loadQuestionSourcePages(question).then((pages) => {
      if (cancelled) return
      urls = pages.map(({ image }) => URL.createObjectURL(image))
      setSourcePages(pages.map(({ page }, index) => ({ page, url: urls[index]! })))
    }).catch(() => {
      // Original PDF remains available through the source link.
    })
    return () => {
      cancelled = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [question, service])

  useEffect(() => {
    let cancelled = false
    void service.resolveQuestionSources(question).then((refs) => {
      if (!cancelled) setDisplaySourceRefs(refs)
    }).catch(() => {
      // Keep the saved citation and original-document link available.
    })
    return () => { cancelled = true }
  }, [question, service])

  // Debounced draft persistence; also flush when the question unmounts.
  useEffect(() => {
    if (draft === question.draftText) return
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    setSaved(false)
    const value = draft
    saveTimer.current = window.setTimeout(() => {
      void service.saveDraft(question.id, value).then(() => setSaved(true))
    }, 600)
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [draft, question.draftText, question.id, service])

  async function showNextHint(): Promise<void> {
    setActionError(null)
    try {
      const next = await service.revealNextHint(question.id)
      if (next) {
        setHints(next.hints)
        setRevealed(next.revealedHints)
      }
    } catch (err) {
      setActionError(friendlyAIError(err))
    }
  }

  async function revealSolution(): Promise<void> {
    setActionError(null)
    try {
      const next = await service.revealSolution(question.id)
      if (next) {
        setSolution(next.solution)
        setSolutionRevealed(true)
      }
    } catch (err) {
      setActionError(friendlyAIError(err))
    }
  }

  async function regenerate(): Promise<void> {
    setBusy(true)
    setActionError(null)
    setNotice(null)
    const previousHints = hints.length
    try {
      // A question confirmed against the professor answer regenerates FROM that
      // answer; every other question uses the ordinary walkthrough.
      const useProfessorAnswer =
        question.answerStatus === 'matched' && Boolean((question.answerText ?? '').trim())
      const next = useProfessorAnswer
        ? await service.generateAnswerForQuestion(question.id)
        : await service.generateContent(question.id)
      if (next) {
        setHints(next.hints)
        setSolution(next.solution)
        setStatus(next.generationStatus)
        setGenerationError(next.generationError)
        setRevealed(next.revealedHints)
        if (next.generationStatus === 'ready') {
          setNotice(
            next.hints.length < previousHints
              ? t('homework.hintsReduced', { count: next.hints.length })
              : t('homework.contentUpdated'),
          )
        }
      }
    } catch (err) {
      setActionError(friendlyAIError(err))
    } finally {
      setBusy(false)
    }
  }

  async function send(): Promise<void> {
    const text = question_.trim()
    if (!text || asking) return
    setAsking(true)
    setActionError(null)
    const optimistic: HomeworkMessage = {
      id: `local-${Date.now()}`,
      role: 'student',
      content: text,
      createdAt: Date.now(),
    }
    setMessages((prev) => [...prev, optimistic])
    setQuestionText('')
    try {
      const reply = await service.ask(question.id, text)
      setMessages((prev) => [...prev, reply])
    } catch (err) {
      setActionError(friendlyAIError(err))
    } finally {
      setAsking(false)
    }
  }

  const hasMoreHints = revealed < hints.length
  const preparing = status === 'pending' && hints.length === 0 && !solution
  const questionAnchorId = `homework-question-${question.id}`

  return (
    /*
     * Wide screens: the question stays in the left column (sticky, no inner
     * scroll so the page never gets a second scrollbar) while the working area
     * — draft, hints, answer, conversation — lives in the right column. Narrow
     * screens fall back to one column with the question first.
     */
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div id={questionAnchorId} className="min-w-0 scroll-mt-4 space-y-4 lg:sticky lg:top-4">
        <Card data-selection-context="homework" data-selection-title={question.number ?? question.documentName}>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="label-mono">{t('homework.title')}</span>
            {question.number && <Badge variant="outline">{question.number}</Badge>}
          </div>
          <RichText
            text={formatHomeworkQuestion(question.prompt)}
            format="markdown"
            className="max-w-[74ch] [&>p]:mb-3"
            paragraphClassName="text-[16px] leading-[1.75] sm:text-[17px]"
          />
        </CardHeader>
        <CardContent className="space-y-3">
          <QuestionSource sourceRefs={displaySourceRefs} projectId={question.projectId} />
          {sourcePages.length > 0 && (
            <details open={displaySourceRefs.some((ref) => ref.quotePending) || /\b(?:figure|diagram|shown|below|network)\b|图|如下图|如图/i.test(question.prompt)}>
              <summary className="cursor-pointer rounded-md px-1 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t('homework.originalPages')}
              </summary>
              <div className="grid gap-4 pt-2 lg:grid-cols-2">
                {sourcePages.map(({ page, url }) => (
                  <figure key={page} className="min-w-0 space-y-2">
                    <figcaption className="text-xs text-muted-foreground">{t('homework.originalPage', { page })}</figcaption>
                    <a href={url} target="_blank" rel="noreferrer" aria-label={t('homework.openOriginalPage', { page })}>
                      <img src={url} alt={t('homework.originalPage', { page })} loading="lazy" className="h-auto w-full rounded-lg border border-border object-contain" />
                    </a>
                  </figure>
                ))}
              </div>
            </details>
          )}
        </CardContent>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        {/* Narrow screens only: a small, always-reachable way back to the
            question while the student is reading or typing below it. */}
        <div className="sticky top-2 z-10 flex justify-end lg:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-background/90 backdrop-blur"
            onClick={() =>
              document.getElementById(questionAnchorId)?.scrollIntoView({ block: 'start' })
            }
          >
            <ArrowUp className="h-4 w-4" />
            {t('homework.viewQuestion')}
          </Button>
        </div>

        {/* Review only: the professor's own answer, kept verbatim and clearly
            separated from the AI explanation. Hidden while practising. */}
        {mode === 'review' && question.answerText && question.answerStatus === 'matched' && (
          <Card className="border-theme-primary/40 bg-theme-primary-soft/30">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="h-4 w-4" aria-hidden />
                {t('homework.answer.professorOriginal')}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t('homework.answer.verifyNote')}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <RichText
                text={question.answerText}
                format="markdown"
                paragraphClassName="text-[15px] leading-relaxed"
              />
              {answerDocumentId && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/projects/${question.projectId}/documents/${answerDocumentId}`}>
                    <ExternalLink className="h-4 w-4" />
                    {t('homework.answer.openFile')}
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>{t('homework.draft')}</span>
            <span className={cn('label-mono', saved && 'opacity-70')}>
              {saved ? t('homework.saved') : '…'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('homework.draftPlaceholder')}
            rows={5}
            aria-label={t('homework.draft')}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void showNextHint()} disabled={busy}>
          <Lightbulb className="h-4 w-4" />
          {revealed === 0 ? t('homework.hint') : t('homework.nextHint')}
        </Button>
        <Button
          type="button"
          variant={solutionRevealed ? 'ghost' : 'outline'}
          onClick={() => (solutionRevealed ? setSolutionRevealed(false) : void revealSolution())}
          disabled={busy || !solution}
        >
          {solutionRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {solutionRevealed ? t('homework.hideAnswer') : t('homework.showAnswer')}
        </Button>
        <Button type="button" variant="outline" onClick={() => setAskOpen((open) => !open)}>
          <MessageCircle className="h-4 w-4" />
          {t('homework.ask')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void regenerate()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          {t('homework.regenerate')}
        </Button>
      </div>

      {actionError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">
          {notice}
        </div>
      )}

      {preparing && (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t('homework.preparing')}
          </CardContent>
        </Card>
      )}

      {status === 'failed' && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">
              {generationError ?? t('homework.questionFailed')}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void regenerate()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {t('homework.retry')}
            </Button>
          </CardContent>
        </Card>
      )}

      {hints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('homework.hintOf', { current: revealed, total: hints.length })}
            </CardTitle>
            {answerDocumentId && (
              <p className="text-xs text-muted-foreground">
                {question.answerBased
                  ? t('homework.answer.aiExplanation')
                  : t('homework.answer.aiExplanationNotBased')}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Hints are AI-authored prose that can contain inline/display
                LaTeX, so they render through the shared RichText renderer
                instead of showing raw `$…$` delimiters. */}
            {hints.slice(0, revealed).map((hint, index) => (
              <div key={index} className="rounded-lg bg-muted/40 p-3">
                <RichText
                  text={hint}
                  format="markdown"
                  paragraphClassName="text-sm leading-relaxed text-foreground"
                />
              </div>
            ))}
            {revealed === 0 && <p className="text-xs text-muted-foreground">{t('homework.hint')}</p>}
            {!hasMoreHints && <p className="text-xs text-muted-foreground">{t('homework.noMoreHints')}</p>}
          </CardContent>
        </Card>
      )}

      {solutionRevealed && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('homework.solutionTitle')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('homework.aiGenerated')}</p>
            {answerDocumentId && (
              <p className="text-xs text-muted-foreground">
                {question.answerBased
                  ? t('homework.answer.aiExplanation')
                  : t('homework.answer.aiExplanationNotBased')}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {solution ? (
              <RichText text={solution} format="markdown" paragraphClassName="text-[16px] leading-[1.7]" />
            ) : (
              <p className="text-sm text-muted-foreground">{t('homework.noAnswer')}</p>
            )}
            {question.previousSolution && (
              <details className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t('homework.answer.previousSolution')}
                </summary>
                <div className="pt-2">
                  <RichText
                    text={question.previousSolution}
                    format="markdown"
                    paragraphClassName="text-[14px] leading-relaxed text-muted-foreground"
                  />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {askOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t('homework.askTitle')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('homework.socraticNote')}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {messages.length > 0 && (
              <ul className="space-y-2">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                      message.role === 'student'
                        ? 'ml-auto bg-primary-strong text-primary-foreground'
                        : 'bg-muted/50 text-foreground',
                    )}
                  >
                    <span className="sr-only">
                      {message.role === 'student' ? t('homework.you') : t('homework.tutor')}:{' '}
                    </span>
                    {/* The tutor's replies may contain LaTeX, so they render
                        through RichText. The student's own words are shown
                        exactly as typed and are never rewritten. */}
                    {message.role === 'assistant' ? (
                      <RichText
                        text={message.content}
                        format="markdown"
                        paragraphClassName="text-sm leading-relaxed"
                      />
                    ) : (
                      message.content
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                value={question_}
                onChange={(event) => setQuestionText(event.target.value)}
                placeholder={t('homework.askPlaceholder')}
                rows={2}
                aria-label={t('homework.askTitle')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <Button type="button" onClick={() => void send()} disabled={asking || !question_.trim()}>
                {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t('homework.send')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  )
}
