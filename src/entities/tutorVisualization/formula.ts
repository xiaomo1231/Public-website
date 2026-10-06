import { derivative, parse, simplify, type MathNode } from 'mathjs'

/**
 * General formulas for interactive figures: one independent variable plus
 * named parameters (`A*cos(omega*t + phi)`, `Vmax*S/(Km + S)`).
 *
 * Same safety model as `nonlinear.ts`: the model supplies a plain-text
 * expression, it is parsed with mathjs, every node is checked against a
 * whitelist (only the declared variable and parameters, known constants and
 * functions, arithmetic), and the tree is compiled into plain closures — no
 * `eval`, no `new Function`. Derivatives are taken symbolically by mathjs and
 * compiled the same way; integrals are computed numerically.
 */

export const FORMULA_LIMITS = {
  maxLength: 200,
  maxNodes: 140,
  maxDepth: 18,
  maxConstant: 1e9,
} as const

const FUNCTIONS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sec: (v) => 1 / Math.cos(v),
  csc: (v) => 1 / Math.sin(v),
  cot: (v) => 1 / Math.tan(v),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
}

const CONSTANTS: Record<string, number> = { e: Math.E, E: Math.E, pi: Math.PI, PI: Math.PI }

/** A variable or parameter name the formula may use. */
export function isValidSymbolName(name: string): boolean {
  return (
    /^[A-Za-z][A-Za-z0-9_]{0,11}$/.test(name) &&
    !Object.hasOwn(FUNCTIONS, name) &&
    !Object.hasOwn(CONSTANTS, name)
  )
}

export type Scope = Record<string, number>
export type Compiled = (scope: Scope) => number

export interface ParsedFormula {
  source: string
  node: MathNode
  evaluate: Compiled
}

interface NodeLike {
  type: string
  value?: unknown
  name?: unknown
  op?: unknown
  args?: MathNode[]
  content?: MathNode
  fn?: MathNode
}

function normalizeSource(input: string): string {
  return input
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∗]/g, '*')
    .replace(/÷/g, '/')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi')
    .replace(/\s+/g, ' ')
    .trim()
}

function validate(node: MathNode, symbols: Set<string>, depth: number, state: { nodes: number }): boolean {
  state.nodes += 1
  if (state.nodes > FORMULA_LIMITS.maxNodes || depth > FORMULA_LIMITS.maxDepth) return false
  const n = node as unknown as NodeLike
  switch (n.type) {
    case 'ConstantNode': {
      const value = Number(n.value)
      return Number.isFinite(value) && Math.abs(value) <= FORMULA_LIMITS.maxConstant
    }
    case 'SymbolNode': {
      const name = String(n.name)
      return symbols.has(name) || Object.hasOwn(CONSTANTS, name)
    }
    case 'ParenthesisNode':
      return n.content ? validate(n.content, symbols, depth + 1, state) : false
    case 'OperatorNode': {
      const op = String(n.op)
      const args = n.args ?? []
      if (!['+', '-', '*', '/', '^'].includes(op) || args.length < 1 || args.length > 2) return false
      return args.every((arg) => validate(arg, symbols, depth + 1, state))
    }
    case 'FunctionNode': {
      const fn = n.fn as unknown as NodeLike | undefined
      if (!fn || fn.type !== 'SymbolNode' || !Object.hasOwn(FUNCTIONS, String(fn.name))) return false
      const args = n.args ?? []
      return args.length === 1 && validate(args[0]!, symbols, depth + 1, state)
    }
    default:
      return false
  }
}

/** Compile any arithmetic tree; unknown pieces evaluate to NaN. */
function compile(node: MathNode): Compiled {
  const n = node as unknown as NodeLike
  switch (n.type) {
    case 'ConstantNode': {
      const value = Number(n.value)
      return () => value
    }
    case 'SymbolNode': {
      const name = String(n.name)
      if (Object.hasOwn(CONSTANTS, name)) {
        const value = CONSTANTS[name]!
        return () => value
      }
      return (scope) => (Object.hasOwn(scope, name) ? scope[name]! : Number.NaN)
    }
    case 'ParenthesisNode':
      return n.content ? compile(n.content) : () => Number.NaN
    case 'OperatorNode': {
      const op = String(n.op)
      const args = (n.args ?? []).map(compile)
      if (args.length === 1) {
        const [a] = args as [Compiled]
        return op === '-' ? (s) => -a(s) : op === '+' ? a : () => Number.NaN
      }
      const [a, b] = args as [Compiled, Compiled]
      switch (op) {
        case '+':
          return (s) => a(s) + b(s)
        case '-':
          return (s) => a(s) - b(s)
        case '*':
          return (s) => a(s) * b(s)
        case '/':
          return (s) => a(s) / b(s)
        case '^':
          return (s) => Math.pow(a(s), b(s))
        default:
          return () => Number.NaN
      }
    }
    case 'FunctionNode': {
      const name = String((n.fn as unknown as NodeLike).name)
      const fn = FUNCTIONS[name]
      const args = n.args ?? []
      if (!fn || args.length !== 1) return () => Number.NaN
      const arg = compile(args[0]!)
      return (s) => fn(arg(s))
    }
    default:
      return () => Number.NaN
  }
}

/**
 * Parse a model-supplied formula in which only `symbols` (the variable and
 * the parameters) may appear. Null for anything outside the whitelist.
 */
export function parseFormula(input: unknown, symbols: string[]): ParsedFormula | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > FORMULA_LIMITS.maxLength || trimmed.includes('\\')) return null
  // A formula is the right-hand side; tolerate "y = …" / "f(x) = …".
  const rhs = normalizeSource(trimmed.includes('=') ? trimmed.slice(trimmed.lastIndexOf('=') + 1) : trimmed)
  if (!rhs) return null
  let node: MathNode
  try {
    node = parse(rhs)
  } catch {
    return null
  }
  if (!validate(node, new Set(symbols), 0, { nodes: 0 })) return null
  return { source: rhs, node, evaluate: compile(node) }
}

/** d/dvariable of a parsed formula, compiled; null when mathjs cannot differentiate it. */
export function derivativeOf(formula: ParsedFormula | MathNode, variable: string): { node: MathNode; evaluate: Compiled } | null {
  try {
    const source = 'node' in formula ? formula.node : formula
    const node = derivative(source, variable)
    return { node, evaluate: compile(node) }
  } catch {
    return null
  }
}

/** Central-difference derivative, the fallback when symbolic differentiation fails. */
export function numericDerivative(evaluate: Compiled, scope: Scope, variable: string): number {
  const x = scope[variable]!
  const h = 1e-5 * Math.max(1, Math.abs(x))
  return (evaluate({ ...scope, [variable]: x + h }) - evaluate({ ...scope, [variable]: x - h })) / (2 * h)
}

/** Taylor coefficients c₀ … c_order of f around `center` (f⁽ᵏ⁾(a)/k!), or null. */
export function taylorCoefficients(
  formula: ParsedFormula,
  variable: string,
  center: number,
  order: number,
  scope: Scope = {},
): number[] | null {
  const coefficients: number[] = []
  let node: MathNode = formula.node
  let factorial = 1
  for (let k = 0; k <= order; k++) {
    if (k > 0) {
      factorial *= k
      try {
        node = simplify(derivative(node, variable))
      } catch {
        return null
      }
    }
    const value = compile(node)({ ...scope, [variable]: center })
    if (!Number.isFinite(value)) return null
    coefficients.push(value / factorial)
  }
  return coefficients
}

export function evaluatePolynomial(coefficients: number[], center: number, x: number): number {
  let sum = 0
  let power = 1
  for (const c of coefficients) {
    sum += c * power
    power *= x - center
  }
  return sum
}

/** ∫ₐᵇ f by composite Simpson's rule with many panels (smooth integrands). */
export function integrate(f: (x: number) => number, a: number, b: number, panels = 2000): number {
  const n = panels % 2 === 0 ? panels : panels + 1
  const h = (b - a) / n
  let sum = f(a) + f(b)
  for (let i = 1; i < n; i++) sum += (i % 2 === 0 ? 2 : 4) * f(a + i * h)
  return (sum * h) / 3
}

export type RiemannMethod = 'left' | 'right' | 'midpoint' | 'trapezoid'

export interface RiemannPiece {
  x0: number
  x1: number
  /** Rectangle height, or for the trapezoid rule the two end heights. */
  height: number
  left: number
  right: number
}

export function riemannSum(
  f: (x: number) => number,
  a: number,
  b: number,
  n: number,
  method: RiemannMethod,
): { sum: number; pieces: RiemannPiece[] } {
  const width = (b - a) / n
  const pieces: RiemannPiece[] = []
  let sum = 0
  for (let i = 0; i < n; i++) {
    const x0 = a + i * width
    const x1 = x0 + width
    const left = f(x0)
    const right = f(x1)
    const height = method === 'left' ? left : method === 'right' ? right : method === 'midpoint' ? f((x0 + x1) / 2) : (left + right) / 2
    sum += height * width
    pieces.push({ x0, x1, height, left, right })
  }
  return { sum, pieces }
}

/** Sample a one-variable view of a formula; non-finite values break the line. */
export function sampleFormula(
  evaluate: Compiled,
  variable: string,
  scope: Scope,
  min: number,
  max: number,
  samples = 240,
): Array<{ x: number; y: number }> {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const x = min + ((max - min) * i) / samples
    return { x, y: evaluate({ ...scope, [variable]: x }) }
  })
}

/** "2.5x^2 − 0.3x + 1" style polynomial text for the Taylor legend (plain text). */
export function polynomialText(coefficients: number[], center: number, variable: string, format: (v: number) => string): string {
  const term = (k: number) => {
    const base = center === 0 ? variable : `(${variable} ${center > 0 ? '−' : '+'} ${format(Math.abs(center))})`
    return k === 0 ? '' : k === 1 ? base : `${base}^${k}`
  }
  const parts = coefficients
    .map((c, k) => ({ c, k }))
    .filter(({ c }) => Math.abs(c) > 1e-12)
    .map(({ c, k }, i) => {
      const sign = c < 0 ? '−' : i === 0 ? '' : '+'
      const magnitude = Math.abs(c)
      const coefficient = k > 0 && Math.abs(magnitude - 1) < 1e-12 ? '' : format(magnitude)
      return `${sign}${i === 0 ? '' : ' '}${coefficient}${term(k)}`
    })
  return parts.length ? parts.join(' ') : '0'
}
