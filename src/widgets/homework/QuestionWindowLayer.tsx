import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { FileText, GripHorizontal, Minus, PictureInPicture2, Pin, PinOff, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { TooltipProvider, TooltipWrapper } from '@/shared/ui/Tooltip'
import {
  QUESTION_FONT_SIZES,
  clampQuestionRect,
  convertQuestionPin,
  questionWindowLabel,
  useQuestionWindows,
  type QuestionTranslationMode,
  type QuestionWindow,
} from '@/features/homework/questionWindowStore'
import type { HomeworkQuestion } from '@/entities/homework/types'
import { capturePointer, passedDragThreshold, releasePointer } from '@/shared/lib/pointerGesture'
import { KEYBOARD_INSET_EVENT, keyboardLift, readKeyboardInset } from '@/shared/lib/keyboardInset'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { QuestionText } from './QuestionText'

/** What was focused when a window opened; focus goes back there on close. */
const returnTargets = new Map<string, HTMLElement>()

function focusWindow(questionId: string): void {
  document
    .querySelector<HTMLElement>(`[data-question-window="${CSS.escape(questionId)}"]`)
    ?.focus({ preventScroll: true })
}

function returnFocus(questionId: string): void {
  const target = returnTargets.get(questionId)
  returnTargets.delete(questionId)
  if (target?.isConnected) target.focus({ preventScroll: true })
}

function pageBounds(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: Number.POSITIVE_INFINITY,
  }
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * 「在浮动窗口中查看」: opens (or brings forward) this question's own
 * floating window, showing only its text.
 */
export function QuestionWindowButton({
  question,
  label,
  translationMode = 'request',
  className,
}: {
  question: Pick<HomeworkQuestion, 'id' | 'setId' | 'prompt' | 'translation' | 'number' | 'order'>
  label?: string
  translationMode?: QuestionTranslationMode
  className?: string
}): JSX.Element {
  const { t } = useTranslation()
  const open = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    // Stop a click inside <summary> from also toggling its <details>.
    event.preventDefault()
    event.stopPropagation()
    if (!returnTargets.has(question.id)) returnTargets.set(question.id, event.currentTarget)
    flushSync(() => {
      useQuestionWindows.getState().open({
        questionId: question.id,
        setId: question.setId,
        prompt: question.prompt,
        ...(question.translation ? { translation: question.translation } : {}),
        label: label ?? questionWindowLabel(question),
        translationMode,
      })
    })
    focusWindow(question.id)
  }
  return (
    // Its own provider: the button is used in pages that have none.
    <TooltipProvider delayDuration={300}>
      <TooltipWrapper content={t('homework.questionWindow.open')}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-open-question-window={question.id}
          aria-label={t('homework.questionWindow.open')}
          className={cn('h-8 w-8 shrink-0 text-muted-foreground', className)}
          onClick={open}
        >
          <PictureInPicture2 className="h-4 w-4" aria-hidden />
        </Button>
      </TooltipWrapper>
    </TooltipProvider>
  )
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

/**
 * The floating 原题 windows of one homework set and the dock of minimised
 * ones. Mount once per set page: the windows stay while the learner moves
 * between questions and views, and close when the set is left.
 */
export function QuestionWindowLayer({ setId }: { setId: string }): JSX.Element | null {
  const { t } = useTranslation()
  const all = useQuestionWindows((state) => state.windows)
  const windows = useMemo(() => all.filter((window) => window.setId === setId), [all, setId])
  const shown = windows.filter((window) => !window.minimized)
  const minimized = windows.filter((window) => window.minimized)

  // Leaving the set closes its windows.
  useEffect(() => () => useQuestionWindows.getState().closeSet(setId), [setId])

  // Keep pinned windows on screen when the browser window shrinks.
  useEffect(() => {
    function onResize(): void {
      const store = useQuestionWindows.getState()
      for (const window_ of store.windows) {
        const next = clampQuestionRect(window_.rect, window_.pinned ? viewport() : pageBounds())
        if (
          next.x !== window_.rect.x ||
          next.y !== window_.rect.y ||
          next.width !== window_.rect.width ||
          next.height !== window_.rect.height
        )
          store.setRect(window_.questionId, next)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (windows.length === 0) return null
  return (
    <TooltipProvider delayDuration={300}>
      {shown.map((window_) => {
        // Below the walkthrough's cards (35–40) and Q&A windows (41–43), above the page.
        const layer = 31 + shown.filter((other) => other.z < window_.z).length
        // In <body>: `fixed` is not caught by a transformed ancestor, and a
        // window that follows the page is positioned in document coordinates.
        // Same container either way, so pinning does not re-mount it.
        return createPortal(
          <QuestionWindowView win={window_} layer={layer} />,
          document.body,
          window_.questionId,
        )
      })}
      {minimized.length > 0 && (
        <div
          role="region"
          aria-label={t('homework.questionWindow.dock')}
          className="fixed bottom-4 left-4 z-[44] flex max-w-[60vw] flex-wrap gap-2 print:hidden"
        >
          {minimized.map((window_) => (
            <div
              key={window_.questionId}
              className="flex animate-pop-in items-center gap-1 rounded-full border bg-card py-1 pl-3 pr-1 text-xs shadow-lg lab:rounded-none lab:font-mono lab:shadow-lift"
            >
              <button
                type="button"
                data-question-dock-chip={window_.questionId}
                className="focus-ring flex min-h-8 max-w-[14rem] items-center gap-1.5 truncate coarse:min-h-11"
                onClick={() => {
                  flushSync(() => useQuestionWindows.getState().focus(window_.questionId))
                  focusWindow(window_.questionId)
                }}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">
                  {t('homework.questionWindow.title', { label: window_.label })}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t('common.close')}
                onClick={() => {
                  useQuestionWindows.getState().close(window_.questionId)
                  returnFocus(window_.questionId)
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </TooltipProvider>
  )
}

const QuestionWindowView = memo(function QuestionWindowView({
  win,
  layer,
}: {
  win: QuestionWindow
  layer: number
}): JSX.Element {
  const { t } = useTranslation()
  const { focus, close, setMinimized, setRect, setPinned, setFontStep } =
    useQuestionWindows.getState()
  const rootRef = useRef<HTMLDivElement>(null)
  const keyboardInset = useKeyboardInset()
  // Pinned and the on-screen keyboard is up (the learner is typing an
  // answer): lift the window above it so the question stays readable. Only
  // the rendered position moves; it drops back when the keyboard closes.
  const lift = win.pinned ? keyboardLift(win.rect, keyboardInset, window.innerHeight) : 0
  const title = t('homework.questionWindow.title', { label: win.label })
  const fontSize = QUESTION_FONT_SIZES[win.fontStep] ?? QUESTION_FONT_SIZES[2]

  useLayoutEffect(() => {
    // Opened or restored from the dock (once per mount): take focus.
    if (!rootRef.current?.contains(document.activeElement))
      rootRef.current?.focus({ preventScroll: true })
  }, [])

  function bounds(pinned: boolean): { width: number; height: number } {
    return pinned ? viewport() : pageBounds()
  }

  /*
   * Drag and resize: while the pointer is down only the element's transform
   * (or size) changes; the rect is committed on release.
   */
  function startGesture(event: ReactPointerEvent, kind: 'move' | 'resize'): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    focus(win.questionId)
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const pointerType = event.pointerType
    capturePointer(handle, pointerId)
    const origin = { x: event.clientX, y: event.clientY, rect: win.rect }
    let latest = origin.rect
    let moved = false
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
      latest = clampQuestionRect(
        kind === 'move'
          ? { ...origin.rect, x: origin.rect.x + dx, y: origin.rect.y + dy }
          : { ...origin.rect, width: origin.rect.width + dx, height: origin.rect.height + dy },
        bounds(win.pinned),
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
      flushSync(() => setRect(win.questionId, latest))
      if (rootRef.current) rootRef.current.style.transform = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function closeNow(): void {
    close(win.questionId)
    returnFocus(win.questionId)
  }

  function minimize(): void {
    flushSync(() => setMinimized(win.questionId, true))
    document
      .querySelector<HTMLElement>(`[data-question-dock-chip="${CSS.escape(win.questionId)}"]`)
      ?.focus({ preventScroll: true })
  }

  /** Pin to the screen or follow the page, without moving on screen. */
  function togglePin(): void {
    const pinned = !win.pinned
    const rect = clampQuestionRect(
      convertQuestionPin(win.rect, pinned, { x: window.scrollX, y: window.scrollY }),
      bounds(pinned),
    )
    // The window moves between the fixed layer and the page: keep focus.
    flushSync(() => setPinned(win.questionId, pinned, rect))
    document
      .querySelector<HTMLElement>(
        `[data-question-window="${CSS.escape(win.questionId)}"] [data-pin-toggle]`,
      )
      ?.focus({ preventScroll: true })
  }

  const headerButton = 'h-8 w-8 coarse:h-11 coarse:w-11'
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      tabIndex={-1}
      data-question-window={win.questionId}
      data-pinned={win.pinned ? '' : undefined}
      data-keyboard-managed
      onPointerDownCapture={() => focus(win.questionId)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          closeNow()
        }
      }}
      style={{
        left: win.rect.x,
        top: win.rect.y + lift,
        width: win.rect.width,
        height: win.rect.height,
        zIndex: layer,
      }}
      className={cn(
        win.pinned ? 'fixed' : 'absolute',
        'flex animate-pop-in flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden',
        'lecture:rounded-2xl lecture:border-input lecture:shadow-lift lab:rounded-none lab:border-input lab:shadow-lift',
      )}
    >
      <div
        data-drag-handle
        className="flex cursor-move touch-none select-none items-center gap-1 border-b bg-muted/40 py-1 pl-3 pr-1 lecture:bg-transparent lab:bg-background"
        onPointerDown={(event) => startGesture(event, 'move')}
      >
        <GripHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium lecture:font-heading lecture:font-bold lab:font-mono lab:text-xs"
          title={title}
        >
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={cn(headerButton, 'text-xs font-semibold')}
          aria-label={t('homework.questionWindow.smaller')}
          disabled={win.fontStep <= 0}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setFontStep(win.questionId, win.fontStep - 1)}
        >
          A−
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(headerButton, 'text-sm font-semibold')}
          aria-label={t('homework.questionWindow.larger')}
          disabled={win.fontStep >= QUESTION_FONT_SIZES.length - 1}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setFontStep(win.questionId, win.fontStep + 1)}
        >
          A+
        </Button>
        <TooltipWrapper
          content={
            win.pinned
              ? t('homework.questionWindow.pinHint')
              : t('homework.questionWindow.followHint')
          }
        >
          <Button
            variant="ghost"
            size="icon"
            className={headerButton}
            data-pin-toggle
            aria-label={t('homework.questionWindow.pin')}
            aria-pressed={win.pinned}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={togglePin}
          >
            {win.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
          </Button>
        </TooltipWrapper>
        <Button
          variant="ghost"
          size="icon"
          className={headerButton}
          aria-label={t('homework.questionWindow.minimize')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={minimize}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={headerButton}
          aria-label={t('common.close')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={closeNow}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
        data-question-window-body
      >
        <QuestionText
          question={{
            id: win.questionId,
            prompt: win.prompt,
            ...(win.translation ? { translation: win.translation } : {}),
          }}
          translationMode={win.translationMode}
          textStyle={{ fontSize }}
          className="[&_p]:mb-3"
          paragraphClassName="leading-[1.7]"
        />
      </div>

      {/* 16px drawn; 44px to a finger. */}
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
