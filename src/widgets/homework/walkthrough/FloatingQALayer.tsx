import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { flushSync } from 'react-dom'
import {
  Bookmark,
  BookmarkCheck,
  GripHorizontal,
  Layers,
  Loader2,
  MessageCircleQuestion,
  Minus,
  Send,
  X,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import { RichText } from '@/shared/ui/RichText'
import { toast } from '@/features/toast/toastStore'
import {
  clampRect,
  useFloatingQA,
  type FloatingQAWindow,
} from '@/features/homework/floatingQAStore'
import {
  addNoteToCards,
  askInWindow,
  persistWindowRect,
  saveWindow,
} from '@/features/homework/floatingQA'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { EASE_OUT, prefersReducedMotion } from '@/shared/lib/motion'
import { useTranslation } from '@/i18n'
import { revealPassage } from './passage'

/** The floating question windows of one assignment, plus the dock of minimised ones. */
export function FloatingQALayer({ setId }: { setId: string }): JSX.Element {
  const { t } = useTranslation()
  // Select the stable array; a filtered copy would be a new value every render.
  const all = useFloatingQA((state) => state.windows)
  const windows = useMemo(
    () => all.filter((window) => window.passage.setId === setId),
    [all, setId],
  )
  const focus = useFloatingQA((state) => state.focus)
  const close = useFloatingQA((state) => state.close)
  const minimized = windows.filter((window) => window.minimized)

  // Keep windows on screen when the browser window shrinks.
  useEffect(() => {
    function onResize(): void {
      const store = useFloatingQA.getState()
      for (const window of store.windows) store.setRect(window.id, clampRect(window.rect))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <>
      {windows
        .filter((window) => !window.minimized)
        .map((window, _, open) => (
          // Keep DOM order stable (a moved node would drop pointer capture
          // mid-drag); stack by rank so windows stay below dialogs (z-50).
          <FloatingQAWindowView
            key={window.id}
            win={window}
            layer={41 + open.filter((other) => other.z < window.z).length}
          />
        ))}
      {minimized.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-40 flex max-w-[60vw] flex-wrap justify-end gap-2"
          aria-label={t('walkthroughQA.dock')}
        >
          {minimized.map((window) => (
            <div
              key={window.id}
              className="flex animate-pop-in items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 text-xs shadow-lg lab:rounded-none lab:font-mono lab:shadow-lift"
            >
              <button
                type="button"
                className="focus-ring flex max-w-[14rem] items-center gap-1.5 truncate"
                onClick={() => focus(window.id)}
                title={windowTitle(window, t)}
              >
                <MessageCircleQuestion
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="truncate">{windowTitle(window, t)}</span>
              </button>
              {/* An unsaved conversation is closed from its window, which asks first. */}
              {(window.noteId || window.turns.length === 0) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={t('common.close')}
                  onClick={() => close(window.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

type T = ReturnType<typeof useTranslation>['t']

function windowTitle(window: FloatingQAWindow, t: T): string {
  if (window.title) return window.title
  const quote = window.passage.quote.replace(/\s+/g, ' ').trim()
  return quote
    ? `“${quote.length > 28 ? `${quote.slice(0, 27)}…` : quote}”`
    : t('walkthroughQA.title')
}

/**
 * Windows that have played their opening animation. A window unmounts while
 * minimised, so this keeps a restore or a raise from replaying it.
 */
const enteredWindows = new Set<string>()

function FloatingQAWindowView({
  win,
  layer,
}: {
  win: FloatingQAWindow
  layer: number
}): JSX.Element {
  const { t } = useTranslation()
  const { focus, close, setMinimized, setRect } = useFloatingQA.getState()
  const [input, setInput] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const [busyAction, setBusyAction] = useState<'save' | 'cards' | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Opening: grow in from the side nearest the selection, once per window.
  useLayoutEffect(() => {
    const element = rootRef.current
    if (enteredWindows.has(win.id)) return
    enteredWindows.add(win.id)
    if (!element || typeof element.animate !== 'function') return
    const reduced = prefersReducedMotion()
    element.style.transformOrigin = win.enterOrigin ?? 'center top'
    element.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'scale(0.96)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
      { duration: 200, easing: EASE_OUT },
    )
    // Once per window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(
    () => () => {
      // Forget a closed window (a minimised one is still in the store).
      if (!useFloatingQA.getState().windows.some((window) => window.id === win.id))
        enteredWindows.delete(win.id)
    },
    [win.id],
  )

  // "Explain" asks at once; "Ask" waits for the learner.
  useEffect(() => {
    if (win.start === 'explain' && win.turns.length === 0 && !win.pending) {
      void askInWindow(win.id, t('contextual.explainQuestion'))
    } else if (win.start === 'ask') {
      inputRef.current?.focus()
    }
    // Once per window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the conversation as answers arrive.
  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [win.turns.length, win.pending])

  /*
   * Drag and resize. A move only writes a transform to the window while the
   * pointer is down and commits the final place to the store on release, so
   * dragging re-renders nothing. A resize must reflow anyway; it commits at
   * most once per animation frame.
   */
  function startGesture(event: ReactPointerEvent, kind: 'move' | 'resize'): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    focus(win.id)
    const origin = { x: event.clientX, y: event.clientY, rect: win.rect }
    let latest = origin.rect
    let frame = 0
    const commitResize = (): void => {
      frame = 0
      setRect(win.id, latest)
    }
    // Listen on the window: the pointer may leave the handle while dragging.
    const onMove = (move: PointerEvent): void => {
      if (move.buttons === 0) {
        onUp()
        return
      }
      const dx = move.clientX - origin.x
      const dy = move.clientY - origin.y
      latest = clampRect(
        kind === 'move'
          ? { ...origin.rect, x: origin.rect.x + dx, y: origin.rect.y + dy }
          : { ...origin.rect, width: origin.rect.width + dx, height: origin.rect.height + dy },
      )
      if (kind === 'move') {
        const element = rootRef.current
        if (element)
          element.style.transform = `translate(${latest.x - origin.rect.x}px, ${latest.y - origin.rect.y}px)`
      } else if (!frame) {
        frame = requestAnimationFrame(commitResize)
      }
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      // Commit before dropping the transform, so the window never jumps back.
      flushSync(() => setRect(win.id, latest))
      if (rootRef.current) rootRef.current.style.transform = ''
      void persistWindowRect(win.id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function send(): void {
    if (!input.trim() || win.pending) return
    void askInWindow(win.id, input)
    setInput('')
  }

  async function save(): Promise<boolean> {
    setBusyAction('save')
    try {
      const note = await saveWindow(win.id)
      if (note) toast({ variant: 'success', title: t('walkthroughQA.saved') })
      return true
    } catch (err) {
      toast({
        variant: 'error',
        title: t('walkthroughQA.saveFailed'),
        description: friendlyAIError(err),
      })
      return false
    } finally {
      setBusyAction(null)
    }
  }

  async function addToCards(): Promise<void> {
    setBusyAction('cards')
    try {
      let noteId = win.noteId
      if (!noteId) noteId = (await saveWindow(win.id))?.id
      if (!noteId) return
      const added = await addNoteToCards(noteId)
      toast({
        variant: added > 0 ? 'success' : 'info',
        title:
          added > 0
            ? t('walkthroughQA.cardsAdded', { count: added })
            : t('walkthroughQA.cardsNone'),
      })
    } catch (err) {
      toast({
        variant: 'error',
        title: t('walkthroughQA.cardsFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setBusyAction(null)
    }
  }

  function requestClose(): void {
    if (!win.noteId && win.turns.length > 0) setConfirmClose(true)
    else close(win.id)
  }

  const saved = Boolean(win.noteId)
  const title = windowTitle(win, t)

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      data-floating-qa
      onPointerDownCapture={() => focus(win.id)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          setMinimized(win.id, true)
        }
      }}
      style={{
        left: win.rect.x,
        top: win.rect.y,
        width: win.rect.width,
        height: win.rect.height,
        zIndex: layer,
      }}
      className="fixed flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl lecture:rounded-2xl lecture:border-input lecture:shadow-lift lab:rounded-none lab:border-input lab:shadow-lift"
    >
      <div
        className="flex cursor-move select-none items-center gap-2 border-b bg-muted/40 px-3 py-2 lecture:bg-transparent lecture:px-3.5 lecture:py-2.5 lab:bg-background lab:py-1.5"
        onPointerDown={(event) => startGesture(event, 'move')}
      >
        <GripHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium lecture:font-heading lecture:font-bold lab:font-mono lab:text-xs"
          title={title}
        >
          {title}
        </span>
        {saved && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground lab:font-mono">
            <BookmarkCheck className="h-3.5 w-3.5" aria-hidden />
            {t('walkthroughQA.savedBadge')}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t('walkthroughQA.minimize')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setMinimized(win.id, true)}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t('common.close')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={requestClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <button
        type="button"
        className={cn(
          'focus-ring mx-3 mt-2 line-clamp-2 rounded bg-muted/60 px-2 py-1 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted',
          'lecture:mx-4 lecture:mt-3 lecture:bg-transparent lecture:px-0 lecture:font-heading lecture:text-sm lecture:text-foreground lecture:hover:bg-transparent lecture:hover:text-primary',
          'lab:rounded-none lab:border-l-2 lab:border-primary lab:bg-transparent lab:py-0.5 lab:pl-2 lab:hover:bg-muted',
        )}
        title={t('walkthroughQA.jumpBack')}
        onClick={() => {
          if (!revealPassage(win.passage.sectionId, win.passage.anchor)) {
            toast({ variant: 'info', title: t('walkthroughQA.passageChanged') })
          }
        }}
      >
        “{win.passage.quote}”
      </button>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2 lecture:px-4"
      >
        {win.turns.map((turn, index) => (
          <div key={index} className="space-y-2">
            <p className="ml-auto w-fit max-w-full rounded-lg bg-primary/10 px-2 py-1 text-[13px] text-foreground lecture:ml-0 lecture:bg-transparent lecture:px-0 lecture:text-muted-foreground lab:rounded-none lab:bg-theme-primary-soft">
              {turn.question}
            </p>
            <RichText
              text={turn.answer}
              format="markdown"
              className="space-y-2"
              paragraphClassName="text-[14px] leading-[1.7]"
            />
          </div>
        ))}
        {win.pending && (
          <div className="space-y-2">
            <p className="ml-auto w-fit max-w-full rounded-lg bg-primary/10 px-2 py-1 text-[13px] text-foreground lecture:ml-0 lecture:bg-transparent lecture:px-0 lecture:text-muted-foreground lab:rounded-none lab:bg-theme-primary-soft">
              {win.pending}
            </p>
            <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('contextual.thinking')}
            </p>
          </div>
        )}
        {win.error && (
          <div role="alert" className="space-y-1">
            <p className="text-[13px] text-destructive">{t('contextual.failed')}</p>
            <p className="break-words text-[12px] text-muted-foreground">{win.error}</p>
          </div>
        )}
        {win.turns.length === 0 && !win.pending && !win.error && (
          <p className="text-[13px] text-muted-foreground">{t('walkthroughQA.askHint')}</p>
        )}
      </div>

      {confirmClose ? (
        <div className="space-y-2 border-t px-3 py-2">
          <p className="text-[13px]">{t('walkthroughQA.closeUnsaved')}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => close(win.id)}>
              {t('walkthroughQA.discard')}
            </Button>
            <Button
              size="sm"
              disabled={busyAction !== null}
              onClick={() => void save().then((ok) => ok && close(win.id))}
            >
              {t('walkthroughQA.saveAndClose')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 border-t px-3 py-2">
          <Textarea
            ref={inputRef}
            rows={2}
            value={input}
            disabled={Boolean(win.pending)}
            aria-label={t('contextual.questionLabel')}
            placeholder={t('walkthroughQA.placeholder')}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            className="text-[14px] leading-[1.6]"
          />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={saved || win.turns.length === 0 || busyAction !== null}
              onClick={() => void save()}
            >
              {busyAction === 'save' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saved ? (
                <BookmarkCheck className="h-3.5 w-3.5" />
              ) : (
                <Bookmark className="h-3.5 w-3.5" />
              )}
              {saved ? t('walkthroughQA.savedBadge') : t('walkthroughQA.save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={win.turns.length === 0 || busyAction !== null}
              onClick={() => void addToCards()}
            >
              {busyAction === 'cards' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
              {t('walkthroughQA.addToCards')}
            </Button>
            <Button
              size="sm"
              className="ml-auto"
              onClick={send}
              disabled={Boolean(win.pending) || !input.trim()}
            >
              {win.pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t('contextual.send')}
            </Button>
          </div>
        </div>
      )}

      <div
        role="presentation"
        aria-hidden
        onPointerDown={(event) => startGesture(event, 'resize')}
        className={cn(
          'absolute bottom-0 right-0 h-4 w-4 cursor-se-resize',
          'bg-[linear-gradient(135deg,transparent_50%,hsl(var(--muted-foreground)/0.45)_50%,transparent_60%,transparent_70%,hsl(var(--muted-foreground)/0.45)_70%,transparent_80%)]',
        )}
      />
    </div>
  )
}
