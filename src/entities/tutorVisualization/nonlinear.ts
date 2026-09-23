import { parse, type MathNode } from 'mathjs'
import type { VisualizationViewport } from './types'

/**
 * Safe parsing, validation and deterministic sampling for explicit nonlinear
 * functions of one variable (Phase 2).
 *
 * The model never supplies executable code: it supplies a short expression in
 * a restricted plain-text syntax (`x^2 + 2x + 1`, `sin(x)`, `2*exp(-x)`).
 * This module parses it with mathjs, walks the AST against a strict whitelist,
 * and compiles it into a plain closure. There is no `eval`, no `new Function`,
 * and no path from model output to arbitrary code.
 */

export interface FunctionLimits {
  /** Maximum expression-string length. */
  maxLength: number
  /** Maximum AST node count. */
  maxNodes: number
  /** Maximum AST nesting depth. */
  maxDepth: number
  /** Largest allowed constant exponent in `base ^ exponent`. */
  maxExponent: number
  /** Largest allowed numeric constant magnitude. */
  maxConstant: number
}

export const FUNCTION_LIMITS: FunctionLimits = {
  maxLength: 120,
  maxNodes: 80,
  maxDepth: 12,
  // Powers of a variable are limited to [0, 2] so the guaranteed polynomial
  // family stays exactly quadratic; reciprocals and roots are written with
  // `/` and `sqrt(...)` instead.
  maxExponent: 2,
  maxConstant: 1e6,
}

/** Functions the local evaluator understands. */
const ALLOWED_FUNCTIONS = new Set(['sin', 'cos', 'exp', 'log', 'ln', 'sqrt'])
/** The only free variable permitted. */
const ALLOWED_SYMBOLS = new Set(['x'])
/** Named constants and their values. */
const CONSTANT_SYMBOLS: Record<string, number> = {
  e: Math.E,
  E: Math.E,
  pi: Math.PI,
  PI: Math.PI,
}
const ALLOWED_OPERATORS = new Set(['+', '-', '*', '/', '^'])

export type CompiledFunction = (x: number) => number

export interface ParsedFunction {
  /** Normalised source that passed validation (for diagnostics/tests). */
  source: string
  evaluate: CompiledFunction
}

export interface FunctionDomain {
  min: number
  max: number
}

interface NodeLike {
  type: string
  value?: unknown
  name?: unknown
  op?: unknown
  args?: unknown
  content?: unknown
  fn?: unknown
}

/** Normalise Unicode maths into the plain syntax mathjs parses. */
function normalizeFunctionSource(input: string): string {
  return input
    .replace(/[−–—]/g, '-')
    .replace(/[×·⋅∗]/g, '*')
    .replace(/÷/g, '/')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'pi')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Numeric value of a constant-only subtree, or `null` if it is not constant. */
function constantValue(node: MathNode): number | null {
  const n = node as unknown as NodeLike
  if (n.type === 'ConstantNode') {
    const value = Number(n.value)
    return Number.isFinite(value) ? value : null
  }
  if (n.type === 'ParenthesisNode') {
    return n.content ? constantValue(n.content as MathNode) : null
  }
  if (n.type === 'OperatorNode') {
    const op = String(n.op)
    const args = (n.args as MathNode[] | undefined) ?? []
    if (args.length === 1 && (op === '-' || op === '+')) {
      const inner = constantValue(args[0]!)
      if (inner === null) return null
      return op === '-' ? -inner : inner
    }
    if (args.length === 2) {
      const left = constantValue(args[0]!)
      const right = constantValue(args[1]!)
      if (left === null || right === null) return null
      let result: number
      switch (op) {
        case '+':
          result = left + right
          break
        case '-':
          result = left - right
          break
        case '*':
          result = left * right
          break
        case '/':
          if (right === 0) return null
          result = left / right
          break
        case '^':
          result = Math.pow(left, right)
          break
        default:
          return null
      }
      return Number.isFinite(result) ? result : null
    }
  }
  return null
}

interface ValidateState {
  nodes: number
  maxDepth: number
}

/** Walk the AST against the whitelist, enforcing complexity limits. */
function validateNode(
  node: MathNode,
  depth: number,
  state: ValidateState,
  limits: FunctionLimits,
): boolean {
  state.nodes += 1
  if (state.nodes > limits.maxNodes) return false
  if (depth > limits.maxDepth) return false
  state.maxDepth = Math.max(state.maxDepth, depth)

  const n = node as unknown as NodeLike
  switch (n.type) {
    case 'ConstantNode': {
      const value = Number(n.value)
      return Number.isFinite(value) && Math.abs(value) <= limits.maxConstant
    }
    case 'SymbolNode': {
      const name = String(n.name)
      return ALLOWED_SYMBOLS.has(name) || Object.hasOwn(CONSTANT_SYMBOLS, name)
    }
    case 'ParenthesisNode': {
      const content = n.content as MathNode | undefined
      return content ? validateNode(content, depth + 1, state, limits) : false
    }
    case 'OperatorNode': {
      const op = String(n.op)
      if (!ALLOWED_OPERATORS.has(op)) return false
      const args = (n.args as MathNode[] | undefined) ?? []
      if (args.length < 1 || args.length > 2) return false
      if (op === '^') {
        const base = args[0]
        const exponent = args[1]
        if (!base || !exponent) return false
        const baseName =
          base.type === 'SymbolNode' ? String((base as unknown as NodeLike).name) : ''
        const baseIsE = baseName === 'e' || baseName === 'E'
        // A variable exponent is only safe when the base is the constant e
        // (the exponential family). Otherwise the exponent must be a small
        // constant, which keeps `x^x` and `2^x` out.
        if (!baseIsE) {
          const exponentConstant = constantValue(exponent)
          if (
            exponentConstant === null ||
            exponentConstant < 0 ||
            exponentConstant > limits.maxExponent
          ) {
            return false
          }
        }
        return (
          validateNode(base, depth + 1, state, limits) &&
          validateNode(exponent, depth + 1, state, limits)
        )
      }
      return args.every((arg) => validateNode(arg, depth + 1, state, limits))
    }
    case 'FunctionNode': {
      const fn = n.fn as MathNode | undefined
      if (!fn || fn.type !== 'SymbolNode') return false
      const name = String((fn as unknown as NodeLike).name)
      if (!ALLOWED_FUNCTIONS.has(name)) return false
      const args = (n.args as MathNode[] | undefined) ?? []
      if (args.length !== 1) return false
      return validateNode(args[0]!, depth + 1, state, limits)
    }
    default:
      return false
  }
}

function binary(
  left: CompiledFunction,
  right: CompiledFunction,
  combine: (a: number, b: number) => number,
): CompiledFunction {
  return (x) => combine(left(x), right(x))
}

/** Compile a validated AST into a plain closure (no interpreter overhead). */
function compileNode(node: MathNode): CompiledFunction {
  const n = node as unknown as NodeLike
  switch (n.type) {
    case 'ConstantNode': {
      const value = Number(n.value)
      return () => value
    }
    case 'SymbolNode': {
      const name = String(n.name)
      if (name === 'x') return (x) => x
      const constant = Object.hasOwn(CONSTANT_SYMBOLS, name) ? CONSTANT_SYMBOLS[name]! : Number.NaN
      return () => constant
    }
    case 'ParenthesisNode':
      return compileNode(n.content as MathNode)
    case 'OperatorNode': {
      const op = String(n.op)
      const args = (n.args as MathNode[]) ?? []
      if (op === '+') {
        return args.length === 1 ? compileNode(args[0]!) : binary(compileNode(args[0]!), compileNode(args[1]!), (a, b) => a + b)
      }
      if (op === '-') {
        if (args.length === 1) {
          const inner = compileNode(args[0]!)
          return (x) => -inner(x)
        }
        return binary(compileNode(args[0]!), compileNode(args[1]!), (a, b) => a - b)
      }
      if (op === '*') return binary(compileNode(args[0]!), compileNode(args[1]!), (a, b) => a * b)
      if (op === '/') return binary(compileNode(args[0]!), compileNode(args[1]!), (a, b) => a / b)
      if (op === '^') {
        const base = compileNode(args[0]!)
        const exponentConstant = constantValue(args[1]!)
        if (exponentConstant !== null) return (x) => Math.pow(base(x), exponentConstant)
        const exponent = compileNode(args[1]!)
        return (x) => Math.pow(base(x), exponent(x))
      }
      return () => Number.NaN
    }
    case 'FunctionNode': {
      const name = String((n.fn as unknown as NodeLike).name)
      const arg = compileNode((n.args as MathNode[])[0]!)
      switch (name) {
        case 'sin':
          return (x) => Math.sin(arg(x))
        case 'cos':
          return (x) => Math.cos(arg(x))
        case 'exp':
          return (x) => Math.exp(arg(x))
        case 'log':
        case 'ln':
          return (x) => Math.log(arg(x))
        case 'sqrt':
          return (x) => Math.sqrt(arg(x))
        default:
          return () => Number.NaN
      }
    }
    default:
      return () => Number.NaN
  }
}

/**
 * Parse and validate a model-supplied expression. Returns `null` for anything
 * outside the whitelist, over the complexity limits, or non-finite.
 */
export function parseExplicitFunction(
  input: unknown,
  limits: FunctionLimits = FUNCTION_LIMITS,
): ParsedFunction | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > limits.maxLength) return null
  // The plain syntax never contains a backslash; a LaTeX string is rejected
  // rather than half-interpreted.
  if (trimmed.includes('\\')) return null

  const source = normalizeFunctionSource(trimmed)
  if (!source || source.length > limits.maxLength) return null

  let node: MathNode
  try {
    node = parse(source)
  } catch {
    return null
  }

  const state: ValidateState = { nodes: 0, maxDepth: 0 }
  if (!validateNode(node, 0, state, limits)) return null

  try {
    const evaluate = compileNode(node)
    return { source, evaluate }
  } catch {
    return null
  }
}

/** Validate a model-supplied domain; invalid values are dropped. */
export function normalizeFunctionDomain(raw: unknown): FunctionDomain | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const min = Number(record.min)
  const max = Number(record.max)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined
  if (!(min < max)) return undefined
  if (Math.abs(min) > 1e6 || Math.abs(max) > 1e6) return undefined
  if (max - min < 1e-6) return undefined
  return { min, max }
}

export interface CurvePoint {
  x: number
  y: number
}

export interface SampledCurve {
  /** Independent polylines; a break means "do not connect across here". */
  segments: CurvePoint[][]
}

export const MIN_SAMPLES = 240
export const MAX_SAMPLES = 1440
const SAMPLES_PER_UNIT = 48
/** Finite values are clamped to this magnitude so no SVG coordinate explodes. */
const Y_CLAMP = 1e6

/**
 * A break between two adjacent finite samples that belong to different
 * branches: either a jump far larger than the window, or a sign flip with both
 * magnitudes larger than the window (a vertical asymptote).
 */
function isDiscontinuity(a: CurvePoint, b: CurvePoint, ySpan: number): boolean {
  const dy = Math.abs(b.y - a.y)
  if (dy > Math.max(ySpan * 8, 1e3)) return true
  if (a.y !== 0 && b.y !== 0 && Math.sign(a.y) !== Math.sign(b.y)) {
    if (Math.min(Math.abs(a.y), Math.abs(b.y)) > ySpan) return true
  }
  return false
}

/**
 * Deterministic uniform sampling over the visible x-range (intersected with an
 * optional domain). Non-finite results and detected asymptotes split the curve
 * into independent segments; a single bad sample can never break the rest.
 */
export function sampleFunction(
  evaluate: CompiledFunction,
  viewport: VisualizationViewport,
  domain?: FunctionDomain,
  maxSamples: number = MAX_SAMPLES,
): SampledCurve {
  const xStart = Math.max(viewport.xMin, domain?.min ?? viewport.xMin)
  const xEnd = Math.min(viewport.xMax, domain?.max ?? viewport.xMax)
  if (!(xStart < xEnd)) return { segments: [] }

  const xSpan = xEnd - xStart
  const ySpan = viewport.yMax - viewport.yMin
  const count = Math.max(
    MIN_SAMPLES,
    Math.min(maxSamples, Math.round(xSpan * SAMPLES_PER_UNIT) + 1),
  )
  const step = xSpan / (count - 1)

  const segments: CurvePoint[][] = []
  let current: CurvePoint[] = []
  let previous: CurvePoint | null = null

  for (let i = 0; i < count; i++) {
    const x = i === count - 1 ? xEnd : xStart + i * step
    let value: number
    try {
      value = evaluate(x)
    } catch {
      value = Number.NaN
    }
    if (!Number.isFinite(value)) {
      if (current.length > 0) segments.push(current)
      current = []
      previous = null
      continue
    }
    const point: CurvePoint = { x, y: Math.max(-Y_CLAMP, Math.min(Y_CLAMP, value)) }
    if (previous && isDiscontinuity(previous, point, ySpan)) {
      if (current.length > 0) segments.push(current)
      current = []
    }
    current.push(point)
    previous = point
  }
  if (current.length > 0) segments.push(current)

  return { segments: segments.filter((segment) => segment.length >= 2) }
}
