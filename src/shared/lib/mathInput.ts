/**
 * Symbol entry for answer fields.
 *
 * Students should not need LaTeX (or a symbol font) to answer. Each answer
 * field picks a *mode* that matches how the answer is read:
 *
 *   text        free working / chat — Unicode symbols (≤, ∫, α, x²) that read
 *               naturally and that the AI understands
 *   expression  graded by the local maths parser — mathjs syntax (`sqrt()`,
 *               `pi`, `^`) so what is typed is exactly what gets checked
 *   number      a plain numeric answer — `×10^`, fractions, `pi`
 *   quantity    a value with a unit — unit glyphs (², μ, Ω, °C, ×10^)
 *
 * Pure data and string logic only; the toolbar component lives in
 * `widgets/mathInput`.
 */

export type MathInputMode = 'text' | 'expression' | 'number' | 'quantity' | 'chemistry'

export type SymbolGroupId =
  | 'basic'
  | 'greek'
  | 'calculus'
  | 'sets'
  | 'linear'
  | 'stats'
  | 'scripts'
  | 'arrows'
  | 'chemistry'
  | 'biology'
  | 'medicine'
  | 'chemEquation'
  | 'operators'
  | 'functions'
  | 'units'

export interface SymbolItem {
  /** What the button shows. */
  glyph: string
  /** Text inserted at the caret. */
  insert: string
  /**
   * Where the caret lands inside `insert` (default: after it). For templates
   * such as `sqrt()` this is inside the brackets; a selection is wrapped there.
   */
  caret?: number
}

export interface SymbolGroup {
  id: SymbolGroupId
  items: SymbolItem[]
}

/** `sym('≤')` inserts itself; `tpl('sqrt()', 5)` puts the caret inside. */
const sym = (glyph: string, insert = glyph): SymbolItem => ({ glyph, insert })
const tpl = (glyph: string, insert: string, caret: number): SymbolItem => ({ glyph, insert, caret })
const each = (glyphs: string): SymbolItem[] => [...glyphs].map((g) => sym(g))

// --- free text (Unicode) -----------------------------------------------------

const TEXT_GROUPS: Record<SymbolGroupId, SymbolItem[]> = {
  basic: [
    ...each('±×÷·≈≠≤≥'),
    tpl('√( )', '√()', 2),
    sym('∞'),
    sym('π'),
    sym('°'),
    sym('x²', '²'),
    sym('x³', '³'),
    sym('x⁻¹', '⁻¹'),
    tpl('a/b', '()/()', 1),
    tpl('|x|', '||', 1),
  ],
  greek: each('αβγδεζηθλμνξρστφχψωΓΔΘΛΞΠΣΦΨΩ'),
  calculus: [
    ...each('∫∬∮∂∇∑∏'),
    tpl('lim', 'lim(x→)', 6),
    sym('→'),
    sym('d/dx'),
    sym('dy/dx'),
    sym('′'),
    sym('Δ'),
    sym('+ C'),
  ],
  sets: each('∈∉⊆⊂⊇⊃∪∩∅∖∀∃¬∧∨⊕≡ℕℤℚℝℂ'),
  linear: [
    sym('Aᵀ', 'ᵀ'),
    sym('A⁻¹', '⁻¹'),
    tpl('‖v‖', '‖‖', 1),
    tpl('⟨u,v⟩', '⟨,⟩', 1),
    tpl('det', 'det()', 4),
    tpl('rank', 'rank()', 5),
    tpl('[a b; c d]', '[ ,  ;  ,  ]', 1),
    sym('λ'),
    sym('·'),
    sym('×'),
    sym('⊗'),
    sym('ℝⁿ', 'ℝⁿ'),
  ],
  stats: [
    tpl('P( )', 'P()', 2),
    tpl('P(A|B)', 'P(|)', 2),
    tpl('E[X]', 'E[]', 2),
    tpl('Var', 'Var()', 4),
    tpl('Cov', 'Cov(,)', 4),
    sym('x̄', 'x̄'),
    sym('p̂', 'p̂'),
    ...each('μσρχ'),
    sym('σ²'),
    sym('∼'),
    tpl('C(n,k)', 'C(,)', 2),
    sym('!'),
    sym('∑'),
  ],
  scripts: [...each('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿⁱ'), ...each('₀₁₂₃₄₅₆₇₈₉₊₋ₙᵢⱼₖ')],
  arrows: each('→←↔⇒⇐⇔↑↓↦'),
  chemistry: [...each('→⇌↑↓Δ°'), sym('·'), ...each('⁺⁻²³'), ...each('₂₃₄')],
  biology: [...each('♂♀×→⇌'), sym('F₁'), sym('F₂'), sym('P'), sym(':'), ...each('αβγΔ'), sym('5′'), sym('3′'), sym('ATP'), sym('CO₂'), sym('O₂')],
  medicine: [...each('↑↓→⇌±≈≥≤'), sym('Na⁺'), sym('K⁺'), sym('Ca²⁺'), sym('Cl⁻'), sym('HCO₃⁻'), sym('O₂'), sym('CO₂'), sym('pH'), sym('mmHg'), sym('mmol/L'), sym('°C')],
  chemEquation: [],
  operators: [],
  functions: [],
  units: [],
}

/** Which groups a text field shows first, by course subject. */
const TEXT_ORDER: Record<string, SymbolGroupId[]> = {
  calculus: ['basic', 'calculus', 'greek', 'scripts', 'sets'],
  linear_algebra: ['basic', 'linear', 'greek', 'scripts', 'sets'],
  discrete_math: ['sets', 'basic', 'arrows', 'scripts', 'greek'],
  stats: ['stats', 'basic', 'greek', 'scripts', 'calculus'],
  physics: ['basic', 'greek', 'scripts', 'calculus', 'arrows'],
  chemistry: ['chemistry', 'basic', 'scripts', 'greek'],
  biology: ['biology', 'basic', 'scripts', 'greek', 'arrows'],
  cs: ['basic', 'sets', 'arrows', 'scripts', 'greek'],
  medicine: ['medicine', 'biology', 'basic', 'scripts', 'greek'],
  other: ['basic', 'greek', 'calculus', 'sets', 'scripts', 'arrows'],
}

// --- graded maths (mathjs syntax) -------------------------------------------

const EXPRESSION_GROUPS: SymbolGroup[] = [
  {
    id: 'operators',
    items: [
      sym('+'),
      sym('−', '-'),
      sym('×', '*'),
      sym('÷', '/'),
      tpl('a/b', '()/()', 1),
      tpl('xⁿ', '^()', 2),
      sym('x²', '^2'),
      tpl('√', 'sqrt()', 5),
      tpl('∛', 'cbrt()', 5),
      tpl('|x|', 'abs()', 4),
      tpl('( )', '()', 1),
      sym('π', 'pi'),
      sym('e'),
      sym('+ C', ' + C'),
    ],
  },
  {
    id: 'functions',
    items: [
      tpl('sin', 'sin()', 4),
      tpl('cos', 'cos()', 4),
      tpl('tan', 'tan()', 4),
      tpl('ln', 'log()', 4),
      tpl('log₁₀', 'log10()', 6),
      tpl('eˣ', 'exp()', 4),
      tpl('arcsin', 'asin()', 5),
      tpl('arccos', 'acos()', 5),
      tpl('arctan', 'atan()', 5),
    ],
  },
]

const NUMBER_GROUPS: SymbolGroup[] = [
  {
    id: 'operators',
    items: [
      sym('−', '-'),
      sym('×10ⁿ', '×10^'),
      tpl('a/b', '()/()', 1),
      tpl('√', 'sqrt()', 5),
      sym('π', 'pi'),
      sym('^'),
    ],
  },
]

const QUANTITY_GROUPS: SymbolGroup[] = [
  {
    id: 'units',
    items: [
      sym('×10ⁿ', '×10^'),
      sym('²'),
      sym('³'),
      sym('⁻¹'),
      sym('·'),
      sym('/'),
      sym('μ'),
      sym('Ω'),
      sym('°C', '°C'),
      sym('K'),
      sym('mol'),
      sym('M'),
      sym('Å'),
      sym('kDa'),
      sym('−', '-'),
    ],
  },
]

/** Chemical equations, in the mhchem syntax the grader reads. */
const CHEMISTRY_GROUPS: SymbolGroup[] = [
  {
    id: 'chemEquation',
    items: [
      sym('→', ' -> '),
      sym('⇌', ' <=> '),
      sym('+', ' + '),
      sym('(s)'),
      sym('(l)'),
      sym('(g)'),
      sym('(aq)'),
      sym('⁺', '^+'),
      sym('⁻', '^-'),
      sym('²⁺', '^2+'),
      sym('²⁻', '^2-'),
      sym('³⁺', '^3+'),
      sym('e⁻', 'e-'),
      sym('·', '·'),
      sym('=', '='),
      sym('≡', '≡'),
      tpl('( )', '()', 1),
      tpl('[ ]', '[]', 1),
      sym('↑'),
      sym('↓'),
    ],
  },
]

/** The symbol groups for a field, in the order to show them. */
export function symbolGroupsFor(mode: MathInputMode, subject?: string): SymbolGroup[] {
  if (mode === 'expression') return EXPRESSION_GROUPS
  if (mode === 'number') return NUMBER_GROUPS
  if (mode === 'quantity') return QUANTITY_GROUPS
  if (mode === 'chemistry') return CHEMISTRY_GROUPS
  const order = TEXT_ORDER[subject ?? 'other'] ?? TEXT_ORDER.other!
  return order.map((id) => ({ id, items: TEXT_GROUPS[id] }))
}

// --- insertion ---------------------------------------------------------------

export interface InsertionResult {
  value: string
  /** Selection to restore after the edit. */
  selectionStart: number
  selectionEnd: number
}

/**
 * Insert a symbol into `value`, replacing the selection. A template with a
 * caret position wraps the selected text: selecting `x+1` and choosing √ in
 * expression mode gives `sqrt(x+1)`, with the caret after it.
 */
export function applySymbol(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  item: SymbolItem,
): InsertionResult {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))
  const selected = value.slice(start, end)
  const caret = item.caret ?? item.insert.length
  const before = item.insert.slice(0, caret)
  const after = item.insert.slice(caret)

  if (item.caret !== undefined && selected) {
    const inserted = before + selected + after
    const next = value.slice(0, start) + inserted + value.slice(end)
    const position = start + inserted.length
    return { value: next, selectionStart: position, selectionEnd: position }
  }

  const next = value.slice(0, start) + item.insert + value.slice(end)
  const position = start + caret
  return { value: next, selectionStart: position, selectionEnd: position }
}
