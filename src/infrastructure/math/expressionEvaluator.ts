import { OperatorNode, parse, simplify, type MathNode } from 'mathjs'

/**
 * Deterministic mathematical-expression equivalence.
 *
 * Strategy (in order):
 *   1. Normalise Unicode math (superscripts, ×, ÷, π, √, …).
 *   2. Parse both sides with mathjs (implicit multiplication is supported).
 *   3. Symbolic check: `simplify(lhs - rhs)` reduces to 0.
 *   4. Numeric sampling: evaluate both sides at several random points and
 *      compare within tolerance. A mismatch is strong evidence of inequality.
 *
 * Returns:
 *   true  — expressions are equivalent
 *   false — expressions are definitely not equivalent
 *   null  — could not be verified automatically (caller should say so)
 */
export type EquivalenceResult = true | false | null

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '^0',
  '¹': '^1',
  '²': '^2',
  '³': '^3',
  '⁴': '^4',
  '⁵': '^5',
  '⁶': '^6',
  '⁷': '^7',
  '⁸': '^8',
  '⁹': '^9',
}

/** Normalise a human-typed expression into mathjs-friendly syntax. */
export function normalizeExpression(input: string): string {
  let s = input.trim()
  // Unicode superscripts → caret notation
  for (const [sup, caret] of Object.entries(SUPERSCRIPTS)) {
    s = s.split(sup).join(caret)
  }
  s = s
    .replace(/[×⋅∗]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/∞/g, 'Infinity')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '!=')
    .replace(/\s+/g, ' ')
    .trim()
  return s
}

/**
 * Strip an integration constant ("+ C", "- C", "+c") from the end of an
 * expression, so `x^3/3 + C` matches `x^3/3`. Returns the stripped form and
 * whether a constant was removed.
 */
export function stripIntegrationConstant(expr: string): { expr: string; hadConstant: boolean } {
  const match = expr.match(/^(.*?)([+-])\s*[cCkK]\s*$/)
  if (!match) return { expr, hadConstant: false }
  return { expr: match[1]!.trim(), hadConstant: true }
}

/** Split an equation `lhs = rhs` into its two sides, if present. */
export function splitEquation(expr: string): [string, string] | null {
  // Ignore ==, <=, >=
  const idx = expr.indexOf('=')
  if (idx <= 0) return null
  if (expr[idx - 1] === '=' || expr[idx + 1] === '=') return null
  if (expr[idx - 1] === '<' || expr[idx - 1] === '>' || expr[idx - 1] === '!') return null
  const lhs = expr.slice(0, idx).trim()
  const rhs = expr.slice(idx + 1).trim()
  if (!lhs || !rhs) return null
  return [lhs, rhs]
}

function approxEqual(a: number, b: number, relTol = 1e-6, absTol = 1e-9): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b
  const diff = Math.abs(a - b)
  return diff <= absTol || diff <= relTol * Math.max(Math.abs(a), Math.abs(b))
}

const KNOWN_CONSTANTS = new Set(['pi', 'e', 'i', 'Infinity', 'true', 'false', 'null', 'NaN'])

function freeVariables(node: MathNode): string[] {
  const vars = new Set<string>()
  node.traverse((n, _path, parent) => {
    if (n.type !== 'SymbolNode') return
    const name = (n as unknown as { name: string }).name
    if (KNOWN_CONSTANTS.has(name)) return
    // Skip function names: in `sin(x)` mathjs stores `sin` as a SymbolNode
    // under a FunctionNode's `fn` property.
    const p = parent as unknown as { type?: string; fn?: unknown } | null
    if (p && p.type === 'FunctionNode' && p.fn === n) return
    // Skip object property access (`obj.prop`).
    if (p && p.type === 'AccessorNode') return
    vars.add(name)
  })
  return [...vars]
}

function isZeroNode(node: MathNode): boolean {
  const text = node.toString().replace(/\s+/g, '')
  return text === '0'
}

function symbolicEqual(a: MathNode, b: MathNode): EquivalenceResult {
  try {
    const diff = simplify(new OperatorNode('-', 'subtract', [a, b]))
    if (isZeroNode(diff)) return true
    // Sometimes simplify leaves `0 * x` etc. Try again after a second pass.
    const diff2 = simplify(diff)
    if (isZeroNode(diff2)) return true
    return false
  } catch {
    return null
  }
}

function numericEqual(a: MathNode, b: MathNode, vars: string[], samples = 16): EquivalenceResult {
  let successes = 0
  for (let i = 0; i < samples; i++) {
    const scope: Record<string, number> = {}
    for (const v of vars) {
      // Avoid 0 to reduce degenerate cases; keep values small.
      scope[v] = (Math.random() - 0.5) * 6 + 0.5
    }
    try {
      const va = a.evaluate(scope)
      const vb = b.evaluate(scope)
      if (typeof va !== 'number' || typeof vb !== 'number') continue
      if (Number.isNaN(va) || Number.isNaN(vb)) continue
      successes++
      if (!approxEqual(va, vb)) return false
    } catch {
      // Domain error at this sample (e.g. sqrt of negative); skip.
      continue
    }
  }
  if (successes === 0) return null
  return true
}

/** Compare two already-parsed nodes. */
export function nodesEquivalent(a: MathNode, b: MathNode): EquivalenceResult {
  const sym = symbolicEqual(a, b)
  if (sym === true) return true
  const vars = Array.from(new Set([...freeVariables(a), ...freeVariables(b)]))
  const num = numericEqual(a, b, vars)
  if (num === false) return false
  if (num === true) return true
  if (sym === false) return false
  return null
}

export interface MathComparison {
  equivalent: EquivalenceResult
  normalizedUser: string
  normalizedExpected: string
  note?: string
}

/**
 * High-level entry point. Handles equations (`x^2 = 4`) and integration
 * constants (`+ C`) before falling back to expression comparison.
 */
export function compareMath(userAnswer: string, expectedAnswer: string): MathComparison {
  const rawUser = userAnswer.trim()
  const rawExpected = expectedAnswer.trim()
  if (!rawUser) {
    return { equivalent: false, normalizedUser: '', normalizedExpected: normalizeExpression(rawExpected), note: 'Empty answer' }
  }

  const userNorm = normalizeExpression(rawUser)
  const expectedNorm = normalizeExpression(rawExpected)

  // Fast path: exact normalised string match
  if (userNorm === expectedNorm) {
    return { equivalent: true, normalizedUser: userNorm, normalizedExpected: expectedNorm }
  }

  // Integration constants: strip from both sides
  const userStripped = stripIntegrationConstant(userNorm)
  const expectedStripped = stripIntegrationConstant(expectedNorm)
  const userForCompare = userStripped.expr
  const expectedForCompare = expectedStripped.expr
  const constantNote =
    userStripped.hadConstant || expectedStripped.hadConstant
      ? 'Integration constant treated as arbitrary.'
      : undefined

  // Equations: compare each side independently
  const userEq = splitEquation(userForCompare)
  const expectedEq = splitEquation(expectedForCompare)
  if (userEq && expectedEq) {
    try {
      const [uL, uR] = userEq.map((s) => parse(s))
      const [eL, eR] = expectedEq.map((s) => parse(s))
      const diffL = nodesEquivalent(uL, eL)
      const diffR = nodesEquivalent(uR, eR)
      const swappedL = nodesEquivalent(uL, eR)
      const swappedR = nodesEquivalent(uR, eL)
      const sameOrder = diffL === true && diffR === true
      const swapped = swappedL === true && swappedR === true
      if (sameOrder || swapped) {
        return { equivalent: true, normalizedUser: userNorm, normalizedExpected: expectedNorm, ...(constantNote ? { note: constantNote } : {}) }
      }
      // One side matches but the other clearly does not → definitely different.
      const leftMatches = diffL === true || swappedL === true
      const rightMatches = diffR === true || swappedR === true
      if ((leftMatches && diffR === false && swappedR === false) || (rightMatches && diffL === false && swappedL === false)) {
        return { equivalent: false, normalizedUser: userNorm, normalizedExpected: expectedNorm }
      }
      // Otherwise the equations may be rearrangements of each other. We cannot
      // reliably decide without solving, so report unverified.
      return {
        equivalent: null,
        normalizedUser: userNorm,
        normalizedExpected: expectedNorm,
        note: 'Unable to verify automatically — equations may be rearranged.',
      }
    } catch {
      return { equivalent: null, normalizedUser: userNorm, normalizedExpected: expectedNorm, note: 'Could not parse equation.' }
    }
  }

  // Plain expressions
  try {
    const ua = parse(userForCompare)
    const ea = parse(expectedForCompare)
    const equivalent = nodesEquivalent(ua, ea)
    const out: MathComparison = { equivalent, normalizedUser: userNorm, normalizedExpected: expectedNorm }
    if (constantNote) out.note = constantNote
    if (equivalent === null) out.note = 'Unable to verify automatically.'
    return out
  } catch (err) {
    return {
      equivalent: null,
      normalizedUser: userNorm,
      normalizedExpected: expectedNorm,
      note: `Unable to verify automatically (${(err as Error).message.slice(0, 80)}).`,
    }
  }
}

/** Parse a numeric answer tolerantly (handles `1,000`, `3/4`, `2e-3`). */
export function parseNumeric(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '')
  if (!cleaned) return null
  const direct = Number(cleaned)
  if (Number.isFinite(direct)) return direct
  try {
    const node = parse(normalizeExpression(cleaned))
    if (freeVariables(node).length > 0) return null
    const value = node.evaluate()
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Relative tolerance numeric comparison. Default 1% — forgiving enough for
 * sensible rounding in physics/chemistry, tight enough to catch real errors.
 */
export function numericEquivalent(userAnswer: string, expectedAnswer: string, relTol = 1e-2): boolean | null {
  const u = parseNumeric(userAnswer)
  const e = parseNumeric(expectedAnswer)
  if (u === null || e === null) return null
  if (u === e) return true
  const diff = Math.abs(u - e)
  return diff <= relTol * Math.max(Math.abs(e), 1)
}