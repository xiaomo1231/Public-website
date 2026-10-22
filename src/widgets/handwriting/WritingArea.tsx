import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  FilePlus2,
  Loader2,
  PenLine,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import type { StoredStrokePage } from '@/entities/handwriting/strokes'
import {
  asPointerKind,
  boardFromPages,
  boardReducer,
  MAX_PAGES,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  pointerIntent,
  type BoardAction,
  type BoardState,
  type InkPoint,
  type InkTool,
} from './strokeModel'
import { drawPage, drawStroke, exportPagePng } from './inkRender'
import { PAPER, paperBackgroundStyle } from './paper'
import { inkFingerprint, pagesFromStored, pagesToSave } from './writingAreaModel'

export interface WritingAreaPage {
  image: Blob
  strokes: StoredStrokePage
  page: number
}

export interface WritingAreaProps {
  /** Accessible name, e.g. "Writing area for question 3". */
  label: string
  /** Saved pages of this area (answer images with `writingPage` + `strokes`). */
  initial: ReadonlyArray<{ writingPage?: number; strokes?: unknown }>
  /** Persist every page with ink (replaces the area's previous pages). */
  onSave: (pages: WritingAreaPage[]) => Promise<void>
  /** Hand the parent a way to save pending ink immediately (before 交卷). */
  registerFlush?: (flush: (() => Promise<void>) | null) => void
  disabled?: boolean
}

const PEN_WIDTH = 3.5
const SAVE_DELAY_MS = 800

function pointFrom(event: { clientX: number; clientY: number; pressure: number }, rect: DOMRect) {
  return {
    x: ((event.clientX - rect.left) / rect.width) * PAGE_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * PAGE_HEIGHT,
    pressure: event.pressure,
  } satisfies InkPoint
}

/**
 * 平板手写: a writing area printed under a question on the exam paper. Same
 * pen engine as the pen board — a pen (Apple Pencil) or a mouse writes, a
 * finger scrolls the page and is ignored while the pen writes (palm
 * rejection), only the canvas takes `touch-action: none`. The paper stays
 * white in dark mode. Ink is saved shortly after each stroke as one PNG plus
 * its strokes per page; nothing is recognised until the paper is handed in.
 */
export function WritingArea({
  label,
  initial,
  onSave,
  registerFlush,
  disabled = false,
}: WritingAreaProps): JSX.Element {
  const { t } = useTranslation()
  const stateRef = useRef<BoardState>(boardFromPages(pagesFromStored(initial)))
  const savedRef = useRef(inkFingerprint(stateRef.current.pages))
  const [, setVersion] = useState(0)
  const [tool, setTool] = useState<InkTool>('pen')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const scaleRef = useRef(1)
  const timerRef = useRef<number | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const savingRef = useRef<Promise<void> | null>(null)

  const save = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // One save at a time; a later change saves again afterwards.
    if (savingRef.current) await savingRef.current.catch(() => undefined)
    const pages = stateRef.current.pages
    const fingerprint = inkFingerprint(pages)
    if (fingerprint === savedRef.current) return
    const run = (async () => {
      setSaving(true)
      setError(null)
      try {
        const out: WritingAreaPage[] = []
        for (const item of pagesToSave(pages))
          out.push({
            image: await exportPagePng(item.source),
            strokes: item.strokes,
            page: item.page,
          })
        await onSaveRef.current(out)
        savedRef.current = fingerprint
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : t('handwriting.saveFailed'))
        throw err
      } finally {
        setSaving(false)
      }
    })()
    savingRef.current = run
    try {
      await run
    } finally {
      if (savingRef.current === run) savingRef.current = null
    }
  }, [t])

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void save().catch(() => undefined)
    }, SAVE_DELAY_MS)
  }, [save])

  useEffect(() => {
    registerFlush?.(() => save())
    return () => registerFlush?.(null)
  }, [registerFlush, save])

  // Unmounting with pending ink (e.g. the paper is handed in) saves it.
  useEffect(
    () => () => {
      if (timerRef.current !== null) void save().catch(() => undefined)
    },
    [save],
  )

  const apply = useCallback(
    (action: BoardAction, rerender = true) => {
      const before = stateRef.current
      stateRef.current = boardReducer(before, action)
      if (rerender) setVersion((value) => value + 1)
      if (stateRef.current.pages !== before.pages) scheduleSave()
    },
    [scheduleSave],
  )

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const current = stateRef.current
    drawPage(ctx, current.pages[current.page] ?? [], scaleRef.current)
    if (current.active) drawStroke(ctx, current.active.stroke, scaleRef.current)
  }, [])

  const state = stateRef.current
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    if (scaleRef.current !== scale || canvas.width !== Math.round(PAGE_WIDTH * scale)) {
      scaleRef.current = scale
      canvas.width = Math.round(PAGE_WIDTH * scale)
      canvas.height = Math.round(PAGE_HEIGHT * scale)
    }
    redraw()
  }, [redraw, state.pages, state.page])

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    if (!canvas || disabled) return
    const kind = asPointerKind(event.pointerType)
    const now = performance.now()
    const intent = pointerIntent(stateRef.current, kind, now)
    if (intent === 'ignore') {
      event.preventDefault()
      return
    }
    if (intent === 'pan') {
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      return
    }
    if (kind === 'mouse' && event.button !== 0) return
    event.preventDefault()
    panRef.current = null
    const activeTool: InkTool = event.buttons & 32 ? 'eraser' : tool
    apply(
      {
        type: 'down',
        pointerId: event.pointerId,
        pointerType: kind,
        point: pointFrom(event, canvas.getBoundingClientRect()),
        tool: activeTool,
        color: PAPER.black,
        width: activeTool === 'eraser' ? PEN_WIDTH * 5 : PEN_WIDTH,
        now,
      },
      false,
    )
    const active = stateRef.current.active
    if (active?.pointerId === event.pointerId) {
      canvas.setPointerCapture?.(event.pointerId)
      const ctx = canvas.getContext('2d')
      if (ctx) drawStroke(ctx, active.stroke, scaleRef.current)
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const pan = panRef.current
    if (pan && pan.pointerId === event.pointerId) {
      if (pointerIntent(stateRef.current, 'touch', performance.now()) === 'ignore') {
        panRef.current = null
        return
      }
      // A finger scrolls the exam paper itself.
      window.scrollBy(pan.x - event.clientX, pan.y - event.clientY)
      panRef.current = { ...pan, x: event.clientX, y: event.clientY }
      return
    }
    const active = stateRef.current.active
    const canvas = canvasRef.current
    if (!active || active.pointerId !== event.pointerId || !canvas) return
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const native = event.nativeEvent
    const events =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const points = (events.length ? events : [native]).map((item) => pointFrom(item, rect))
    const before = active.stroke.points.length
    apply({ type: 'move', pointerId: event.pointerId, points, now: performance.now() }, false)
    const next = stateRef.current.active
    const ctx = canvas.getContext('2d')
    if (next && ctx) drawStroke(ctx, next.stroke, scaleRef.current, before)
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean): void {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null
      return
    }
    const active = stateRef.current.active
    if (!active || active.pointerId !== event.pointerId) return
    apply(
      cancelled
        ? { type: 'cancel', pointerId: event.pointerId }
        : { type: 'up', pointerId: event.pointerId, now: performance.now() },
    )
    if (cancelled) redraw()
  }

  const pageCount = state.pages.length
  const toolButton = 'h-11 w-11 lab:rounded-md'
  const pressed = 'border-primary bg-accent text-foreground ring-1 ring-primary/50'

  return (
    <div className="space-y-2" data-writing-area>
      <div
        role="toolbar"
        aria-label={t('handwriting.toolbar')}
        className="flex flex-wrap items-center gap-1"
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(toolButton, tool === 'pen' && pressed)}
          aria-pressed={tool === 'pen'}
          aria-label={t('handwriting.pen')}
          title={t('handwriting.pen')}
          disabled={disabled}
          onClick={() => setTool('pen')}
        >
          <PenLine aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(toolButton, tool === 'eraser' && pressed)}
          aria-pressed={tool === 'eraser'}
          aria-label={t('handwriting.eraser')}
          title={t('handwriting.eraser')}
          disabled={disabled}
          onClick={() => setTool('eraser')}
        >
          <Eraser aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={toolButton}
          disabled={disabled || state.undo.length === 0}
          aria-label={t('handwriting.undo')}
          title={t('handwriting.undo')}
          onClick={() => apply({ type: 'undo' })}
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={toolButton}
          disabled={disabled || state.redo.length === 0}
          aria-label={t('handwriting.redo')}
          title={t('handwriting.redo')}
          onClick={() => apply({ type: 'redo' })}
        >
          <Redo2 aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={toolButton}
          disabled={disabled || (state.pages[state.page]?.length ?? 0) === 0}
          aria-label={t('handwriting.clear')}
          title={t('handwriting.clear')}
          onClick={() => apply({ type: 'clear' })}
        >
          <Trash2 aria-hidden />
        </Button>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={toolButton}
          disabled={state.page === 0}
          aria-label={t('handwriting.prevPage')}
          title={t('handwriting.prevPage')}
          onClick={() => apply({ type: 'goto', page: state.page - 1 })}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <span className="min-w-[5.5rem] text-center text-sm tabular-nums" aria-live="polite">
          {t('handwriting.pageOf', { page: state.page + 1, total: pageCount })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={toolButton}
          disabled={state.page >= pageCount - 1}
          aria-label={t('handwriting.nextPage')}
          title={t('handwriting.nextPage')}
          onClick={() => apply({ type: 'goto', page: state.page + 1 })}
        >
          <ChevronRight aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11"
          disabled={disabled || pageCount >= MAX_PAGES}
          onClick={() => apply({ type: 'addPage' })}
        >
          <FilePlus2 aria-hidden />
          {t('handwriting.addPage')}
        </Button>
        <span
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"
          role="status"
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t('handwriting.saving')}
            </>
          ) : (
            t('writingArea.autosaved')
          )}
        </span>
      </div>
      <div
        className="relative w-full border border-border shadow-soft"
        style={{ aspectRatio: `${PAGE_WIDTH} / ${PAGE_HEIGHT}`, ...paperBackgroundStyle('ruled') }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${label} · ${t('handwriting.pageOf', { page: state.page + 1, total: pageCount })}`}
          // Only the canvas opts out of browser panning; a finger still scrolls
          // the paper through the pan handler.
          className={cn(
            'absolute inset-0 h-full w-full touch-none',
            disabled ? 'cursor-not-allowed' : 'cursor-crosshair',
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => onPointerEnd(event, false)}
          onPointerCancel={(event) => onPointerEnd(event, true)}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
