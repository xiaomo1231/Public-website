/**
 * Which quick-insert buttons an answer field shows, derived from what the
 * field expects: the variables of the expected expression, the units of the
 * expected quantity, the course subject. Only what is relevant — never the
 * whole symbol keyboard (that stays folded in `MathField`).
 *
 * Reads the expected answer through the graders' own parsers, so a button
 * always inserts something the grader reads.
 */
import { splitQuantity } from '@/infrastructure/math/quantityAnswer'
import type { GuidedBlank } from '@/entities/homework/guided'
import type { QuickItem } from '@/shared/lib/quickInsert'
import { languageSymbolGroup } from '@/shared/lib/mathInput'

/** Names in an expression that are functions or constants, not variables. */
const NOT_VARIABLES = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'arcsin',
  'arccos',
  'arctan',
  'ln',
  'log',
  'log10',
  'exp',
  'abs',
  'sqrt',
  'cbrt',
  'pi',
  'e',
  'i',
  'Infinity',
  'C',
  'sinh',
  'cosh',
  'tanh',
])
const MAX_VARIABLES = 6

/** Variables (`x`, `t`, `θ`, `x_1`) of an expression, in order of appearance. */
export function expressionVariables(expression: string): string[] {
  const names: string[] = []
  for (const match of expression.matchAll(/\p{L}[\p{L}\d_]*/gu)) {
    const name = match[0]
    if (NOT_VARIABLES.has(name)) continue
    if (!names.includes(name)) names.push(name)
    if (names.length >= MAX_VARIABLES) break
  }
  return names
}

const EXPRESSION_TOOLS: QuickItem[] = [
  { glyph: 'xⁿ', insert: '^()', caret: 2 },
  { glyph: '√', insert: 'sqrt()', caret: 5 },
  { glyph: 'a/b', insert: '()/()', caret: 1, nameKey: 'quickInsert.fraction' },
  { glyph: 'π', insert: 'pi' },
  { glyph: '( )', insert: '()', caret: 1 },
]

/**
 * An expression field: the variables of the expected answer and the basic
 * templates. Functions the answer uses are not offered — that would hint
 * at the answer; they stay in the symbol keyboard.
 */
export function expressionQuickItems(expected: string | undefined): QuickItem[] {
  return [
    ...expressionVariables(expected ?? '').map((name) => ({ glyph: name, insert: name })),
    ...EXPRESSION_TOOLS,
  ]
}

/** A unit token in mathjs spelling → what a student types. */
function unitGlyph(token: string): string {
  if (token === 'degC') return '°C'
  if (token === 'degF') return '°F'
  if (token === 'deg') return '°'
  if (token === 'ohm') return 'Ω'
  if (token === 'angstrom') return 'Å'
  // mathjs spells the micro prefix `u` (umol, uL).
  if (/^u[A-Za-z]/.test(token)) return `μ${token.slice(1)}`
  return token.replace(/ohm$/, 'Ω')
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
}

/** `m/s^2` → `m/s²` for the button face. */
function prettyUnit(unitText: string): string {
  return unitText
    .replace(/\^\(?(-?\d+)\)?/g, (_, power: string) =>
      [...power].map((ch) => SUPERSCRIPT[ch] ?? ch).join(''),
    )
    .replace(/[A-Za-z]+/g, unitGlyph)
    .replace(/\s+/g, '·')
}

/** The units of an expected quantity (`9.8 m/s^2` → m/s², m, s), read by the quantity grader. */
export function quantityUnits(expected: string): QuickItem[] {
  const parsed = splitQuantity(expected)
  if (!parsed?.unitText) return []
  const unit = parsed.unitText
  const tokens = [...new Set(unit.match(/[A-Za-z]+/g) ?? [])]
  const items: QuickItem[] = []
  const whole = prettyUnit(unit)
  const single = tokens.length === 1 && unit === tokens[0]
  if (!single) items.push({ glyph: whole, insert: ` ${whole}` })
  for (const token of tokens) {
    const glyph = unitGlyph(token)
    items.push({ glyph, insert: glyph })
  }
  return items
}

const QUANTITY_TOOLS: QuickItem[] = [
  { glyph: '·', insert: '·' },
  { glyph: '^', insert: '^' },
  { glyph: '×10ⁿ', insert: '×10^' },
]

const NUMBER_TOOLS: QuickItem[] = [
  { glyph: '−', insert: '-' },
  { glyph: '/', insert: '/' },
  { glyph: '×10ⁿ', insert: '×10^' },
]

/** Chemical equations in the mhchem-like syntax the equation grader reads. */
const CHEMISTRY_TOOLS: QuickItem[] = [
  { glyph: '→', insert: ' -> ' },
  { glyph: '⇌', insert: ' <=> ' },
  { glyph: '+', insert: ' + ' },
  { glyph: '₂', insert: '₂' },
  { glyph: '₃', insert: '₃' },
  { glyph: '₄', insert: '₄' },
  { glyph: 'xⁿ', insert: '^' },
  { glyph: '⁺', insert: '^+' },
  { glyph: '⁻', insert: '^-' },
  { glyph: '(aq)', insert: '(aq)' },
  { glyph: '(s)', insert: '(s)' },
  { glyph: '(l)', insert: '(l)' },
  { glyph: '(g)', insert: '(g)' },
]

/**
 * Statistics notation for a written answer in a statistics course. A fixed
 * set, not the symbols of the expected answer, so the bar never gives the
 * answer away.
 */
const STATS_SYMBOLS: QuickItem[] = [
  { glyph: 'μ', insert: 'μ' },
  { glyph: 'σ', insert: 'σ' },
  { glyph: 'σ²', insert: 'σ²' },
  { glyph: 'x̄', insert: 'x̄' },
  { glyph: 'p̂', insert: 'p̂' },
  { glyph: 'χ²', insert: 'χ²' },
  { glyph: 'H₀', insert: 'H₀' },
  { glyph: 'H₁', insert: 'H₁' },
]

/**
 * Quick inputs for one guided-practice blank. A written blank of a language
 * course gets that language's letters (ä ö ü ß …); other written blanks get
 * nothing extra, except statistics notation in a statistics course.
 */
export function blankQuickItems(
  blank: GuidedBlank,
  subject?: string,
  language?: string,
): QuickItem[] {
  switch (blank.kind) {
    case 'expression':
      return expressionQuickItems(blank.answer)
    case 'number':
      return NUMBER_TOOLS
    case 'quantity':
      return [...quantityUnits(blank.answer), ...QUANTITY_TOOLS]
    case 'chemistry':
      return CHEMISTRY_TOOLS
    case 'text': {
      const letters = languageSymbolGroup(language)
      if (letters) return letters.items
      return subject === 'stats' ? STATS_SYMBOLS : []
    }
    default:
      return []
  }
}
