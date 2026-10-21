import { useLayoutEffect, useRef } from 'react'
import { applySymbol, languageSymbolGroup, type SymbolItem } from '@/shared/lib/mathInput'
import { useTranslation } from '@/i18n'

/**
 * A row of the course language's letters (German ä ö ü ß, Hungarian á ő ű …)
 * for a plain text field, for keyboards without them. Inserts at the caret
 * of the field it is given. Renders nothing for languages without a group.
 */
export function LetterBar({
  language,
  field,
  value,
  onChange,
}: {
  language?: string | undefined
  /** The field to type into (read at click time). */
  field: () => HTMLInputElement | HTMLTextAreaElement | null
  /** Its current value (read at click time). */
  value: () => string
  onChange: (value: string) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const pending = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; at: number } | null>(null)
  const group = languageSymbolGroup(language)

  // Restore the caret once the new value has been written to the field.
  useLayoutEffect(() => {
    const target = pending.current
    if (!target) return
    pending.current = null
    target.el.focus()
    target.el.setSelectionRange(target.at, target.at)
  })

  if (!group) return null

  const insert = (item: SymbolItem) => {
    const el = field()
    const text = value()
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = applySymbol(text, start, end, item)
    if (el) pending.current = { el, at: next.selectionStart }
    onChange(next.value)
  }

  return (
    <div
      role="group"
      aria-label={t(group.id === 'de' ? 'symbolGroup.de' : 'symbolGroup.hu')}
      className="flex flex-wrap gap-1"
    >
      {group.items.map((item) => (
        <button
          key={item.glyph}
          type="button"
          // Keep the caret in the field.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insert(item)}
          aria-label={t('symbolBar.inserts', { text: item.insert })}
          className="focus-ring inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-border/70 bg-card px-1.5 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
        >
          {item.glyph}
        </button>
      ))}
    </div>
  )
}
