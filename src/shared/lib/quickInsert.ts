/**
 * Quick-insert buttons for one answer field: a short row of the symbols that
 * field actually needs (the matrix's rows for a row operation, the units of
 * the expected answer, …), next to the field and always visible — unlike the
 * folded symbol keyboard of `MathField`.
 *
 * Pure string logic; the bar itself is `widgets/mathInput/QuickInsertBar`.
 *
 * Templates may contain `?` placeholders (`R? -> R? - ?R?`): inserting one
 * selects its first `?`, typing replaces it, and Tab moves to the next.
 */
import { applySymbol, type InsertionResult, type SymbolItem } from './mathInput'

export const PLACEHOLDER = '?'

export type QuickItemName =
  | 'quickInsert.addMultiple'
  | 'quickInsert.swap'
  | 'quickInsert.scale'
  | 'quickInsert.backspace'
  | 'quickInsert.fraction'

export interface QuickItem extends SymbolItem {
  /**
   * Accessible name (`quickInsert.swap` → 交换 / Swap); without it the name
   * is "inserts …". With `showName` the button shows the name instead of the
   * glyph (the glyph becomes its tooltip).
   */
  nameKey?: QuickItemName
  showName?: boolean
  /** The insert holds `?` placeholders: select the first one after inserting. */
  placeholders?: boolean
  /** Delete the selection, or the character before the caret. */
  action?: 'backspace'
}

/** The placeholder at or after `from` (wrapping), or before it when `backwards`. */
export function findPlaceholder(
  value: string,
  from: number,
  backwards = false,
): { start: number; end: number } | null {
  if (!value.includes(PLACEHOLDER)) return null
  let at: number
  if (backwards) {
    at = from > 0 ? value.lastIndexOf(PLACEHOLDER, from - 1) : -1
    if (at < 0) at = value.lastIndexOf(PLACEHOLDER)
  } else {
    at = value.indexOf(PLACEHOLDER, from)
    if (at < 0) at = value.indexOf(PLACEHOLDER)
  }
  return at < 0 ? null : { start: at, end: at + 1 }
}

/**
 * Apply a quick item at the selection. Beyond `applySymbol`:
 * - `backspace` deletes;
 * - a placeholder template selects its first `?`;
 * - filling a selected `?` moves on to the next one, and a row button (`R2`)
 *   filling the `?` of `R?` writes only the number.
 */
export function applyQuickItem(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  item: QuickItem,
): InsertionResult {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))

  if (item.action === 'backspace') {
    if (end > start) {
      return {
        value: value.slice(0, start) + value.slice(end),
        selectionStart: start,
        selectionEnd: start,
      }
    }
    if (start === 0) return { value, selectionStart: 0, selectionEnd: 0 }
    // Never split a surrogate pair (𝑥, emoji).
    const width = start >= 2 && /[\uDC00-\uDFFF]/.test(value[start - 1]!) ? 2 : 1
    const at = start - width
    return { value: value.slice(0, at) + value.slice(start), selectionStart: at, selectionEnd: at }
  }

  const fillingPlaceholder = end === start + 1 && value[start] === PLACEHOLDER
  let insert = item.insert
  if (fillingPlaceholder && /^R\d+$/.test(insert) && value[start - 1] === 'R') {
    insert = insert.slice(1)
  }

  if (item.placeholders) {
    const next = value.slice(0, start) + insert + value.slice(end)
    const first = insert.indexOf(PLACEHOLDER)
    const caret = first >= 0 ? start + first : start + insert.length
    return { value: next, selectionStart: caret, selectionEnd: first >= 0 ? caret + 1 : caret }
  }

  const result = applySymbol(value, start, end, { ...item, insert })
  if (fillingPlaceholder && item.caret === undefined) {
    const after = start + insert.length
    const following = value.indexOf(PLACEHOLDER, end)
    if (following >= 0) {
      const at = following - end + after
      return { value: result.value, selectionStart: at, selectionEnd: at + 1 }
    }
  }
  return result
}

// --- row operations ----------------------------------------------------------

/** Row buttons stop here; a taller matrix is typed (R12 still parses). */
export const MAX_ROW_BUTTONS = 9

/** Quick inputs for a row-operation field of a matrix with `rows` rows. */
export function rowOpQuickItems(rows: number): QuickItem[] {
  const count = Math.max(1, Math.min(MAX_ROW_BUTTONS, Math.floor(rows)))
  const rowButtons = Array.from({ length: count }, (_, i): QuickItem => ({
    glyph: `R${i + 1}`,
    insert: `R${i + 1}`,
  }))
  return [
    ...rowButtons,
    { glyph: '→', insert: ' -> ' },
    { glyph: '↔', insert: ' <-> ' },
    { glyph: '+', insert: ' + ' },
    { glyph: '−', insert: ' - ' },
    { glyph: '/', insert: '/' },
    { glyph: ',', insert: ', ' },
    {
      glyph: 'Rᵢ → Rᵢ − kRⱼ',
      insert: 'R? -> R? - ?R?',
      placeholders: true,
      nameKey: 'quickInsert.addMultiple',
    },
    {
      glyph: 'Rᵢ ↔ Rⱼ',
      insert: 'R? <-> R?',
      placeholders: true,
      nameKey: 'quickInsert.swap',
      showName: true,
    },
    {
      glyph: 'Rᵢ → kRᵢ',
      insert: 'R? -> ?R?',
      placeholders: true,
      nameKey: 'quickInsert.scale',
      showName: true,
    },
    { glyph: '⌫', insert: '', action: 'backspace', nameKey: 'quickInsert.backspace' },
  ]
}

/** A matrix cell holds an exact number: only the sign and the fraction bar. */
export const MATRIX_CELL_QUICK_ITEMS: QuickItem[] = [
  { glyph: '−', insert: '-' },
  { glyph: '/', insert: '/' },
]
