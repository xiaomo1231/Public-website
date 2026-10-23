import { parse } from 'mathjs'
import {
  compareMath,
  normalizeExpression,
  numericEquivalent,
  parseNumeric,
} from '@/infrastructure/math/expressionEvaluator'
import { compareQuantity, isValidUnit, splitQuantity } from '@/infrastructure/math/quantityAnswer'
import {
  asSigFigCount,
  judgeSigFigs,
  readSigFigs,
  sigFigRelativeTolerance,
} from '@/infrastructure/math/significantFigures'
import type { AnswerDimensions } from '@/entities/question/answerDimensions'
import { compareEquations, imbalances, parseEquation } from '@/infrastructure/chemistry/equation'
import { parseMatrix, rref, solutionKind, type SolutionKind } from '@/infrastructure/math/rref'
import { compareVector } from '@/infrastructure/math/vectorAnswer'
import {
  compareEconNumber,
  econSpecFromText,
  readEconNumber,
  type EconNumberSpec,
} from '@/infrastructure/math/economicsAnswer'
import { compareFormula, nameAccepted } from '@/infrastructure/chemistry/nomenclature'
import { walkthroughSubparts } from '../splitQuestion'
import { verifyMarketCheck } from '@/entities/econ/graphVerify'
import { gradeMarketQuestion, type MarketGradeResult } from '@/entities/econ/graphQuestion'
import { freeCount, linearSystemPart, type PracticeLanguage } from './linearSystem'
import type { PracticeGrader, PracticePart, PracticeQuestionInfo, PracticeSlotPart } from './types'

/**
 * Local checks around AI-written practice questions, and local grading of the
 * student's answers.
 *
 * An AI part may come with a `check` the app can recompute: a linear system
 * (its augmented matrix, row-reduced here with exact fractions), a numeric
 * expression, or a chemical equation (parsed and balance-checked). When the
 * recomputation disagrees with the AI's answer — or a linear system does not
 * have the solution type the slot asks for — the question is dropped. When it
 * agrees, the stored answer is the local one. Parts with no check keep the AI
 * answer and are graded by the AI answer check.
 */

export interface RawPart {
  label?: string
  prompt: string
  answer: string
  solution: string
  check?: Record<string, unknown> | null
}

export type VerifyResult = { ok: true; part: PracticePart } | { ok: false; reason: string }

const NUMERIC_TOLERANCE = 1e-3

/** Short decimal for a computed value (6 significant digits). */
export function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(6)))
}

/** The first number written in a text (sign, decimals, exponent, a fraction). */
function firstNumber(text: string): string {
  const match = /[-+−]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/.exec(text)
  return match ? match[0].replace('−', '-').replace(/\s+/g, '') : ''
}

/** An economics number in a text: `$1,800`, `−$20`, `85 000`, `10%`, `60k`, `1.25`. */
const ECON_NUMBER_TOKEN =
  /[-+−]?\s*(?:US\$|[$€£¥]\s*)?[-+−]?(?:\d{1,3}(?:,\d{3})+|\d{1,3}(?:[^\S\r\n]\d{3})+|\d+)?(?:\.\d+)?(?:\s*(?:k|thousand|million|bn|billion)\b)?\s*%?/gi

function firstEconNumber(text: string): string {
  for (const match of text.matchAll(ECON_NUMBER_TOKEN)) {
    const token = match[0].trim()
    if (/\d/.test(token) && readEconNumber(token)) return token
  }
  return ''
}

/** A `check` that states economics reading rules itself (`absolute`, `scale`, `percent`). */
function econCheckSpec(check: Record<string, unknown> | null): EconNumberSpec {
  if (!check) return {}
  const scale = typeof check.scale === 'number' && check.scale > 1 ? check.scale : undefined
  return {
    ...(check.absolute === true ? { absolute: true } : {}),
    ...(scale ? { scale } : {}),
    ...(check.percent === true ? { percent: true } : {}),
  }
}

function hasEconCheck(check: Record<string, unknown> | null): boolean {
  return Object.keys(econCheckSpec(check)).length > 0
}

/**
 * A numeric economics answer: the stated answer may be money or a percentage
 * (`$1,800`, `10%`); it must agree with the recomputed value under the
 * economics reading rules (`compareEconNumber`, absolute-value elasticity
 * included). The stated wording is kept as the answer shown and graded against.
 */
function verifyEconNumeric(
  raw: RawPart,
  value: number,
  check: Record<string, unknown> | null,
  label: { label?: string },
): VerifyResult {
  const spec = econSpecFromText(raw.prompt, econCheckSpec(check))
  const token = firstEconNumber(raw.answer)
  if (!token) return { ok: false, reason: 'answer-differs-from-computation' }
  // The stated answer against the computation, read as a student's answer
  // would be: the computed value may be in the stated unit or a full amount
  // (thousands), a fraction for a percentage, or −ε for |ε|.
  const agrees = [value, ...(spec.scale && spec.scale > 1 ? [value * spec.scale] : [])].some(
    (candidate) => compareEconNumber(formatValue(candidate), token, spec).outcome === 'correct',
  )
  if (!agrees) return { ok: false, reason: 'answer-differs-from-computation' }
  return {
    ok: true,
    part: {
      ...label,
      prompt: raw.prompt,
      answer: token,
      solution: raw.solution,
      grader: {
        kind: 'numeric',
        expected: spec.absolute ? Math.abs(value) : value,
        relTol: 1e-2,
        econ: spec,
        expectedText: token,
      },
    },
  }
}

/**
 * Whether a prompt writes the system of `matrix`: every integer entry other
 * than 0 and ±1 (often left implicit, "x + y") appears as a number in it.
 */
function promptShowsMatrix(prompt: string, matrix: readonly { n: bigint; d: bigint }[][]): boolean {
  const written = new Set((prompt.match(/\d+/g) ?? []).map((token) => String(Number(token))))
  for (const row of matrix) {
    for (const entry of row) {
      if (entry.d !== 1n) continue
      const value = entry.n < 0n ? -entry.n : entry.n
      if (value <= 1n) continue
      if (!written.has(value.toString())) return false
    }
  }
  return true
}

export function verifyAiPart(
  raw: RawPart,
  requirement: PracticeSlotPart | undefined,
  language: PracticeLanguage,
  /** `economics`: a numeric answer without a unit is money / a percentage (`$1,800`, `10%`). */
  options: { economics?: boolean } = {},
): VerifyResult {
  const label = raw.label ? { label: raw.label } : {}
  const check = raw.check ?? null
  const type = typeof check?.type === 'string' ? check.type : ''
  // A slot that mirrors a linear system must stay one, with the same type.
  if (requirement?.system && type !== 'linear_system')
    return { ok: false, reason: 'missing-linear-system' }

  // Economics graph question: the market is solved here; the stated answer
  // is replaced by the engine's when it disagrees.
  if (type === 'market' && check) {
    const verified = verifyMarketCheck(raw, check, language)
    if (!verified.ok) return { ok: false, reason: verified.reason }
    return {
      ok: true,
      part: {
        ...label,
        prompt: raw.prompt,
        answer: verified.answer,
        solution: verified.solution,
        grader: { kind: 'market', question: verified.question },
      },
    }
  }

  if (type === 'linear_system') {
    const matrix = parseMatrix(check?.augmented)
    if (!matrix || matrix[0]!.length < 3) return { ok: false, reason: 'unreadable-matrix' }
    const reduced = rref(matrix)
    const kind = solutionKind(reduced)
    const claimed = asSolution(check?.solution)
    if (claimed && claimed !== kind) return { ok: false, reason: 'solution-type-mismatch' }
    if (requirement?.system && requirement.system.solution !== kind)
      return { ok: false, reason: 'solution-type-differs-from-original' }
    const local = linearSystemPart(
      {
        spec: { rows: matrix.length, vars: matrix[0]!.length - 1, solution: kind, free: 0 },
        augmented: matrix,
        reduced,
        pivots: [],
      },
      { language, asMatrix: true },
    )
    // The answer is computed from `augmented`: the student must see that
    // system. A prompt whose numbers do not match it (a typo by the model)
    // is replaced by the system built from the matrix.
    const prompt = raw.prompt && promptShowsMatrix(raw.prompt, matrix) ? raw.prompt : local.prompt
    return {
      ok: true,
      part: { ...local, ...label, prompt },
    }
  }

  if (type === 'numeric') {
    const value = typeof check?.expression === 'string' ? parseNumeric(check.expression) : null
    if (value === null) return { ok: false, reason: 'unreadable-expression' }
    const unit = typeof check?.unit === 'string' ? check.unit.trim() : ''
    if (!unit && (options.economics || hasEconCheck(check)))
      return verifyEconNumeric(raw, value, check, label)
    // The first number of the stated answer ("The speed is 5 m/s" → 5); the
    // letters e / E of the words around it are not part of it.
    // Significant figures the answer must carry (chemistry / physics): the
    // stated answer is rounded to them, so it may differ from the computed
    // value by that rounding.
    const sigFigs = asSigFigCount(check?.sigFigs)
    const statedText = firstNumber(raw.answer)
    const stated = parseNumeric(statedText)
    const tolerance = sigFigs
      ? sigFigRelativeTolerance(statedText, value, sigFigs, NUMERIC_TOLERANCE)
      : NUMERIC_TOLERANCE
    if (stated === null || numericEquivalent(String(stated), String(value), tolerance) !== true)
      return { ok: false, reason: 'answer-differs-from-computation' }
    const shown = sigFigs
      ? String(value.toPrecision(sigFigs)).replace('e+', 'e')
      : formatValue(value)
    const figures = sigFigs ? { sigFigs } : {}
    if (unit && isValidUnit(unit)) {
      return {
        ok: true,
        part: {
          ...label,
          prompt: raw.prompt,
          answer: `${shown} ${unit}`,
          solution: raw.solution,
          grader: { kind: 'quantity', value, unit, ...figures },
        },
      }
    }
    return {
      ok: true,
      part: {
        ...label,
        prompt: raw.prompt,
        answer: shown,
        solution: raw.solution,
        grader: { kind: 'numeric', expected: value, relTol: 1e-2, ...figures },
      },
    }
  }

  if (type === 'chem_equation') {
    const equation = typeof check?.equation === 'string' ? check.equation.trim() : ''
    const parsed = parseEquation(equation)
    if (!parsed.ok || imbalances(parsed.equation).length > 0)
      return { ok: false, reason: 'equation-not-balanced' }
    return {
      ok: true,
      part: {
        ...label,
        prompt: raw.prompt,
        answer: equation,
        solution: raw.solution,
        grader: { kind: 'chem_equation', equation },
      },
    }
  }

  if (!raw.answer.trim()) return { ok: false, reason: 'missing-answer' }
  return {
    ok: true,
    part: {
      ...label,
      prompt: raw.prompt,
      answer: raw.answer,
      solution: raw.solution,
      grader: { kind: 'text' },
    },
  }
}

function asSolution(value: unknown): SolutionKind | null {
  return value === 'none' || value === 'unique' || value === 'infinite' ? value : null
}

// --- Grading the student's answer -------------------------------------------------

export type PracticeVerdict = 'correct' | 'incorrect' | 'partial'

/**
 * Grade a typed answer locally. `null` when any part cannot be decided here
 * (no grader, unreadable, a part missing): the AI answer check then compares
 * the whole answer with the reference solution.
 */
export function checkPracticeAnswer(
  info: Pick<PracticeQuestionInfo, 'parts'>,
  draft: string,
): {
  verdict: PracticeVerdict
  expectedAnswer: string
  /** Per part: value / unit / significant figures, for parts that require significant figures. */
  dimensions: Array<AnswerDimensions | undefined>
  /** Per part: the item-by-item result of a graph (market) part. */
  market?: Array<MarketGradeResult | undefined>
  /** Share of the answer that is right (graph parts give partial credit), 0–1. */
  score?: number
} | null {
  const text = draft.trim()
  if (!text || info.parts.length === 0) return null
  const answers: string[] = []
  if (info.parts.length === 1) answers.push(text)
  else {
    const split = walkthroughSubparts(text)
    for (const part of info.parts) {
      const found = split.find((item) => item.label === part.label)
      if (!found) return null
      answers.push(found.text)
    }
  }
  const results: number[] = []
  const dimensions: Array<AnswerDimensions | undefined> = []
  const market: Array<MarketGradeResult | undefined> = []
  for (let index = 0; index < info.parts.length; index += 1) {
    const grader = info.parts[index]!.grader
    if (grader.kind === 'market') {
      // Item-by-item partial credit within the part.
      const graded = answers[index]!.trim()
        ? gradeMarketQuestion(grader.question, answers[index]!)
        : null
      if (!graded || graded.unreadable || graded.total <= 0) return null
      results.push(graded.earned / graded.total)
      market.push(graded)
      dimensions.push(undefined)
      continue
    }
    const result = gradePart(grader, answers[index]!)
    if (result === null) return null
    results.push(result ? 1 : 0)
    market.push(undefined)
    dimensions.push(partDimensions(grader, answers[index]!) ?? undefined)
  }
  const score = results.reduce((sum, value) => sum + value, 0) / results.length
  const expectedAnswer = info.parts
    .map((part) => (part.label ? `(${part.label}) ${part.answer}` : part.answer))
    .join('; ')
  return {
    verdict: score >= 1 - 1e-9 ? 'correct' : score <= 1e-9 ? 'incorrect' : 'partial',
    expectedAnswer,
    dimensions,
    ...(market.some(Boolean) ? { market, score } : {}),
  }
}

export function gradePart(grader: PracticeGrader, answer: string): boolean | null {
  const text = answer.trim().replace(/^\$+|\$+$/g, '')
  if (!text) return null
  switch (grader.kind) {
    case 'linear_system':
      return gradeLinearSystem(grader, text)
    case 'expression':
      return compareMath(text, grader.expected).equivalent
    case 'numeric': {
      if (grader.econ) {
        const outcome = compareEconNumber(
          text,
          grader.expectedText ?? String(grader.expected),
          grader.econ,
        ).outcome
        return outcome === 'unreadable' ? null : outcome === 'correct'
      }
      if (!grader.sigFigs) return numericEquivalent(text, String(grader.expected), grader.relTol)
      const dims = partDimensions(grader, text)
      return dims ? (dims.value === 'unreadable' ? null : dims.value === 'correct') : null
    }
    case 'quantity': {
      if (!grader.sigFigs) return compareQuantity(text, String(grader.value), grader.unit).isCorrect
      const dims = partDimensions(grader, text)
      if (!dims || dims.value === 'unreadable' || dims.unit?.status === 'unreadable') return null
      return dims.value === 'correct' && dims.unit?.status === 'correct'
    }
    case 'chem_equation': {
      const reference = parseEquation(grader.equation)
      if (!reference.ok) return null
      const result = compareEquations(text, reference.equation)
      return result.verdict === 'correct'
        ? true
        : result.verdict === 'unreadable' || result.verdict === 'isomers'
          ? null
          : false
    }
    case 'choice': {
      const letter = choiceLetter(text, grader.count)
      return letter === null ? null : letter === grader.correct.toUpperCase()
    }
    case 'vector': {
      const outcome = compareVector(text, {
        components: grader.components,
        ...(grader.unit ? { unit: grader.unit } : {}),
      }).outcome
      return outcome === 'correct'
        ? true
        : outcome === 'unreadable' || outcome === 'unreadable-unit'
          ? null
          : false
    }
    case 'market': {
      const graded = gradeMarketQuestion(grader.question, text)
      if (!graded || graded.unreadable) return null
      return graded.items.every((item) => item.correct)
    }
    case 'nomenclature': {
      if (grader.direction === 'formula_to_name')
        // An unlisted wording may still be right: the AI check decides then.
        return nameAccepted(text, grader.names) ? true : null
      const outcome = compareFormula(text, grader.formula)
      return outcome === 'correct'
        ? true
        : outcome === 'unreadable' || outcome === 'isomers'
          ? null
          : false
    }
    default:
      return null
  }
}

/** The option letter an answer picks ("C", "(c)", "C.", "选 C"); null when unclear. */
export function choiceLetter(answer: string, count: number): string | null {
  const text = answer.normalize('NFKC').trim()
  const match = /^(?:选|answer[:：]?\s*)?\s*[([]?\s*([A-Za-z])\s*[)\].:：]?$/i.exec(text)
  if (!match) return null
  const letter = match[1]!.toUpperCase()
  const index = letter.charCodeAt(0) - 65
  return index >= 0 && index < count ? letter : null
}

const NO_SOLUTION = /(无解|没有解|不相容|no solution|inconsistent|has no solutions?)/i
const ASSIGNMENT = /x_?\{?(\d)\}?\s*=\s*([^,;，；\n]+)/g

/**
 * Linear systems: "无解" for an inconsistent system; otherwise every unknown
 * as `x1 = …` — numbers for a unique solution, or expressions in parameters
 * that satisfy every equation and have exactly as many free parameters as the
 * system has free variables.
 */
function gradeLinearSystem(
  grader: Extract<PracticeGrader, { kind: 'linear_system' }>,
  text: string,
): boolean | null {
  const saysNone = NO_SOLUTION.test(text)
  const assignments = new Map<number, string>()
  for (const match of text.matchAll(ASSIGNMENT)) {
    assignments.set(Number(match[1]) - 1, match[2]!.trim().replace(/[.。]$/, ''))
  }
  if (grader.solution === 'none') {
    if (saysNone) return true
    return assignments.size > 0 ? false : null
  }
  if (saysNone && assignments.size === 0) return false
  const matrix = parseMatrix(grader.augmented)
  if (!matrix) return null
  const vars = matrix[0]!.length - 1
  for (let index = 0; index < vars; index += 1) if (!assignments.has(index)) return null
  const exprs: string[] = []
  for (let index = 0; index < vars; index += 1) exprs.push(assignments.get(index)!)

  if (grader.solution === 'unique') {
    const reduced = parseMatrix(grader.rref)
    if (!reduced) return null
    for (let index = 0; index < vars; index += 1) {
      const value = parseNumeric(exprs[index]!)
      if (value === null) return null
      const expected = reduced[index]![vars]!
      const exact = Number(expected.n) / Number(expected.d)
      if (Math.abs(value - exact) > 1e-6 * Math.max(1, Math.abs(exact))) return false
    }
    return true
  }

  // Infinitely many: substitute parameter values and check every equation.
  let compiled: Array<{ evaluate: (scope: Record<string, number>) => unknown }>
  const params = new Set<string>()
  try {
    compiled = exprs.map((expr) => {
      const node = parse(normalizeExpression(expr))
      node.traverse((child) => {
        if (child.type === 'SymbolNode') {
          const name = (child as unknown as { name: string }).name
          if (!/^(pi|e)$/i.test(name)) params.add(name)
        }
      })
      return node.compile()
    })
  } catch {
    return null
  }
  // Function names (sqrt…) show up as symbols too; the answer should not need them.
  const names = [...params].filter((name) => !/^x_?\d$/.test(name))
  if (names.length !== grader.free) return false
  const numbers = matrix.map((row) => row.map((entry) => Number(entry.n) / Number(entry.d)))
  const point = (values: number[]): number[] | null => {
    const scope = Object.fromEntries(names.map((name, index) => [name, values[index]!]))
    const out: number[] = []
    for (const item of compiled) {
      const value = item.evaluate(scope)
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      out.push(value)
    }
    return out
  }
  const base = point(names.map(() => 0.37))
  if (!base) return null
  const samples = [
    names.map(() => 0.37),
    names.map((_, i) => 1.9 - i),
    names.map((_, i) => -2.3 + 0.7 * i),
  ]
  for (const sample of samples) {
    const x = point(sample)
    if (!x) return null
    for (const row of numbers) {
      const lhs = row
        .slice(0, vars)
        .reduce((sum, coefficient, column) => sum + coefficient * x[column]!, 0)
      if (Math.abs(lhs - row[vars]!) > 1e-6 * Math.max(1, Math.abs(row[vars]!))) return false
    }
  }
  // Each parameter must move the solution in an independent direction.
  const directions = names.map((_, k) => {
    const shifted = names.map((__, i) => 0.37 + (i === k ? 1 : 0))
    const x = point(shifted)
    return x ? x.map((value, i) => value - base[i]!) : null
  })
  if (directions.some((direction) => direction === null)) return null
  return floatRank(directions as number[][]) === grader.free && freeCountMatches(grader)
}

function freeCountMatches(grader: Extract<PracticeGrader, { kind: 'linear_system' }>): boolean {
  const reduced = parseMatrix(grader.rref)
  return reduced ? freeCount(reduced) === grader.free : true
}

function floatRank(vectors: number[][]): number {
  const rows = vectors.map((row) => [...row])
  let rank = 0
  const width = rows[0]?.length ?? 0
  for (let column = 0; column < width && rank < rows.length; column += 1) {
    let best = rank
    for (let r = rank; r < rows.length; r += 1)
      if (Math.abs(rows[r]![column]!) > Math.abs(rows[best]![column]!)) best = r
    if (Math.abs(rows[best]![column]!) < 1e-9) continue
    ;[rows[rank], rows[best]] = [rows[best]!, rows[rank]!]
    for (let r = 0; r < rows.length; r += 1) {
      if (r === rank) continue
      const factor = rows[r]![column]! / rows[rank]![column]!
      rows[r] = rows[r]!.map((value, c) => value - factor * rows[rank]![c]!)
    }
    rank += 1
  }
  return rank
}

/**
 * Value, unit and significant figures of one answer, judged separately, for
 * a numeric / quantity part that requires significant figures (null for any
 * other part). A significant-figure slip never makes the part wrong here: how
 * it counts is the course rule, applied by the caller.
 */
export function partDimensions(grader: PracticeGrader, answer: string): AnswerDimensions | null {
  const text = answer.trim().replace(/^\$+|\$+$/g, '')
  if (grader.kind !== 'numeric' && grader.kind !== 'quantity') return null
  if (!grader.sigFigs || !text) return null
  const expected = grader.kind === 'numeric' ? grader.expected : grader.value
  const tolerance = sigFigRelativeTolerance(text, expected, grader.sigFigs)
  const reading = readSigFigs(text)
  const judgement = judgeSigFigs(text, grader.sigFigs)
  const sigFigs: NonNullable<AnswerDimensions['sigFigs']> = {
    status: judgement.status,
    required: grader.sigFigs,
    ...(judgement.given ? { given: judgement.given } : {}),
    ...(judgement.ambiguous ? { ambiguous: true } : {}),
  }
  if (grader.kind === 'numeric') {
    const value = parseNumeric(text) ?? (reading && !reading.rest.trim() ? reading.value : null)
    if (value === null) return { value: 'unreadable' }
    const close =
      expected === 0
        ? Math.abs(value) <= 1e-9
        : Math.abs(value - expected) <= tolerance * Math.abs(expected)
    return {
      value: close ? 'correct' : 'wrong',
      sigFigs: reading && reading.rest.trim() ? { ...sigFigs, status: 'unreadable' } : sigFigs,
    }
  }
  const result = compareQuantity(text, String(expected), grader.unit, { relTol: tolerance })
  const unit = (status: NonNullable<AnswerDimensions['unit']>['status']) => ({
    status,
    expected: grader.unit,
    ...(result.givenUnit ? { given: result.givenUnit } : {}),
    ...(result.converted ? { converted: true } : {}),
  })
  switch (result.outcome) {
    case 'correct':
      return { value: 'correct', unit: unit('correct'), sigFigs }
    case 'wrong-value':
      return { value: 'wrong', unit: unit('correct'), sigFigs }
    case 'wrong-unit':
      return { value: 'correct', unit: unit('wrong-unit'), sigFigs }
    case 'missing-unit': {
      const bare = splitQuantity(text)
      const close =
        bare !== null && Math.abs(bare.value - expected) <= tolerance * Math.abs(expected || 1)
      return { value: close ? 'correct' : 'wrong', unit: unit('missing'), sigFigs }
    }
    case 'wrong-dimension':
      return { value: 'wrong', unit: unit('wrong-dimension'), sigFigs }
    default:
      return { value: 'unreadable', unit: unit('unreadable') }
  }
}
