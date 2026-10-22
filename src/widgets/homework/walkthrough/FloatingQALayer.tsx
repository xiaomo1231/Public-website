import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  Bookmark,
  BookmarkCheck,
  GripHorizontal,
  Layers,
  Link2,
  Loader2,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  Minus,
  Pin,
  PinOff,
  Send,
  X,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { TooltipProvider, TooltipWrapper } from '@/shared/ui/Tooltip'
import { Textarea } from '@/shared/ui/Textarea'
import { RichText } from '@/shared/ui/RichText'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { toast } from '@/features/toast/toastStore'
import {
  cardAutoHeightCap,
  cardSize,
  clampCard,
  clampCardSize,
  clampRect,
  convertCardPin,
  defaultCardWidth,
  fitCardHeight,
  useFloatingQA,
  windowMode,
  type CompactCard,
  type FloatingQAWindow,
} from '@/features/homework/floatingQAStore'
import {
  addNoteToCards,
  askInWindow,
  stopInWindow,
  persistCardSize,
  persistWindowRect,
  saveWindow,
  windowTitle,
} from '@/features/homework/floatingQA'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { EASE_OUT, prefersReducedMotion } from '@/shared/lib/motion'
import { capturePointer, passedDragThreshold, releasePointer } from '@/shared/lib/pointerGesture'
import { KEYBOARD_INSET_EVENT, keyboardLift, readKeyboardInset } from '@/shared/lib/keyboardInset'
import { useTranslation } from '@/i18n'
import type { WalkthroughNoteTurn } from '@/entities/homework/walkthrough'
import { revealPassage } from './passage'

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** The keyboard inset published by `installKeyboardAvoidance`, kept current. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(() => readKeyboardInset())
  useEffect(() => {
    const update = (): void => setInset(readKeyboardInset())
    window.addEventListener(KEYBOARD_INSET_EVENT, update)
    update()
    return () => window.removeEventListener(KEYBOARD_INSET_EVENT, update)
  }, [])
  return inset
}

function layerBounds(layer: HTMLElement): { width: number; height: number } {
  return { width: layer.clientWidth, height: layer.clientHeight }
}

/**
 * The floating question windows of one assignment, its cards and the dock of
 * minimised ones. `cardLayer` is the walkthrough's card layer: cards that
 * follow the page are rendered inside it, positioned in its coordinates.
 */
export function FloatingQALayer({
  setId,
  cardLayer = null,
}: {
  setId: string
  cardLayer?: HTMLElement | null
}): JSX.Element {
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
      for (const window of store.windows) {
        store.setRect(window.id, clampRect(window.rect))
        if (window.compact?.pinned) {
          const card = clampCard(window.compact, viewport())
          if (card.x !== window.compact.x || card.y !== window.compact.y)
            store.setCard(window.id, card)
        }
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const cards = windows.filter((window) => windowMode(window) === 'compact')
  const pinnedCards = cards.filter((window) => window.compact!.pinned || !cardLayer)
  const attachedCards = cards.filter((window) => !window.compact!.pinned && cardLayer)

  return (
    <TooltipProvider delayDuration={300}>
      {windows
        .filter((window) => windowMode(window) === 'full')
        .map((window, _, open) => (
          // Keep DOM order stable (a moved node would drop pointer capture
          // mid-drag); stack by rank so windows stay below dialogs (z-50).
          <FloatingQAWindowView
            key={window.id}
            win={window}
            layer={41 + open.filter((other) => other.z < window.z).length}
            cardLayer={cardLayer}
          />
        ))}
      {/* Pinned cards stack below the full windows (35-40). */}
      {pinnedCards.map((window) => (
        <CompactCardView
          key={window.id}
          win={window}
          layer={35 + pinnedCards.filter((other) => other.z < window.z).length}
          cardLayer={cardLayer}
          attached={false}
        />
      ))}
      {/* Cards that follow the page live in the walkthrough's card layer. */}
      {cardLayer &&
        attachedCards.length > 0 &&
        createPortal(
          attachedCards.map((window) => (
            <CompactCardView
              key={window.id}
              win={window}
              layer={1 + attachedCards.filter((other) => other.z < window.z).length}
              cardLayer={cardLayer}
              attached
            />
          )),
          cardLayer,
        )}
      {minimized.length > 0 && (
        // Above the windows (41–43) so they can never cover the chips, below
        // dialogs (z-50).
        <div
          role="region"
          className="fixed bottom-4 right-4 z-[44] flex max-w-[60vw] flex-wrap justify-end gap-2"
          aria-label={t('walkthroughQA.dock')}
        >
          {minimized.map((window) => (
            <div
              key={window.id}
              className="flex animate-pop-in items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 text-xs shadow-lg lab:rounded-none lab:font-mono lab:shadow-lift"
            >
              <button
                type="button"
                data-dock-chip={window.id}
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
                  onClick={() => {
                    if (!window.noteId) stopInWindow(window.id)
                    close(window.id)
                    returnFocusAfterClose(window.id, window.passage.setId)
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </TooltipProvider>
  )
}

/**
 * Windows that have played their opening animation. A window unmounts while
 * minimised, so this keeps a restore or a raise from replaying it.
 */
const enteredWindows = new Set<string>()

/** Where focus goes back to when a window closes: what was focused when it opened. */
const returnFocusTargets = new Map<string, HTMLElement>()

function focusArticle(setId: string): void {
  document
    .querySelector<HTMLElement>(
      `[data-selection-context="walkthrough"][data-walkthrough-set="${CSS.escape(setId)}"]`,
    )
    ?.focus({ preventScroll: true })
}

/**
 * After tucking a conversation into the text, focus its chip under the
 * section (the keyboard way back to it), or the article.
 */
function focusTuckedChip(win: FloatingQAWindow): void {
  const chip =
    document.querySelector<HTMLElement>(`[data-tucked-chip="${CSS.escape(win.id)}"]`) ??
    (win.noteId
      ? document.querySelector<HTMLElement>(`[data-note-chip="${CSS.escape(win.noteId)}"]`)
      : null)
  if (chip) chip.focus({ preventScroll: true })
  else focusArticle(win.passage.setId)
}

/** Move focus to a window's dock chip after it was minimised. */
function focusDockChip(id: string): void {
  document
    .querySelector<HTMLElement>(`[data-dock-chip="${CSS.escape(id)}"]`)
    ?.focus({ preventScroll: true })
}

/**
 * After closing a window, focus what was focused before it opened, or the
 * walkthrough article when that element is gone (e.g. the selection toolbar).
 */
function returnFocusAfterClose(id: string, setId: string): void {
  const previous = returnFocusTargets.get(id)
  returnFocusTargets.delete(id)
  enteredWindows.delete(id)
  if (
    previous?.isConnected &&
    previous !== document.body &&
    !previous.closest('[data-floating-qa]')
  ) {
    previous.focus({ preventScroll: true })
    return
  }
  focusArticle(setId)
}

/** The conversation so far; only re-renders when a turn is added. */
const TurnList = memo(function TurnList({ turns }: { turns: WalkthroughNoteTurn[] }): JSX.Element {
  return (
    <>
      {turns.map((turn, index) => (
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
    </>
  )
})

// Each window re-renders only when its own record (or its stacking rank)
// changes, not when a sibling moves, resizes or receives an answer.
const FloatingQAWindowView = memo(function FloatingQAWindowView({
  win,
  layer,
  cardLayer,
}: {
  win: FloatingQAWindow
  layer: number
  cardLayer: HTMLElement | null
}): JSX.Element {
  const { t } = useTranslation()
  const { focus, close, setMinimized, setRect, compact, tuck } = useFloatingQA.getState()
  const [input, setInput] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const [busyAction, setBusyAction] = useState<'save' | 'cards' | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // While the learner types here with the on-screen keyboard open, the window
  // is lifted above it. Only the rendered position moves; the stored rect
  // (and what is saved) stays, so it drops back when focus leaves or the
  // keyboard closes.
  const [focusWithin, setFocusWithin] = useState(false)
  const keyboardInset = useKeyboardInset()
  const lift = focusWithin ? keyboardLift(win.rect, keyboardInset, window.innerHeight) : 0

  // Opening: grow in from the side nearest the selection, once per window.
  useLayoutEffect(() => {
    const element = rootRef.current
    if (enteredWindows.has(win.id)) {
      // Restored from the dock: take focus from the (now gone) dock chip.
      element?.focus({ preventScroll: true })
      return
    }
    enteredWindows.add(win.id)
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body)
      returnFocusTargets.set(win.id, active)
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
      if (!useFloatingQA.getState().windows.some((window) => window.id === win.id)) {
        enteredWindows.delete(win.id)
        returnFocusTargets.delete(win.id)
      }
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
   * Drag and resize. While the pointer is down a move only writes a transform
   * and a resize only writes width / height to the window element; the final
   * rect is committed to the store on release, so neither gesture re-renders
   * anything until it ends.
   */
  function startGesture(event: ReactPointerEvent, kind: 'move' | 'resize'): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    focus(win.id)
    // Finger, pen and mouse alike: the handle keeps the pointer (and iPadOS
    // does not turn the gesture into a page scroll; the handles are
    // `touch-none`). A small travel threshold keeps a tap a tap.
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const pointerType = event.pointerType
    capturePointer(handle, pointerId)
    const origin = { x: event.clientX, y: event.clientY, rect: win.rect }
    let latest = origin.rect
    let moved = false
    // Listen on the window: the pointer may leave the handle while dragging.
    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== pointerId) return
      if (move.buttons === 0) {
        onUp()
        return
      }
      if (!moved && !passedDragThreshold(origin, { x: move.clientX, y: move.clientY }, pointerType))
        return
      moved = true
      const dx = move.clientX - origin.x
      const dy = move.clientY - origin.y
      latest = clampRect(
        kind === 'move'
          ? { ...origin.rect, x: origin.rect.x + dx, y: origin.rect.y + dy }
          : { ...origin.rect, width: origin.rect.width + dx, height: origin.rect.height + dy },
      )
      const element = rootRef.current
      if (!element) return
      if (kind === 'move') {
        element.style.transform = `translate(${latest.x - origin.rect.x}px, ${latest.y - origin.rect.y}px)`
      } else {
        element.style.width = `${latest.width}px`
        element.style.height = `${latest.height}px`
      }
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      releasePointer(handle, pointerId)
      if (!moved) return
      // Commit before dropping the transform, so the window never jumps back.
      flushSync(() => setRect(win.id, latest))
      if (rootRef.current) rootRef.current.style.transform = ''
      void persistWindowRect(win.id).catch(() => undefined)
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

  function closeNow(): void {
    // An unsaved conversation's answer would be thrown away: stop paying for
    // it. A saved note keeps receiving its turn (it is written to the note).
    if (!win.noteId) stopInWindow(win.id)
    close(win.id)
    returnFocusAfterClose(win.id, win.passage.setId)
  }

  function requestClose(): void {
    if (!win.noteId && win.turns.length > 0) setConfirmClose(true)
    else closeNow()
  }

  /** Minimise into the dock and move focus to this window's dock chip. */
  function minimize(): void {
    flushSync(() => setMinimized(win.id, true))
    focusDockChip(win.id)
  }

  /**
   * Shrink to a card where the window is. It starts pinned or following the
   * page like the last card did (pinned at first, like a window).
   */
  function shrink(): void {
    // A size set by hand earlier comes back; otherwise 320px wide and as tall
    // as the content (measured once the card renders).
    const size = win.cardSize
    const pinnedCard: CompactCard = {
      x: win.rect.x,
      y: win.rect.y,
      pinned: true,
      width: size?.width ?? defaultCardWidth(window.innerWidth),
      ...(size ? { height: size.height, manual: true } : {}),
    }
    const card =
      !useFloatingQA.getState().cardPinned && cardLayer
        ? clampCard(
            convertCardPin(pinnedCard, false, cardLayer.getBoundingClientRect()),
            layerBounds(cardLayer),
          )
        : clampCard(pinnedCard, viewport())
    flushSync(() => compact(win.id, card))
    document
      .querySelector<HTMLElement>(`[data-qa-card="${CSS.escape(win.id)}"]`)
      ?.focus({ preventScroll: true })
  }

  /** Hide the window; the passage is marked and shows the answer on hover. */
  function tuckIntoText(): void {
    flushSync(() => tuck(win.id))
    focusTuckedChip(win)
  }

  const saved = Boolean(win.noteId)
  const title = windowTitle(win, t)

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      data-floating-qa
      onPointerDownCapture={() => focus(win.id)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false)
      }}
      data-keyboard-managed
      data-keyboard-lift={lift ? '' : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          minimize()
        }
      }}
      style={{
        left: win.rect.x,
        top: win.rect.y + lift,
        width: win.rect.width,
        height: win.rect.height,
        zIndex: layer,
      }}
      className="fixed flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl outline-none lecture:rounded-2xl lecture:border-input lecture:shadow-lift lab:rounded-none lab:border-input lab:shadow-lift"
    >
      <div
        data-drag-handle
        className="flex cursor-move touch-none select-none items-center gap-2 border-b bg-muted/40 px-3 py-2 lecture:bg-transparent lecture:px-3.5 lecture:py-2.5 lab:bg-background lab:py-1.5"
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
        <TooltipWrapper content={t('walkthroughQA.tuckHint')}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('walkthroughQA.tuck')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={tuckIntoText}
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipWrapper>
        <TooltipWrapper content={t('walkthroughQA.compactHint')}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('walkthroughQA.compact')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={shrink}
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipWrapper>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t('walkthroughQA.minimize')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={minimize}
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
        <TurnList turns={win.turns} />
        {win.pending && (
          <div className="space-y-2">
            <p className="ml-auto w-fit max-w-full rounded-lg bg-primary/10 px-2 py-1 text-[13px] text-foreground lecture:ml-0 lecture:bg-transparent lecture:px-0 lecture:text-muted-foreground lab:rounded-none lab:bg-theme-primary-soft">
              {win.pending}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <p
                role="status"
                className="flex items-center gap-2 text-[13px] text-muted-foreground"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t('contextual.thinking')}
              </p>
              <GenerationControls
                kind="single"
                state="running"
                className="ml-auto"
                onStopNow={() => {
                  // The question goes back into the box so it can be asked again.
                  const question = stopInWindow(win.id)
                  if (question && !input.trim()) setInput(question)
                }}
              />
            </div>
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
            <Button size="sm" variant="outline" onClick={closeNow}>
              {t('walkthroughQA.discard')}
            </Button>
            <Button
              size="sm"
              disabled={busyAction !== null}
              onClick={() => void save().then((ok) => ok && closeNow())}
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
            enterKeyHint="send"
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

      {/* The grip is drawn 16px; on a touch screen the hit area grows to
          44px (bottom-right corner) so a finger can take it. */}
      <div
        role="presentation"
        aria-hidden
        data-resize-handle
        onPointerDown={(event) => startGesture(event, 'resize')}
        className={cn(
          'absolute bottom-0 right-0 h-4 w-4 cursor-se-resize touch-none bg-no-repeat [background-position:bottom_right] [background-size:1rem_1rem] coarse:h-11 coarse:w-11',
          'bg-[linear-gradient(135deg,transparent_50%,hsl(var(--muted-foreground)/0.45)_50%,transparent_60%,transparent_70%,hsl(var(--muted-foreground)/0.45)_70%,transparent_80%)]',
        )}
      />
    </div>
  )
})

/** Cards that have played their opening animation (pinning re-mounts a card). */
const shownCards = new Set<string>()

/**
 * A window shrunk to a card: its title, the latest question and the whole
 * latest answer. It fits its content (up to a cap, then the answer scrolls)
 * until the learner resizes it from the corner grip. Drag it anywhere; click
 * it (or Expand) to get the full window back. A pinned card is fixed to the
 * screen; one that follows the page sits in the walkthrough's card layer and
 * scrolls with the text.
 */
const CompactCardView = memo(function CompactCardView({
  win,
  layer,
  cardLayer,
  attached,
}: {
  win: FloatingQAWindow
  layer: number
  cardLayer: HTMLElement | null
  attached: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const { raise, setCard, resizeCard, expand, setMinimized, tuck } = useFloatingQA.getState()
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [firstShow] = useState(() => !shownCards.has(win.id))
  const [overflowing, setOverflowing] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const card = win.compact!
  const { width } = cardSize(card)
  const title = windowTitle(win, t)
  const latest = win.turns[win.turns.length - 1]
  const question = win.pending ?? latest?.question

  useEffect(() => {
    shownCards.add(win.id)
    return () => {
      // Forget the card once it is no longer one (expanded, tucked, closed).
      if (
        !useFloatingQA.getState().windows.some((window) => window.id === win.id && window.compact)
      )
        shownCards.delete(win.id)
    }
  }, [win.id])

  const bounds = useCallback(
    (pinned: boolean): { width: number; height: number } =>
      !pinned && cardLayer ? layerBounds(cardLayer) : viewport(),
    [cardLayer],
  )

  /**
   * Fit the card to its content (header + question + answer) unless the
   * learner sized it, and note whether the body now scrolls. Nothing is
   * written when there is no layout (a hidden page).
   */
  const measure = useCallback((): void => {
    const root = rootRef.current
    const body = bodyRef.current
    const content = contentRef.current
    if (!root || !body || !content || content.offsetHeight <= 0) return
    const current = useFloatingQA.getState().windows.find((window) => window.id === win.id)?.compact
    if (!current) return
    if (!current.manual) {
      const needed = root.offsetHeight - body.clientHeight + content.offsetHeight
      const height = fitCardHeight(needed, window.innerHeight)
      if (current.height !== height)
        setCard(win.id, clampCard({ ...current, height }, bounds(current.pinned)))
    }
    setOverflowing(content.offsetHeight > body.clientHeight + 1)
    setAtEnd(body.scrollTop + body.clientHeight >= content.offsetHeight - 2)
  }, [win.id, setCard, bounds])

  // Re-fit when the answer changes (KaTeX renders synchronously).
  useLayoutEffect(measure, [
    measure,
    latest?.answer,
    question,
    win.error,
    card.manual,
    card.width,
    card.height,
  ])
  // …and when the content reflows later (fonts, the card resized).
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    if (contentRef.current) observer.observe(contentRef.current)
    if (bodyRef.current) observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [measure])

  /** Back to the full window (its previous size) where the card is on screen. */
  function expandNow(): void {
    let { x, y } = card
    if (attached && cardLayer) {
      const origin = cardLayer.getBoundingClientRect()
      x += origin.left
      y += origin.top
    }
    flushSync(() => expand(win.id, clampRect({ ...win.rect, x, y })))
  }

  /** Pin to the screen or follow the page, without the card moving on screen. */
  function togglePin(): void {
    if (!cardLayer) return
    const next = convertCardPin(card, !card.pinned, cardLayer.getBoundingClientRect())
    // The card moves between the fixed layer and the card layer: keep focus.
    flushSync(() => setCard(win.id, clampCard(next, bounds(next.pinned))))
    document
      .querySelector<HTMLElement>(`[data-qa-card="${CSS.escape(win.id)}"] [data-pin-toggle]`)
      ?.focus({ preventScroll: true })
  }

  function tuckIntoText(): void {
    flushSync(() => tuck(win.id))
    focusTuckedChip(win)
  }

  function minimize(): void {
    flushSync(() => setMinimized(win.id, true))
    focusDockChip(win.id)
  }

  /**
   * Drag, or click to expand. Like the window, a drag only writes a transform
   * until release; a press that barely moves is a click. A finger or pen on
   * an answer long enough to scroll scrolls it instead.
   */
  function startDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement
    if (event.button !== 0 || target.closest('button')) return
    const body = bodyRef.current
    if (body && overflowing && body.contains(target)) {
      if (event.pointerType !== 'mouse') return
      // A press on the body's own scrollbar.
      if (target === body && event.nativeEvent.offsetX >= body.clientWidth) return
    }
    event.preventDefault()
    raise(win.id)
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const pointerType = event.pointerType
    capturePointer(handle, pointerId)
    const origin = { x: event.clientX, y: event.clientY }
    const start = card
    let latestCard = start
    let moved = false
    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== pointerId) return
      if (move.buttons === 0) {
        finish(false)
        return
      }
      const dx = move.clientX - origin.x
      const dy = move.clientY - origin.y
      if (!moved && !passedDragThreshold(origin, { x: move.clientX, y: move.clientY }, pointerType))
        return
      moved = true
      latestCard = clampCard({ ...start, x: start.x + dx, y: start.y + dy }, bounds(start.pinned))
      if (rootRef.current)
        rootRef.current.style.transform = `translate(${latestCard.x - start.x}px, ${latestCard.y - start.y}px)`
    }
    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)
    function finish(released: boolean): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      releasePointer(handle, pointerId)
      if (!moved) {
        if (released) expandNow()
        return
      }
      flushSync(() => setCard(win.id, latestCard))
      if (rootRef.current) rootRef.current.style.transform = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /**
   * Resize from the corner grip. Only the element's size changes while the
   * pointer is down; on release the size is kept (no more fitting) for this
   * visit, and on the saved note.
   */
  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    raise(win.id)
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const pointerType = event.pointerType
    capturePointer(handle, pointerId)
    const origin = { x: event.clientX, y: event.clientY }
    const start = {
      width: card.width ?? (rootRef.current?.offsetWidth || width),
      height: card.height ?? (rootRef.current?.offsetHeight || cardSize(card).height),
    }
    const pinned = card.pinned
    // At most the viewport (and the card layer's width) minus margins.
    const view = viewport()
    const limit =
      !pinned && cardLayer
        ? { width: Math.min(view.width, layerBounds(cardLayer).width), height: view.height }
        : view
    let size = start
    let moved = false
    const onMove = (move: PointerEvent): void => {
      if (move.pointerId !== pointerId) return
      if (move.buttons === 0) {
        finish()
        return
      }
      if (!moved && !passedDragThreshold(origin, { x: move.clientX, y: move.clientY }, pointerType))
        return
      moved = true
      size = clampCardSize(
        {
          width: start.width + move.clientX - origin.x,
          height: start.height + move.clientY - origin.y,
        },
        limit,
        pinned,
      )
      const element = rootRef.current
      if (!element) return
      element.style.maxHeight = 'none'
      element.style.width = `${size.width}px`
      element.style.height = `${size.height}px`
    }
    function finish(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      releasePointer(handle, pointerId)
      if (!moved) return
      flushSync(() => {
        resizeCard(win.id, size)
        const current = useFloatingQA
          .getState()
          .windows.find((window) => window.id === win.id)?.compact
        if (current) setCard(win.id, clampCard(current, bounds(current.pinned)))
      })
      void persistCardSize(win.id).catch(() => undefined)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={t('walkthroughQA.card', { title })}
      tabIndex={-1}
      data-floating-qa
      data-qa-card={win.id}
      data-attached={attached ? '' : undefined}
      onPointerDown={startDrag}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          minimize()
        }
      }}
      style={{
        left: card.x,
        top: card.y,
        width,
        height: card.height,
        // Until it is measured (and while it fits its content) the cap holds.
        maxHeight: card.manual ? undefined : cardAutoHeightCap(window.innerHeight),
        zIndex: layer,
      }}
      className={cn(
        attached ? 'pointer-events-auto absolute' : 'fixed',
        'flex cursor-grab touch-none select-none flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
        'lecture:rounded-2xl lecture:border-input lecture:shadow-lift lab:rounded-none lab:border-input lab:shadow-lift',
        firstShow && 'animate-pop-in',
      )}
    >
      <div className="flex shrink-0 items-center gap-1 border-b py-1 pl-2.5 pr-1 lecture:border-b-0 lab:bg-background">
        <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium lecture:font-heading lecture:font-bold lab:font-mono lab:text-[11px]"
          title={title}
        >
          {title}
        </span>
        {cardLayer && (
          <TooltipWrapper
            content={card.pinned ? t('walkthroughQA.pinHint') : t('walkthroughQA.followHint')}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              data-pin-toggle
              aria-label={t('walkthroughQA.pin')}
              aria-pressed={card.pinned}
              onClick={togglePin}
            >
              {card.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
            </Button>
          </TooltipWrapper>
        )}
        <TooltipWrapper content={t('walkthroughQA.tuckHint')}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={t('walkthroughQA.tuck')}
            onClick={tuckIntoText}
          >
            <Link2 className="h-3 w-3" />
          </Button>
        </TooltipWrapper>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={expandNow}>
          <Maximize2 className="h-3 w-3" aria-hidden />
          {t('walkthroughQA.expand')}
        </Button>
      </div>
      <div
        ref={bodyRef}
        data-card-body
        data-overflowing={overflowing ? '' : undefined}
        onScroll={(event) => {
          const body = event.currentTarget
          const end = contentRef.current?.offsetHeight ?? body.scrollHeight
          setAtEnd(body.scrollTop + body.clientHeight >= end - 2)
        }}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain',
          // A long answer scrolls: a finger pans it, the bottom fades until the end.
          overflowing && 'touch-pan-y',
          overflowing &&
            !atEnd &&
            '[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]',
        )}
      >
        <div ref={contentRef} data-card-content className="space-y-1.5 px-2.5 pb-4 pt-1.5">
          {question && (
            <p className="w-fit max-w-full rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-foreground lecture:bg-transparent lecture:px-0 lecture:text-muted-foreground lab:rounded-none lab:bg-theme-primary-soft">
              {question}
            </p>
          )}
          {win.pending ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              {t('contextual.thinking')}
            </p>
          ) : latest ? (
            <RichText
              text={latest.answer}
              format="markdown"
              className="space-y-1"
              paragraphClassName="text-[13px] leading-[1.55]"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {win.error ? t('contextual.failed') : t('walkthroughQA.noAnswer')}
            </p>
          )}
        </div>
      </div>
      {/* Same grip as the window: 16px drawn, 44px to a finger. */}
      <div
        role="presentation"
        aria-hidden
        data-card-resize
        onPointerDown={startResize}
        className={cn(
          'absolute bottom-0 right-0 z-[1] h-4 w-4 cursor-se-resize touch-none bg-no-repeat [background-position:bottom_right] [background-size:1rem_1rem] coarse:h-11 coarse:w-11',
          'bg-[linear-gradient(135deg,transparent_50%,hsl(var(--muted-foreground)/0.45)_50%,transparent_60%,transparent_70%,hsl(var(--muted-foreground)/0.45)_70%,transparent_80%)]',
        )}
      />
    </div>
  )
})
