import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, Loader2, Send, Sparkles, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import { RichText } from '@/shared/ui/RichText'
import { buildAIServices } from '@/services/aiServices'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { looksLikeUnreliableVisualText } from '@/infrastructure/files/visualDetection'
import { useTranslation } from '@/i18n'

export interface ContextualTutorContext {
  projectId: string
  topicId: string
  topicTitle?: string
  sectionHeading?: string
  selectedText: string
  surroundingContext: string
  language: string
  /** True when the selection sits inside a preserved figure. */
  fromVisual?: boolean
}

export interface ContextualTutorPopupProps {
  /** `explain` asks automatically; `ask` waits for the learner's question. */
  mode: 'explain' | 'ask'
  context: ContextualTutorContext
  onClose: () => void
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

/**
 * A lightweight, temporary Q&A about the passage the learner selected.
 *
 * It is not a chat page: the conversation lives only in this popup's state and
 * is discarded on close. Nothing here is written to the Tutor lesson cache or
 * the translation history.
 */
export function ContextualTutorPopup({
  mode,
  context,
  onClose,
}: ContextualTutorPopupProps): JSX.Element {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // A selection that is really a figure — or a broken transcription of one —
  // must not be sent as if it were reliable maths text.
  const askable =
    !context.fromVisual && !looksLikeUnreliableVisualText(context.selectedText)

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed || busy) return
      setError(null)
      setBusy(true)
      setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
      setInput('')
      try {
        const services = await buildAIServices()
        if (!services) {
          setError(t('translate.noProvider'))
          return
        }
        const { answer } = await services.contextualTutor.ask({
          projectId: context.projectId,
          topicId: context.topicId,
          ...(context.topicTitle ? { topicTitle: context.topicTitle } : {}),
          ...(context.sectionHeading ? { sectionHeading: context.sectionHeading } : {}),
          selectedText: context.selectedText,
          surroundingContext: context.surroundingContext,
          question: trimmed,
          language: context.language,
        })
        setMessages((prev) => [...prev, { role: 'assistant', content: answer }])
      } catch (err) {
        setError(friendlyAIError(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, context, t],
  )

  // "Explain" answers immediately. The ref keeps StrictMode's double effect
  // from firing it twice.
  useEffect(() => {
    if (mode === 'explain' && askable && !startedRef.current) {
      startedRef.current = true
      void send(t('contextual.explainQuestion'))
    }
    if (mode === 'ask') inputRef.current?.focus()
    // Runs once per popup instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  const continueHref = `/projects/${context.projectId}/tutor/${context.topicId}/interactive`

  return (
    <div
      role="dialog"
      aria-label={t('contextual.title')}
      onKeyDown={onKeyDown}
      className="flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col rounded-lg border bg-card p-3 text-card-foreground shadow-xl"
    >
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{t('contextual.title')}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      <p className="line-clamp-3 rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
        “{context.selectedText}”
      </p>

      {!askable ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {t('contextual.diagramOnly')}
        </p>
      ) : (
        <>
          {messages.length > 0 && (
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-0.5">
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <p
                    key={index}
                    className="ml-auto w-fit max-w-full rounded-md bg-primary/10 px-2 py-1 text-[13px] text-foreground"
                  >
                    {message.content}
                  </p>
                ) : (
                  <div key={index} className="min-w-0">
                    <RichText
                      text={message.content}
                      format="markdown"
                      className="space-y-2"
                      paragraphClassName="text-[14px] leading-[1.7]"
                    />
                  </div>
                ),
              )}
            </div>
          )}

          {busy && (
            <p className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('contextual.thinking')}
            </p>
          )}

          {error && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[13px] text-destructive">{t('contextual.failed')}</p>
              <p className="break-words text-[12px] text-muted-foreground">{error}</p>
            </div>
          )}

          <div className="mt-2 space-y-1.5">
            <label htmlFor="contextual-question" className="sr-only">
              {t('contextual.questionLabel')}
            </label>
            <Textarea
              id="contextual-question"
              ref={inputRef}
              rows={2}
              value={input}
              disabled={busy}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send(input)
                }
              }}
              placeholder={t('contextual.placeholder')}
              className="text-[14px] leading-[1.6]"
            />
            <div className="flex items-center justify-between gap-2">
              <a
                href={continueHref}
                className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
              >
                {t('contextual.continue')}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </a>
              <Button size="sm" onClick={() => void send(input)} disabled={busy || !input.trim()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {t('contextual.send')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
