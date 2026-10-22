import { describe, expect, it } from 'vitest'
import {
  MAX_ROW_BUTTONS,
  applyQuickItem,
  findPlaceholder,
  rowOpQuickItems,
  type QuickItem,
} from '@/shared/lib/quickInsert'
import {
  blankQuickItems,
  expressionQuickItems,
  expressionVariables,
  quantityUnits,
} from '@/services/quickInputs'
import { parseTypedOps } from '@/entities/homework/guidedMatrix'

const item = (items: QuickItem[], glyph: string): QuickItem => {
  const found = items.find((entry) => entry.glyph === glyph)
  if (!found) throw new Error(`no ${glyph}`)
  return found
}
const template = (items: QuickItem[], name: string): QuickItem => {
  const found = items.find((entry) => entry.nameKey === name)
  if (!found) throw new Error(`no ${name}`)
  return found
}

describe('row-operation quick items', () => {
  it('has one row button per matrix row', () => {
    const rows = (n: number) => rowOpQuickItems(n).filter((entry) => /^R\d+$/.test(entry.glyph))
    expect(rows(2).map((entry) => entry.insert)).toEqual(['R1', 'R2'])
    expect(rows(4)).toHaveLength(4)
    expect(rows(30)).toHaveLength(MAX_ROW_BUTTONS)
  })

  it('inserts a template and selects its first placeholder', () => {
    const items = rowOpQuickItems(3)
    const result = applyQuickItem('', 0, 0, template(items, 'quickInsert.addMultiple'))
    expect(result.value).toBe('R? -> R? - ?R?')
    expect([result.selectionStart, result.selectionEnd]).toEqual([1, 2])
  })

  it('a row button fills the `?` of `R?` with the number and moves to the next `?`', () => {
    const items = rowOpQuickItems(3)
    let state = applyQuickItem('', 0, 0, template(items, 'quickInsert.addMultiple'))
    state = applyQuickItem(state.value, state.selectionStart, state.selectionEnd, item(items, 'R2'))
    expect(state.value).toBe('R2 -> R? - ?R?')
    expect(state.value.slice(state.selectionStart, state.selectionEnd)).toBe('?')
    expect(state.selectionStart).toBe(7)
    state = applyQuickItem(state.value, state.selectionStart, state.selectionEnd, item(items, 'R2'))
    // Typing the multiplier over the next `?`.
    const at = state.selectionStart
    state = {
      value: `${state.value.slice(0, at)}2${state.value.slice(at + 1)}`,
      selectionStart: at + 1,
      selectionEnd: at + 1,
    }
    const last = findPlaceholder(state.value, state.selectionStart)!
    state = applyQuickItem(state.value, last.start, last.end, item(items, 'R1'))
    expect(state.value).toBe('R2 -> R2 - 2R1')
    expect(parseTypedOps(state.value)).not.toBeNull()
  })

  it('swap and scale templates parse once filled', () => {
    const items = rowOpQuickItems(2)
    expect(template(items, 'quickInsert.swap').insert).toBe('R? <-> R?')
    expect(parseTypedOps('R1 <-> R2')).not.toBeNull()
    expect(template(items, 'quickInsert.scale').insert).toBe('R? -> ?R?')
    expect(parseTypedOps('R2 -> 1/3R2')).not.toBeNull()
    expect(
      parseTypedOps(`R1${item(items, '→').insert}R1${item(items, '−').insert}R2`),
    ).not.toBeNull()
  })

  it('inserts at the caret and deletes with backspace', () => {
    const items = rowOpQuickItems(2)
    const inserted = applyQuickItem('R1R2', 2, 2, item(items, '↔'))
    expect(inserted.value).toBe('R1 <-> R2')
    expect(inserted.selectionStart).toBe(7)
    const backspace = template(items, 'quickInsert.backspace')
    expect(applyQuickItem('R12', 3, 3, backspace)).toMatchObject({ value: 'R1', selectionStart: 2 })
    expect(applyQuickItem('R1 R2', 1, 3, backspace)).toMatchObject({
      value: 'RR2',
      selectionStart: 1,
    })
    expect(applyQuickItem('R1', 0, 0, backspace)).toMatchObject({ value: 'R1', selectionStart: 0 })
  })

  it('finds placeholders forwards and backwards, wrapping', () => {
    expect(findPlaceholder('R? -> ?R?', 2)).toEqual({ start: 6, end: 7 })
    expect(findPlaceholder('R? -> ?R?', 9)).toEqual({ start: 1, end: 2 })
    expect(findPlaceholder('R? -> ?R?', 6, true)).toEqual({ start: 1, end: 2 })
    expect(findPlaceholder('R1 -> R2', 0)).toBeNull()
  })
})

describe('quick items from the expected answer', () => {
  it('finds the variables of an expression, not functions or constants', () => {
    expect(expressionVariables('x^2/2 + C')).toEqual(['x'])
    expect(expressionVariables('r*sin(theta) + e^t')).toEqual(['r', 'theta', 't'])
    expect(expressionVariables('sqrt(2)*pi')).toEqual([])
    const glyphs = expressionQuickItems('a*x^2 + b').map((entry) => entry.glyph)
    expect(glyphs.slice(0, 3)).toEqual(['a', 'x', 'b'])
    expect(glyphs).toEqual(expect.arrayContaining(['xⁿ', '√', 'a/b', 'π', '( )']))
    // Functions the answer uses are not offered (a hint).
    expect(expressionQuickItems('sin(x)').map((entry) => entry.glyph)).not.toContain('sin')
  })

  it('reads the units of an expected quantity with the quantity parser', () => {
    expect(quantityUnits('9.8 m/s^2').map((entry) => entry.glyph)).toEqual(['m/s²', 'm', 's'])
    expect(quantityUnits('25 °C').map((entry) => entry.glyph)).toEqual(['°C'])
    expect(quantityUnits('3 µmol/L').map((entry) => entry.glyph)).toEqual(['μmol/L', 'μmol', 'L'])
    expect(quantityUnits('1.2×10^3 kPa').map((entry) => entry.insert)).toEqual(['kPa'])
    expect(quantityUnits('42')).toEqual([])
  })

  it('picks the bar by blank kind', () => {
    const glyphs = (
      kind: Parameters<typeof blankQuickItems>[0]['kind'],
      answer: string,
      subject?: string,
      language?: string,
    ) => blankQuickItems({ id: '1', kind, answer }, subject, language).map((entry) => entry.glyph)
    expect(glyphs('expression', 'k*t')).toEqual(expect.arrayContaining(['k', 't', 'xⁿ']))
    expect(glyphs('quantity', '19.6 m/s')).toEqual(
      expect.arrayContaining(['m/s', 'm', 's', '·', '^', '×10ⁿ']),
    )
    expect(glyphs('chemistry', '2H2 + O2 -> 2H2O')).toEqual(
      expect.arrayContaining(['→', '⇌', '⁺', '⁻', '(aq)', '(s)', '(l)', '(g)', '₂']),
    )
    expect(glyphs('text', 'mitochondria', 'biology')).toEqual([])
    expect(glyphs('text', 'reject H0', 'stats')).toEqual(
      expect.arrayContaining(['μ', 'σ', 'x̄', 'p̂', 'χ²']),
    )
    expect(glyphs('text', 'Mädchen', 'language', 'de')).toContain('ä')
    expect(glyphs('exact', 'hello')).toEqual([])
  })
})
