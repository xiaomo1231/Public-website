import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import type { Question } from '@/entities/question/types'
import { orderingItems, shuffledForDisplay } from '@/services/answerPreview'
import { cn } from '@/shared/lib/utils'
import {
  capturePointer,
  dropIndexAt,
  isTouchLike,
  passedDragThreshold,
  releasePointer,
} from '@/shared/lib/pointerGesture'
import { useTranslation } from '@/i18n'

export interface OrderingInputProps {
  question: Question
  /** The items in the student's current order, one per line. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Put items in order by dragging or with the arrow buttons (keyboard and touch
 * friendly). The list starts from a stable shuffle — never the answer — and
 * its value is the items joined by newlines, which is also what is graded and
 * shown in the results. The shuffle is only shown: the value stays empty until
 * the student moves an item, so Enter or the submit button cannot hand in the
 * untouched starting order.
 *
 * A mouse drags the whole row (native drag and drop, as before). Finger and pen
 * drag by the grip with Pointer Events: only the grip is `touch-none`, so the
 * page still scrolls from anywhere else, and a press must travel a little
 * before it becomes a drag.
 */
interface PointerDrag {
  from: number
  dy: number
  to: number
  step: number
}

/**
 * Where a row sits during a finger / pen drag: the dragged row follows the
 * finger; rows between its place and the drop place shift one step to open
 * the gap.
 */
function orderingRowStyle(drag: PointerDrag | null, index: number): CSSProperties | undefined {
  if (!drag) return undefined
  if (drag.from === index)
    return { transform: `translateY(${drag.dy}px)`, position: 'relative', zIndex: 1 }
  if (drag.from < drag.to && index > drag.from && index <= drag.to)
    return { transform: `translateY(${-drag.step}px)` }
  if (drag.to < drag.from && index >= drag.to && index < drag.from)
    return { transform: `translateY(${drag.step}px)` }
  return undefined
}

export function OrderingInput({
  question,
  value,
  onChange,
  disabled,
}: OrderingInputProps): JSX.Element {
  const { t } = useTranslation()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // Finger / pen drag: the item, how far it moved, where it would land and
  // how far the others shift to open a gap there (its height plus the gap).
  const [pointerDrag, setPointerDrag] = useState<PointerDrag | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const initial = useMemo(() => {
    const source = question.orderItems?.length
      ? question.orderItems
      : orderingItems(question.correctAnswer)
    return shuffledForDisplay(source, question.id)
  }, [question])
  const touched = Boolean(value)
  const items = touched ? orderingItems(value) : initial

  function move(from: number, to: number) {
    if (disabled || to < 0 || to >= items.length || from === to) return
    const next = [...items]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    onChange(next.join('\n'))
  }

  function startPointerDrag(event: PointerEvent<HTMLSpanElement>, from: number) {
    if (disabled || !isTouchLike(event.pointerType)) return
    event.preventDefault()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const pointerType = event.pointerType
    capturePointer(handle, pointerId)
    // Item centres as laid out now; the drop index is read against them.
    const rects = Array.from(listRef.current?.children ?? []).map((child) =>
      child.getBoundingClientRect(),
    )
    const midpoints = rects.map((rect) => rect.top + rect.height / 2)
    const gap = rects.length > 1 ? Math.max(0, rects[1]!.top - rects[0]!.bottom) : 0
    const step = (rects[from]?.height ?? 0) + gap
    const origin = { x: event.clientX, y: event.clientY }
    let dragging = false
    let to = from
    const onMove = (move: globalThis.PointerEvent): void => {
      if (move.pointerId !== pointerId) return
      const point = { x: move.clientX, y: move.clientY }
      if (!dragging && !passedDragThreshold(origin, point, pointerType)) return
      dragging = true
      to = dropIndexAt(midpoints, from, point.y)
      setPointerDrag({ from, dy: point.y - origin.y, to, step })
    }
    const finish = (commit: boolean): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      releasePointer(handle, pointerId)
      setPointerDrag(null)
      if (commit && dragging) move(from, to)
    }
    const onUp = (): void => finish(true)
    const onCancel = (): void => finish(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function onDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault()
    if (dragIndex !== null) move(dragIndex, index)
    setDragIndex(null)
  }

  return (
    <div className="space-y-2">
      <ol ref={listRef} className="space-y-1.5">
        {items.map((item, index) => (
          <li
            key={item}
            draggable={!disabled}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(event, index)}
            onDragEnd={() => setDragIndex(null)}
            data-drop-target={
              pointerDrag && pointerDrag.to === index && pointerDrag.from !== index ? '' : undefined
            }
            style={orderingRowStyle(pointerDrag, index)}
            className={cn(
              'flex items-center gap-2 rounded-lg border border-border/80 bg-card px-2 py-2 text-sm transition-colors',
              !disabled && 'cursor-grab active:cursor-grabbing',
              dragIndex === index && 'opacity-60 shadow-lg',
              // Finger / pen: the lifted row stays opaque and follows the
              // finger; the others slide (≤200ms) to open the gap.
              pointerDrag?.from === index && 'shadow-lift ring-1 ring-primary/40',
              pointerDrag &&
                pointerDrag.from !== index &&
                'transition-[transform,color,background-color,border-color] duration-200 ease-out motion-reduce:transition-none',
              'data-[drop-target]:border-primary',
            )}
          >
            {/* The touch / pen drag handle: a larger hit area than the icon. */}
            <span
              data-drag-handle
              aria-hidden
              onPointerDown={(event) => startPointerDrag(event, index)}
              className={cn(
                '-my-1 -ml-1 grid shrink-0 place-items-center self-stretch rounded-md px-1 text-muted-foreground coarse:w-11',
                !disabled && 'touch-none',
              )}
            >
              <GripVertical className="h-4 w-4" />
            </span>
            <span className="data-num w-5 shrink-0 text-right text-xs text-muted-foreground">
              {index + 1}.
            </span>
            <span className="min-w-0 flex-1 break-words">{item}</span>
            <span className="flex shrink-0 gap-0.5">
              <button
                type="button"
                onClick={() => move(index, index - 1)}
                disabled={disabled || index === 0}
                aria-label={t('answerInput.moveUp', { item })}
                className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-[color,background-color,border-color,transform] duration-press ease-out hover:bg-accent hover:text-foreground disabled:opacity-30 coarse:h-11 coarse:w-11 motion-safe:active:scale-[0.97]"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={disabled || index === items.length - 1}
                aria-label={t('answerInput.moveDown', { item })}
                className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-[color,background-color,border-color,transform] duration-press ease-out hover:bg-accent hover:text-foreground disabled:opacity-30 coarse:h-11 coarse:w-11 motion-safe:active:scale-[0.97]"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {t('answerInput.orderingHint')}
        {!touched && !disabled ? ` ${t('answerInput.orderingUntouched')}` : ''}
      </p>
    </div>
  )
}
