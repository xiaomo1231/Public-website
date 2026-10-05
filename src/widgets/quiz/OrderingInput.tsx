import { useEffect, useState, type DragEvent } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import type { Question } from '@/entities/question/types'
import { orderingItems, shuffledForDisplay } from '@/services/answerPreview'
import { cn } from '@/shared/lib/utils'
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
 * friendly). The field starts from a stable shuffle — never the answer — and
 * its value is the items joined by newlines, which is also what is graded and
 * shown in the results.
 */
export function OrderingInput({ question, value, onChange, disabled }: OrderingInputProps): JSX.Element {
  const { t } = useTranslation()
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const items = value ? orderingItems(value) : []

  // Start from the shuffled order so the answer field is never empty.
  useEffect(() => {
    if (value) return
    const source = question.orderItems?.length ? question.orderItems : orderingItems(question.correctAnswer)
    onChange(shuffledForDisplay(source, question.id).join('\n'))
  }, [value, question, onChange])

  function move(from: number, to: number) {
    if (disabled || to < 0 || to >= items.length || from === to) return
    const next = [...items]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    onChange(next.join('\n'))
  }

  function onDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault()
    if (dragIndex !== null) move(dragIndex, index)
    setDragIndex(null)
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {items.map((item, index) => (
          <li
            key={item}
            draggable={!disabled}
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(event, index)}
            onDragEnd={() => setDragIndex(null)}
            className={cn(
              'flex items-center gap-2 rounded-lg border border-border/80 bg-card px-2 py-2 text-sm transition-colors',
              !disabled && 'cursor-grab active:cursor-grabbing',
              dragIndex === index && 'opacity-60',
            )}
          >
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="data-num w-5 shrink-0 text-right text-xs text-muted-foreground">{index + 1}.</span>
            <span className="min-w-0 flex-1 break-words">{item}</span>
            <span className="flex shrink-0 gap-0.5">
              <button
                type="button"
                onClick={() => move(index, index - 1)}
                disabled={disabled || index === 0}
                aria-label={t('answerInput.moveUp', { item })}
                className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={disabled || index === items.length - 1}
                aria-label={t('answerInput.moveDown', { item })}
                className="focus-ring grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">{t('answerInput.orderingHint')}</p>
    </div>
  )
}
