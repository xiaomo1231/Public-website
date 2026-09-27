import type { TranslationKey } from '@/i18n/types'

/**
 * The function families the interactive homepage plot can draw.
 *
 * Every family is expressed two ways from the same coefficient values:
 *  - `buildExpression` produces a plain-text expression that the lesson
 *    visualizer's own parser validates and compiles (see
 *    `entities/tutorVisualization/nonlinear`). Powers above 2 are written as
 *    repeated multiplication (`x*x*x`) so the parser's exponent cap is kept —
 *    the shared whitelist is never widened for this widget.
 *  - `formatFormula` produces the human-readable formula shown above the plot.
 * Because both come from the same values, the curve, the coordinates and the
 * printed formula can never disagree.
 */

export type FunctionTypeId = 'linear' | 'quadratic' | 'cubic' | 'sine'

export interface ParamSpec {
  key: string
  /** Mathematical symbol shown as the control label (language-neutral). */
  symbol: string
  min: number
  max: number
  step: number
  default: number
}

export interface FunctionDef {
  id: FunctionTypeId
  labelKey: TranslationKey
  params: ParamSpec[]
  buildExpression: (values: Record<string, number>) => string
  formatFormula: (values: Record<string, number>) => string
}

const MINUS = '−'

/** Trim floating-point noise from a displayed number. */
export function num(value: number, digits = 2): string {
  const rounded = Number(value.toFixed(digits))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

interface Term {
  coef: number
  /** Display factor, e.g. `x²`; empty for a constant term. */
  factor: string
}

/**
 * Assemble a readable polynomial for display: zero terms are dropped and a
 * unit coefficient is implicit (`x²`, not `1·x²`). This is standard notation
 * for the same function the curve draws.
 */
function polyFormula(terms: Term[]): string {
  const parts: string[] = []
  for (const { coef, factor } of terms) {
    if (coef === 0) continue
    const magnitude = Math.abs(coef)
    const body = factor
      ? magnitude === 1
        ? factor
        : `${num(magnitude)}·${factor}`
      : num(magnitude)
    if (parts.length === 0) parts.push(coef < 0 ? `${MINUS}${body}` : body)
    else parts.push(coef < 0 ? `${MINUS} ${body}` : `+ ${body}`)
  }
  return parts.length === 0 ? '0' : parts.join(' ')
}

/** ` + c*factor` / ` - c*factor`, for the plain-text expression. */
function mul(coefficient: number, factor: string): string {
  return ` ${coefficient < 0 ? '-' : '+'} ${Math.abs(coefficient)}*${factor}`
}

const LINEAR: FunctionDef = {
  id: 'linear',
  labelKey: 'plot.type.linear',
  params: [
    { key: 'a', symbol: 'a', min: -3, max: 3, step: 0.1, default: 1 },
    { key: 'b', symbol: 'b', min: -4, max: 4, step: 0.1, default: 0 },
  ],
  buildExpression: (v) => `${v.a}*x${mul(v.b, '1')}`,
  formatFormula: (v) =>
    `f(x) = ${polyFormula([
      { coef: v.a, factor: 'x' },
      { coef: v.b, factor: '' },
    ])}`,
}

const QUADRATIC: FunctionDef = {
  id: 'quadratic',
  labelKey: 'plot.type.quadratic',
  params: [
    { key: 'a', symbol: 'a', min: -2, max: 2, step: 0.1, default: 1 },
    { key: 'b', symbol: 'b', min: -4, max: 4, step: 0.1, default: 0 },
    { key: 'c', symbol: 'c', min: -4, max: 4, step: 0.1, default: 0 },
  ],
  buildExpression: (v) => `${v.a}*x^2${mul(v.b, 'x')}${mul(v.c, '1')}`,
  formatFormula: (v) =>
    `f(x) = ${polyFormula([
      { coef: v.a, factor: 'x²' },
      { coef: v.b, factor: 'x' },
      { coef: v.c, factor: '' },
    ])}`,
}

const CUBIC: FunctionDef = {
  id: 'cubic',
  labelKey: 'plot.type.cubic',
  params: [
    { key: 'a', symbol: 'a', min: -1, max: 1, step: 0.05, default: 0.3 },
    { key: 'b', symbol: 'b', min: -2, max: 2, step: 0.1, default: 0 },
    { key: 'c', symbol: 'c', min: -4, max: 4, step: 0.1, default: 0 },
  ],
  buildExpression: (v) => `${v.a}*x*x*x${mul(v.b, 'x*x')}${mul(v.c, 'x')}`,
  formatFormula: (v) =>
    `f(x) = ${polyFormula([
      { coef: v.a, factor: 'x³' },
      { coef: v.b, factor: 'x²' },
      { coef: v.c, factor: 'x' },
    ])}`,
}

const SINE: FunctionDef = {
  id: 'sine',
  labelKey: 'plot.type.sine',
  params: [
    { key: 'A', symbol: 'A', min: 0.5, max: 3, step: 0.1, default: 1.5 },
    { key: 'w', symbol: 'ω', min: 0.5, max: 3, step: 0.1, default: 1 },
    { key: 'phi', symbol: 'φ', min: -3.1, max: 3.1, step: 0.1, default: 0 },
  ],
  buildExpression: (v) => `${v.A}*sin(${v.w}*x${mul(v.phi, '1')})`,
  formatFormula: (v) =>
    `f(x) = ${v.A === 1 ? '' : `${num(v.A)}·`}sin(${polyFormula([
      { coef: v.w, factor: 'x' },
      { coef: v.phi, factor: '' },
    ])})`,
}

export const FUNCTION_TYPES: readonly FunctionDef[] = [LINEAR, QUADRATIC, CUBIC, SINE]

export const FUNCTION_TYPE_BY_ID: Record<FunctionTypeId, FunctionDef> = {
  linear: LINEAR,
  quadratic: QUADRATIC,
  cubic: CUBIC,
  sine: SINE,
}

/** The default coefficient values for a family. */
export function defaultsForType(id: FunctionTypeId): Record<string, number> {
  const values: Record<string, number> = {}
  for (const param of FUNCTION_TYPE_BY_ID[id].params) values[param.key] = param.default
  return values
}

/**
 * A uniform random choice of family, used once when the homepage is entered.
 * Accepts an explicit `random` so the choice is deterministic in tests.
 */
export function pickInitialFunctionType(random: number = Math.random()): FunctionTypeId {
  const clamped = Math.min(0.999999, Math.max(0, random))
  const index = Math.floor(clamped * FUNCTION_TYPES.length)
  return FUNCTION_TYPES[index]!.id
}
