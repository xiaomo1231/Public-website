/**
 * Chemical equations, parsed and checked locally.
 *
 * Grading a chemical-equation answer needs no AI: the species on each side,
 * the coefficients and the conservation of atoms and charge can all be read
 * from the text. The notation follows mhchem, which is what lessons display:
 *
 *   2H2 + O2 -> 2H2O          N2 + 3H2 <=> 2NH3
 *   Fe^3+ + e- -> Fe^2+       CuSO4·5H2O -> CuSO4 + 5H2O
 *   Ca(OH)2(aq) + CO2(g) -> CaCO3(s) + H2O(l)
 *
 * Unicode subscripts/superscripts (H₂O, SO₄²⁻), `→`/`⇌`, and a trailing
 * charge without a caret (`Fe3+`, as in mhchem) are accepted too.
 *
 * Organic chemistry: condensed structural formulas may carry bonds
 * (`CH2=CH2`, `HC#CH` / `HC≡CH`, `CH3-CH3`). A bare `=` is read as the arrow
 * only when no other arrow is present, choosing the `=` that leaves a
 * balanced equation, so `CH2=CH2 + H2 = CH3CH3` reads as intended. Species are
 * matched by molecular formula; when the reference gives a structure with two
 * or more carbons and the answer writes it differently, the two may be
 * isomers, so the comparison says so instead of guessing.
 */

export interface Species {
  /** Exactly as written (without coefficient or state), for messages. */
  text: string
  /** Atoms per formula unit, e.g. { H: 2, O: 1 }. */
  atoms: Record<string, number>
  charge: number
  /** Canonical identity: atoms in Hill order plus charge. */
  key: string
  /**
   * The written structure, bonds removed and simple groups expanded
   * (`CH3(CH2)2CH3` → `CH3CH2CH2CH3`), when the species is written as a
   * structure (an element repeats, or a bond is drawn). Absent for a plain
   * molecular formula such as `C2H6O`.
   */
  structure?: string
}

export interface Term {
  /** Coefficient as an exact fraction. */
  coefficient: { n: number; d: number }
  species: Species
}

export interface ParsedEquation {
  reactants: Term[]
  products: Term[]
  /** The two sides and the arrow as written, for rendering. */
  written: { left: string; arrow: string; right: string }
}

export type ParseResult =
  | { ok: true; equation: ParsedEquation }
  | { ok: false; reason: 'no-arrow' | 'empty-side' | 'bad-species'; detail?: string }

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
}
const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-',
}

/** Known element symbols (the periodic table up to oganesson). */
const ELEMENTS = new Set(
  (
    'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
    'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
    'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr ' +
    'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og D T'
  ).split(' '),
)

/** Every arrow except a bare `=`, which may also be a double bond. */
const ARROW = /\s*(?:<=>|<->|<-->|⇌|⇄|↔|-->|->|→|⟶)(?:\[[^\]]*\])?(?:\[[^\]]*\])?\s*/g
const EQUALS_ARROW = /\s*=(?:\[[^\]]*\])?(?:\[[^\]]*\])?\s*/g
const STATE = /\((?:s|l|g|aq|cr|sln)\)/gi
/** Bonds drawn inside a condensed structural formula. */
const BONDS = /[=#]|(?<=[A-Za-z0-9)\]])-(?=[A-Z([])/g

function normalize(text: string): string {
  let out = ''
  // Unicode superscripts become a caret charge: SO₄²⁻ → SO4^2-
  let inSuper = false
  for (const ch of text.replace(/\\ce\{([^}]*)\}/g, '$1')) {
    if (SUBSCRIPTS[ch]) {
      out += SUBSCRIPTS[ch]
      inSuper = false
    } else if (SUPERSCRIPTS[ch]) {
      out += (inSuper ? '' : '^') + SUPERSCRIPTS[ch]
      inSuper = true
    } else {
      out += ch
      inSuper = false
    }
  }
  return out
    .replace(/≡/g, '#')
    .replace(/[·•∙⋅]/g, '·')
    .replace(/\^\{([^}]*)\}/g, '^$1')
    .replace(/[↑↓]/g, '')
    .replace(/\$/g, '')
    .trim()
}

/** Split one side on "+" separators, leaving the "+" of charges alone. */
function splitTerms(side: string): string[] {
  const terms: string[] = []
  let current = ''
  for (let i = 0; i < side.length; i++) {
    const ch = side[i]!
    if (ch === '+') {
      const before = side.slice(0, i)
      const after = side.slice(i + 1)
      const prevChar = before.replace(/\s+$/, '').slice(-1)
      const nextChar = after.replace(/^\s+/, '')[0] ?? ''
      const spaced = /\s$/.test(before) && /^\s/.test(after)
      const afterCaret = before.endsWith('^') || /\^\d*$/.test(before)
      const separator =
        spaced ||
        (!afterCaret && prevChar !== '' && prevChar !== '+' && /[A-Z0-9([e]/.test(nextChar))
      if (separator) {
        terms.push(current)
        current = ''
        continue
      }
    }
    current += ch
  }
  terms.push(current)
  return terms.map((term) => term.trim())
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b)
}

function parseCoefficient(text: string): { coefficient: { n: number; d: number }; rest: string } {
  const match = /^(\d+)(?:\s*\/\s*(\d+))?\s*/.exec(text)
  // A leading number is a coefficient only when a formula follows it.
  if (!match || !/^[A-Z([e]/.test(text.slice(match[0].length))) {
    return { coefficient: { n: 1, d: 1 }, rest: text }
  }
  const n = Number(match[1])
  const d = match[2] ? Number(match[2]) : 1
  return { coefficient: { n, d }, rest: text.slice(match[0].length) }
}

/** Atoms of one formula fragment (no charge), e.g. "Ca(OH)2" or "5H2O". */
function parseAtoms(text: string): Record<string, number> | null {
  const stack: Array<Record<string, number>> = [{}]
  let i = 0
  const add = (target: Record<string, number>, element: string, count: number) => {
    target[element] = (target[element] ?? 0) + count
  }
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '(' || ch === '[') {
      stack.push({})
      i++
    } else if (ch === ')' || ch === ']') {
      if (stack.length < 2) return null
      i++
      const digits = /^\d+/.exec(text.slice(i))?.[0] ?? ''
      i += digits.length
      const group = stack.pop()!
      const multiplier = digits ? Number(digits) : 1
      for (const [element, count] of Object.entries(group)) add(stack[stack.length - 1]!, element, count * multiplier)
    } else if (/[A-Z]/.test(ch)) {
      const two = text.slice(i, i + 2)
      const element = /^[A-Z][a-z]$/.test(two) && ELEMENTS.has(two) ? two : ch
      if (!ELEMENTS.has(element)) return null
      i += element.length
      const digits = /^\d+/.exec(text.slice(i))?.[0] ?? ''
      i += digits.length
      add(stack[stack.length - 1]!, element, digits ? Number(digits) : 1)
    } else {
      return null
    }
  }
  if (stack.length !== 1) return null
  return stack[0]!
}

/** Hill order: C, H, then alphabetical (no C: all alphabetical). */
export function hillFormula(atoms: Record<string, number>): string {
  const elements = Object.keys(atoms).filter((e) => atoms[e]! > 0)
  const ordered = elements.includes('C')
    ? ['C', ...(elements.includes('H') ? ['H'] : []), ...elements.filter((e) => e !== 'C' && e !== 'H').sort()]
    : elements.sort()
  return ordered.map((e) => `${e}${atoms[e] === 1 ? '' : atoms[e]}`).join('')
}

/** One species, e.g. "Fe^3+", "SO4^2-", "e-", "CuSO4·5H2O", "NaCl(aq)". */
export function parseSpecies(raw: string): Species | null {
  let text = normalize(raw).replace(STATE, '').replace(/\s+/g, '')
  if (!text) return null
  let charge = 0
  // Charge: caret form (^2+, ^-, ^3+), or a bare trailing sign for ±1 (Na+,
  // Cl-, NH4+). As in mhchem, digits before a bare sign are a subscript —
  // NH4+ is NH₄⁺ and Fe3+ is Fe₃⁺ — so a larger charge needs the caret (Fe^3+).
  const caret = /\^(\d*)([+-])$/.exec(text)
  const trailing = caret ? null : /([+-])$/.exec(text)
  if (caret) {
    const magnitude = caret[1] ? Number(caret[1]) : 1
    charge = caret[2] === '+' ? magnitude : -magnitude
    text = text.slice(0, caret.index)
  } else if (trailing) {
    charge = trailing[1] === '+' ? 1 : -1
    text = text.slice(0, trailing.index)
  }
  if (text === 'e') {
    return charge === -1 ? { text: raw.trim(), atoms: {}, charge: -1, key: 'e-' } : null
  }
  const unbonded = text.replace(BONDS, '')
  const drawnBond = unbonded !== text
  text = unbonded
  const atoms: Record<string, number> = {}
  for (const part of text.split('·')) {
    const { coefficient, rest } = parseCoefficient(part)
    const partAtoms = parseAtoms(rest)
    if (!partAtoms || Object.keys(partAtoms).length === 0 || coefficient.d !== 1) return null
    for (const [element, count] of Object.entries(partAtoms)) {
      atoms[element] = (atoms[element] ?? 0) + count * coefficient.n
    }
  }
  const key = `${hillFormula(atoms)}${charge === 0 ? '' : `${Math.abs(charge)}${charge > 0 ? '+' : '-'}`}`
  const structure = text.includes('·') ? undefined : writtenStructure(text, drawnBond)
  return { text: raw.replace(STATE, '').trim(), atoms, charge, key, ...(structure ? { structure } : {}) }
}

/**
 * A condensed structural formula in a comparable form: simple groups
 * expanded (`(CH2)3` → `CH2CH2CH2`). Undefined for a plain molecular formula
 * (no element written twice and no bond drawn).
 */
function writtenStructure(text: string, drawnBond: boolean): string | undefined {
  let expanded = text
  for (let i = 0; i < 10; i++) {
    const next = expanded.replace(/[([]([^()[\]]+)[)\]](\d+)/g, (_, group: string, times: string) =>
      group.repeat(Math.min(Number(times), 20)),
    ).replace(/[([]([^()[\]]+)[)\]]/g, '$1')
    if (next === expanded) break
    expanded = next
  }
  const elements = expanded.match(/[A-Z][a-z]?/g) ?? []
  const repeated = new Set(elements).size < elements.length
  return drawnBond || repeated ? expanded : undefined
}

function parseSides(left: string, right: string, arrow: string): ParseResult {
  const sides: Term[][] = []
  for (const side of [left, right]) {
    if (!side.trim()) return { ok: false, reason: 'empty-side' }
    const terms: Term[] = []
    for (const rawTerm of splitTerms(side)) {
      if (!rawTerm) return { ok: false, reason: 'empty-side' }
      const { coefficient, rest } = parseCoefficient(rawTerm)
      const species = parseSpecies(rest)
      if (!species) return { ok: false, reason: 'bad-species', detail: rawTerm }
      terms.push({ coefficient, species })
    }
    sides.push(terms)
  }
  return {
    ok: true,
    equation: { reactants: sides[0]!, products: sides[1]!, written: { left: left.trim(), arrow: arrow.trim(), right: right.trim() } },
  }
}

/**
 * Where the arrow may be. Any real arrow wins (then every `=` is a double
 * bond); otherwise each `=` is a candidate, spaced ones (` = `) first.
 */
function arrowSplits(text: string): Array<{ left: string; arrow: string; right: string }> {
  const arrows = [...text.matchAll(ARROW)]
  if (arrows.length > 1) return []
  if (arrows.length === 1) {
    const match = arrows[0]!
    return [{ left: text.slice(0, match.index), arrow: match[0], right: text.slice(match.index! + match[0].length) }]
  }
  const candidates = [...text.matchAll(EQUALS_ARROW)].map((match) => ({
    left: text.slice(0, match.index),
    arrow: match[0],
    right: text.slice(match.index! + match[0].length),
    spaced: /^\s/.test(match[0]) && /\s$/.test(match[0]),
  }))
  return [...candidates.filter((c) => c.spaced), ...candidates.filter((c) => !c.spaced)]
}

export function parseEquation(input: string): ParseResult {
  const text = normalize(input)
  const splits = arrowSplits(text)
  if (splits.length === 0) return { ok: false, reason: 'no-arrow' }
  let firstFailure: ParseResult | null = null
  let firstParsed: ParseResult | null = null
  for (const split of splits) {
    const result = parseSides(split.left, split.right, split.arrow)
    if (!result.ok) {
      firstFailure ??= result
      continue
    }
    // Prefer the reading that balances; a double bond read as the arrow will not.
    if (imbalances(result.equation).length === 0) return result
    firstParsed ??= result
  }
  return firstParsed ?? firstFailure!
}

export interface Imbalance {
  /** An element symbol, or "charge". */
  what: string
  left: number
  right: number
}

function sideTotals(terms: Term[]): { atoms: Record<string, number>; charge: number } {
  const atoms: Record<string, number> = {}
  let charge = 0
  for (const { coefficient, species } of terms) {
    const factor = coefficient.n / coefficient.d
    for (const [element, count] of Object.entries(species.atoms)) {
      atoms[element] = (atoms[element] ?? 0) + count * factor
    }
    charge += species.charge * factor
  }
  return { atoms, charge }
}

/** Every element (and the charge) whose totals differ between the sides. */
export function imbalances(equation: ParsedEquation): Imbalance[] {
  const left = sideTotals(equation.reactants)
  const right = sideTotals(equation.products)
  const elements = [...new Set([...Object.keys(left.atoms), ...Object.keys(right.atoms)])].sort()
  const out: Imbalance[] = []
  const round = (x: number) => Math.round(x * 1e6) / 1e6
  for (const element of elements) {
    const l = round(left.atoms[element] ?? 0)
    const r = round(right.atoms[element] ?? 0)
    if (l !== r) out.push({ what: element, left: l, right: r })
  }
  if (round(left.charge) !== round(right.charge)) {
    out.push({ what: 'charge', left: round(left.charge), right: round(right.charge) })
  }
  return out
}

export type EquationComparison =
  | { verdict: 'correct' }
  | { verdict: 'unreadable'; detail?: string }
  | { verdict: 'species'; missing: string[]; extra: string[] }
  | { verdict: 'unbalanced'; imbalances: Imbalance[] }
  | { verdict: 'coefficients' }
  /** Balanced and matching by formula, but some organic structures are written differently. */
  | { verdict: 'isomers'; species: string[] }

/** Coefficients per species key on one side, as exact fractions. */
function coefficientsByKey(terms: Term[]): Map<string, { n: number; d: number; text: string }> {
  const map = new Map<string, { n: number; d: number; text: string }>()
  for (const { coefficient, species } of terms) {
    const existing = map.get(species.key)
    if (existing) {
      const n = existing.n * coefficient.d + coefficient.n * existing.d
      const d = existing.d * coefficient.d
      const g = gcd(n, d)
      map.set(species.key, { n: n / g, d: d / g, text: existing.text })
    } else {
      map.set(species.key, { ...coefficient, text: species.text })
    }
  }
  return map
}

/**
 * Compare a student's equation with the reference: same species on the same
 * sides (any order, states ignored), balanced, and coefficients proportional
 * to the reference (`4H2 + 2O2 -> 4H2O` matches `2H2 + O2 -> 2H2O`).
 */
export function compareEquations(answer: string, reference: ParsedEquation): EquationComparison {
  const parsed = parseEquation(answer)
  if (!parsed.ok) return { verdict: 'unreadable', ...(parsed.detail ? { detail: parsed.detail } : {}) }
  const student = parsed.equation

  const missing: string[] = []
  const extra: string[] = []
  const sides: Array<[Term[], Term[]]> = [
    [student.reactants, reference.reactants],
    [student.products, reference.products],
  ]
  for (const [mine, theirs] of sides) {
    const mineMap = coefficientsByKey(mine)
    const theirMap = coefficientsByKey(theirs)
    for (const [key, value] of theirMap) if (!mineMap.has(key)) missing.push(value.text)
    for (const [key, value] of mineMap) if (!theirMap.has(key)) extra.push(value.text)
  }
  if (missing.length > 0 || extra.length > 0) return { verdict: 'species', missing, extra }

  const unbalanced = imbalances(student)
  if (unbalanced.length > 0) return { verdict: 'unbalanced', imbalances: unbalanced }

  // Same species and balanced: the coefficients must be one common multiple
  // of the reference's (two separate reactions balanced differently are not).
  let ratio: number | null = null
  for (const [mine, theirs] of sides) {
    const theirMap = coefficientsByKey(theirs)
    for (const [key, value] of coefficientsByKey(mine)) {
      const reference = theirMap.get(key)!
      const r = (value.n / value.d) / (reference.n / reference.d)
      if (ratio === null) ratio = r
      else if (Math.abs(r - ratio) > 1e-9) return { verdict: 'coefficients' }
    }
  }

  // Same formula is not the same compound for organic structures (ethanol
  // and dimethyl ether are both C2H6O). When the reference draws a structure,
  // an answer written differently cannot be confirmed automatically.
  const isomers: string[] = []
  for (const [mine, theirs] of sides) {
    const reference = new Map(theirs.map(({ species }) => [species.key, species]))
    for (const { species } of mine) {
      const expected = reference.get(species.key)
      if (!expected?.structure || (expected.atoms.C ?? 0) < 2) continue
      if (species.structure !== expected.structure) isomers.push(species.text)
    }
  }
  if (isomers.length > 0) return { verdict: 'isomers', species: isomers }
  return { verdict: 'correct' }
}

/**
 * The typed equation in mhchem syntax, for rendering with `\ce{…}`: Unicode
 * sub/superscripts and arrows become what mhchem reads.
 */
export function toMhchem(input: string): string {
  return normalize(input)
    .replace(/⇌|⇄/g, '<=>')
    .replace(/↔/g, '<->')
    .replace(/→|⟶/g, '->')
    .replace(/·/g, '*')
}

/** How a typed equation will be read, for a live preview under the field. */
export type EquationPreview =
  | { status: 'empty' }
  | { status: 'ok'; latex: string }
  | { status: 'no-arrow' }
  | { status: 'bad-term'; term: string }

export function previewEquation(input: string): EquationPreview {
  if (!input.trim()) return { status: 'empty' }
  const parsed = parseEquation(input)
  if (parsed.ok) {
    // Render the arrow that was actually read; a `=` arrow becomes `->` so
    // mhchem does not draw it as a double bond.
    const { left, arrow, right } = parsed.equation.written
    const shownArrow = arrow.startsWith('=') ? `->${arrow.slice(1)}` : arrow
    return { status: 'ok', latex: `\\ce{${toMhchem(`${left} ${shownArrow} ${right}`)}}` }
  }
  if (parsed.reason === 'bad-species') return { status: 'bad-term', term: parsed.detail ?? input }
  return { status: 'no-arrow' }
}
