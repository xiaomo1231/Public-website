import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  FilePlus2,
  Grid3x3,
  Loader2,
  PenLine,
  Redo2,
  Rows3,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import {
  asPointerKind,
  boardHasInk,
  boardReducer,
  initialBoard,
  inkFromToken,
  MAX_PAGES,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  pageHasInk,
  pointerIntent,
  type BoardAction,
  type BoardState,
  type InkPoint,
  type InkTool,
} from './strokeModel'
import { drawPage, drawStroke, exportPagePng } from './inkRender'
import { PAPER, paperBackgroundStyle, type PaperBackground } from './paper'

export interface PenBoardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Receives one PNG per page that has ink, in page order. */
  onSave: (pages: Blob[]) => Promise<void>
}

const WIDTHS = [
  { key: 'thin', value: 2.5 },
  { key: 'medium', value: 4.5 },
  { key: 'thick', value: 8 },
] as const

interface InkColor {
  key: 'black' | 'primary' | 'ring' | 'red'
  value: string
}

/** Black plus three colours from the theme, darkened enough for light paper. */
function themeInkColors(): InkColor[] {
  const read = (name: string): string => {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name)
    } catch {
      return ''
    }
  }
  const colors: InkColor[] = [
    { key: 'black', value: PAPER.black },
    { key: 'primary', value: inkFromToken(read('--primary-strong'), PAPER.fallbackBlue) },
    { key: 'ring', value: inkFromToken(read('--ring'), PAPER.fallbackBlue) },
    { key: 'red', value: inkFromToken(read('--destructive'), PAPER.fallbackRed) },
  ]
  // Themes whose ring equals the primary colour get a distinct blue instead.
  if (colors[2]!.value === colors[1]!.value)
    colors[2] = {
      key: 'ring',
      value: colors[1]!.value === PAPER.fallbackBlue ? PAPER.fallbackRed : PAPER.fallbackBlue,
    }
  return colors
}

function pointFrom(event: { clientX: number; clientY: number; pressure: number }, rect: DOMRect) {
  return {
    x: ((event.clientX - rect.left) / rect.width) * PAGE_WIDTH,
    y: ((event.clientY - rect.top) / rect.height) * PAGE_HEIGHT,
    pressure: event.pressure,
  } satisfies InkPoint
}

/**
 * A pen board for handwritten working (formulas, matrices, diagrams).
 *
 * An Apple Pencil or a mouse writes; a finger scrolls the page and is ignored
 * while the pen is on the glass (palm rejection). Only the canvas takes
 * `touch-action: none`, so the rest of the dialog scrolls normally. The paper
 * stays white in dark mode; each page with ink is saved as one PNG.
 */
export function PenBoardDialog({ open, onOpenChange, onSave }: PenBoardDialogProps): JSX.Element {
  const { t } = useTranslation()
  const stateRef = useRef<BoardState>(initialBoard())
  const [, setVersion] = useState(0)
  const [tool, setTool] = useState<InkTool>('pen')
  const [width, setWidth] = useState<number>(WIDTHS[1].value)
  const [colors, setColors] = useState<InkColor[]>([{ key: 'black', value: PAPER.black }])
  const [color, setColor] = useState<string>(PAPER.black)
  const [background, setBackground] = useState<PaperBackground>('grid')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const scaleRef = useRef(1)

  const state = stateRef.current
  const apply = useCallback((action: BoardAction, rerender = true) => {
    stateRef.current = boardReducer(stateRef.current, action)
    if (rerender) setVersion((value) => value + 1)
  }, [])

  // A fresh, blank board each time it opens; theme colours read at that moment.
  useEffect(() => {
    if (!open) return
    stateRef.current = initialBoard()
    const inks = themeInkColors()
    setColors(inks)
    setColor(inks[0]!.value)
    setTool('pen')
    setError(null)
    setConfirmDiscard(false)
    setVersion((value) => value + 1)
  }, [open])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const current = stateRef.current
    drawPage(ctx, current.pages[current.page] ?? [], scaleRef.current)
    if (current.active) drawStroke(ctx, current.active.stroke, scaleRef.current)
  }, [])

  // Size the backing store for the screen, then draw the current page.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!open || !canvas) return
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    if (scaleRef.current !== scale || canvas.width !== Math.round(PAGE_WIDTH * scale)) {
      scaleRef.current = scale
      canvas.width = Math.round(PAGE_WIDTH * scale)
      canvas.height = Math.round(PAGE_HEIGHT * scale)
    }
    redraw()
  }, [open, redraw, state.pages, state.page])

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    if (!canvas) return
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
    // A pen down ends any finger scroll in progress (palm on the glass).
    panRef.current = null
    // The Pencil's eraser end (or a stylus eraser button) erases.
    const activeTool: InkTool = event.buttons & 32 ? 'eraser' : tool
    const rect = canvas.getBoundingClientRect()
    apply(
      {
        type: 'down',
        pointerId: event.pointerId,
        pointerType: kind,
        point: pointFrom(event, rect),
        tool: activeTool,
        color,
        width: activeTool === 'eraser' ? width * 4 : width,
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
      scrollRef.current?.scrollBy(pan.x - event.clientX, pan.y - event.clientY)
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

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault()
      apply({ type: 'undo' })
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault()
      apply({ type: 'redo' })
    }
  }

  const hasInk = boardHasInk(state)

  function requestClose(next: boolean): void {
    if (next) return onOpenChange(true)
    if (saving) return
    if (hasInk && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    onOpenChange(false)
  }

  async function save(): Promise<void> {
    if (saving || !hasInk) return
    setSaving(true)
    setError(null)
    try {
      const pages = stateRef.current.pages.filter(pageHasInk)
      const blobs: Blob[] = []
      for (const strokes of pages) blobs.push(await exportPagePng(strokes))
      await onSave(blobs)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('handwriting.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const pageCount = state.pages.length
  const toolButton = 'h-11 w-11 lab:rounded-md'
  const pressed = 'border-primary bg-accent text-foreground ring-1 ring-primary/50'

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="max-w-4xl gap-3 p-4 sm:p-5" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle className="font-heading">{t('handwriting.title')}</DialogTitle>
          <DialogDescription>{t('handwriting.description')}</DialogDescription>
        </DialogHeader>

        <div
          role="toolbar"
          aria-label={t('handwriting.toolbar')}
          className="flex flex-wrap items-center gap-x-3 gap-y-2"
        >
          <div className="flex gap-1" role="group" aria-label={t('handwriting.tool')}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn(toolButton, tool === 'pen' && pressed)}
              aria-pressed={tool === 'pen'}
              aria-label={t('handwriting.pen')}
              title={t('handwriting.pen')}
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
              onClick={() => setTool('eraser')}
            >
              <Eraser aria-hidden />
            </Button>
          </div>

          <div className="flex gap-1" role="group" aria-label={t('handwriting.width')}>
            {WIDTHS.map((item) => (
              <Button
                key={item.key}
                type="button"
                variant="outline"
                size="icon"
                className={cn(toolButton, width === item.value && pressed)}
                aria-pressed={width === item.value}
                aria-label={t(`handwriting.width.${item.key}`)}
                title={t(`handwriting.width.${item.key}`)}
                onClick={() => setWidth(item.value)}
              >
                <span
                  aria-hidden
                  className="block rounded-full bg-foreground"
                  style={{ width: item.value * 2 + 2, height: item.value * 2 + 2 }}
                />
              </Button>
            ))}
          </div>

          <div className="flex gap-1" role="group" aria-label={t('handwriting.color')}>
            {colors.map((item) => (
              <Button
                key={item.key}
                type="button"
                variant="outline"
                size="icon"
                className={cn(toolButton, color === item.value && tool === 'pen' && pressed)}
                aria-pressed={color === item.value}
                aria-label={t(`handwriting.color.${item.key}`)}
                title={t(`handwriting.color.${item.key}`)}
                onClick={() => {
                  setColor(item.value)
                  setTool('pen')
                }}
              >
                <span
                  aria-hidden
                  className="block h-5 w-5 rounded-full border border-border"
                  style={{ backgroundColor: item.value }}
                />
              </Button>
            ))}
          </div>

          <div className="flex gap-1" role="group" aria-label={t('handwriting.history')}>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={toolButton}
              disabled={state.undo.length === 0}
              aria-label={t('handwriting.undo')}
              title={t('handwriting.undo')}
              aria-keyshortcuts="Control+Z Meta+Z"
              onClick={() => apply({ type: 'undo' })}
            >
              <Undo2 aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={toolButton}
              disabled={state.redo.length === 0}
              aria-label={t('handwriting.redo')}
              title={t('handwriting.redo')}
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
              onClick={() => apply({ type: 'redo' })}
            >
              <Redo2 aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={toolButton}
              disabled={(state.pages[state.page]?.length ?? 0) === 0}
              aria-label={t('handwriting.clear')}
              title={t('handwriting.clear')}
              onClick={() => apply({ type: 'clear' })}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>

          <div className="flex gap-1" role="group" aria-label={t('handwriting.background')}>
            {(
              [
                ['blank', Square],
                ['grid', Grid3x3],
                ['ruled', Rows3],
              ] as const
            ).map(([kind, Icon]) => (
              <Button
                key={kind}
                type="button"
                variant="outline"
                size="icon"
                className={cn(toolButton, background === kind && pressed)}
                aria-pressed={background === kind}
                aria-label={t(`handwriting.background.${kind}`)}
                title={t(`handwriting.background.${kind}`)}
                onClick={() => setBackground(kind)}
              >
                <Icon aria-hidden />
              </Button>
            ))}
          </div>
        </div>

        <div
          ref={scrollRef}
          className="max-h-[62vh] overflow-auto rounded-lg border border-border bg-muted/40 p-2 lab:rounded-none"
        >
          <div
            className="relative mx-auto w-full max-w-[860px] shadow-soft"
            style={{
              aspectRatio: `${PAGE_WIDTH} / ${PAGE_HEIGHT}`,
              ...paperBackgroundStyle(background),
            }}
          >
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={t('handwriting.canvasLabel', { page: state.page + 1, total: pageCount })}
              // touch-none (touch-action: none) on the canvas only: it opts out
              // of browser panning / zooming; a finger still scrolls it through
              // the pan handler above, and the rest of the dialog scrolls normally.
              className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(event) => onPointerEnd(event, false)}
              onPointerCancel={(event) => onPointerEnd(event, true)}
              onContextMenu={(event) => event.preventDefault()}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1" role="group" aria-label={t('handwriting.pages')}>
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
              disabled={pageCount >= MAX_PAGES}
              onClick={() => apply({ type: 'addPage' })}
            >
              <FilePlus2 aria-hidden />
              {t('handwriting.addPage')}
            </Button>
            {pageCount > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11"
                onClick={() => apply({ type: 'deletePage' })}
              >
                {t('handwriting.deletePage')}
              </Button>
            )}
          </div>
        </div>

        {confirmDiscard && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm"
          >
            <span>{t('handwriting.discardQuestion')}</span>
            <span className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmDiscard(false)}
              >
                {t('handwriting.keepWriting')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t('handwriting.discard')}
              </Button>
            </span>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => requestClose(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!hasInk || saving}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            {saving ? t('handwriting.saving') : t('handwriting.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
