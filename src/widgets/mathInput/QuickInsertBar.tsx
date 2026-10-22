import { useLayoutEffect, useRef } from 'react'
import { applyQuickItem, type QuickItem } from '@/shared/lib/quickInsert'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

type FieldElement = HTMLInputElement | HTMLTextAreaElement

export interface QuickInsertBarProps {
  items: readonly QuickItem[]
  /** The field to type into (read at click time). */
  field: () => FieldElement | null
  /** Its current value (read at click time). */
  value: () => string
  onChange: (value: string) => void
  /** Accessible name of the group. */
  label: string
  disabled?: boolean
  /** Monospace faces (symbols); false for letters. */
  mono?: boolean
  className?: string
}

/**
 * A short row of the symbols one field needs, always visible next to it.
 * Inserts at the caret (templates wrap a selection, `?` placeholders get
 * selected) and never takes focus from the field: the buttons cancel the
 * pointer-down that would move focus, and the caret is put back after the
 * value is written. Still reachable with Tab, so keyboard users can use it.
 * Compact on a desktop, 44 px targets on a touch screen.
 */
export function QuickInsertBar({
  items,
  field,
  value,
  onChange,
  label,
  disabled = false,
  mono = true,
  className,
}: QuickInsertBarProps): JSX.Element | null {
  const { t } = useTranslation()
  const pending = useRef<{ el: FieldElement; start: number; end: number } | null>(null)

  // Restore the caret / placeholder selection once the new value is in the field.
  useLayoutEffect(() => {
    const target = pending.current
    if (!target) return
    pending.current = null
    target.el.focus({ preventScroll: true })
    target.el.setSelectionRange(target.start, target.end)
  })

  if (items.length === 0) return null

  const insert = (item: QuickItem): void => {
    const el = field()
    const text = value()
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = applyQuickItem(text, start, end, item)
    if (el) pending.current = { el, start: next.selectionStart, end: next.selectionEnd }
    if (next.value === text) {
      // Nothing to write (backspace at the start): just put the caret back.
      el?.focus({ preventScroll: true })
      el?.setSelectionRange(next.selectionStart, next.selectionEnd)
      pending.current = null
      return
    }
    onChange(next.value)
  }

  return (
    <div
      role="group"
      aria-label={label}
      data-quick-insert
      className={cn('flex flex-wrap gap-1 coarse:gap-1.5', className)}
    >
      {items.map((item) => {
        const name = item.nameKey ? t(item.nameKey as TranslationKey) : undefined
        const description = item.action
          ? name
          : t('symbolBar.inserts', { text: item.insert.trim() || item.insert })
        return (
          <button
            key={`${item.glyph}-${item.insert}-${item.action ?? ''}`}
            type="button"
            disabled={disabled}
            // Keep focus (and the caret) in the field.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insert(item)}
            aria-label={name && !item.action ? `${name} · ${description}` : description}
            title={item.showName ? item.glyph : description}
            className={cn(
              'focus-ring inline-flex h-7 min-w-7 items-center justify-center whitespace-nowrap rounded-md border border-border/70 bg-card px-1.5 text-[13px] text-foreground transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-50 lab:rounded-sm coarse:h-11 coarse:min-w-11 coarse:px-2.5 coarse:text-[15px]',
              mono && !item.showName && 'font-mono',
            )}
          >
            {item.showName && name ? name : item.glyph}
          </button>
        )
      })}
    </div>
  )
}
