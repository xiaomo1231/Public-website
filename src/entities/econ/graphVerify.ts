/**
 * Checking a graph question an AI wrote (practice sets, AI mock papers,
 * mistake variants, the quiz): its `market` must parse (`parseMarketSpec`)
 * AND solve (`solveMarket`), what it asks must apply to the solved market,
 * and any curve equation written in the text must be the figure's. The
 * model's stated answer is never trusted: it is compared with the engine and,
 * when it disagrees, replaced by the engine's answer (and solution).
 */
import { solveMarket, resolveCurve, type MarketCurve, type MarketSpec } from './market'
import {
  expectedMarketAnswer,
  parseMarketQuestion,
  readShiftText,
  targetEconSpec,
  exactDecimal,
  type MarketQuestion,
  type ShiftAnswer,
} from './graphQuestion'
import { marketAnswerText, marketSolutionText, type MarketLanguage } from './graphGenerator'
import { compareEconNumber } from '@/infrastructure/math/economicsAnswer'

export type MarketVerifyResult =
  | {
      ok: true
      question: MarketQuestion
      /** The engine's answer (the stated one when it agreed). */
      answer: string
      solution: string
      /** The stated answer disagreed and was replaced by the engine's. */
      corrected: boolean
    }
  | { ok: false; reason: string }

const EQUATION =
  /\b([PQ])\s*[=＝]\s*([-−]?\s*\d+(?:\.\d+)?)\s*([+\-−])\s*\(?\s*(\d+(?:\.\d+)?)?\s*\)?\s*(?:[*×·]\s*)?([PQ])\b/g

function sameCurve(a: MarketCurve, b: MarketCurve): boolean {
  const close = (x: { n: bigint; d: bigint }, y: { n: bigint; d: bigint }) =>
    x.n * y.d === y.n * x.d
  if (a.kind === 'vertical' || b.kind === 'vertical')
    return a.kind === 'vertical' && b.kind === 'vertical' && close(a.q, b.q)
  return close(a.a, b.a) && close(a.b, b.b)
}

/**
 * Every linear equation "P = a ± bQ" / "Q = c ± dP" written in the text is
 * one of the figure's two curves (a stem with other numbers than the figure
 * would be answered against the wrong market).
 */
export function textMatchesSpec(text: string, spec: MarketSpec): boolean {
  const demand = resolveCurve(spec.demand, 'demand')
  const supply = resolveCurve(spec.supply, 'supply')
  if (!demand.ok || !supply.ok) return false
  for (const match of text.normalize('NFKC').matchAll(EQUATION)) {
    const [, left, interceptText, op, slopeText, right] = match
    if (!left || !right || left === right) continue
    const intercept = Number(interceptText!.replace(/[−\s]/g, (c) => (c === '−' ? '-' : '')))
    const slope = Number(slopeText ?? '1') * (op === '+' ? 1 : -1)
    if (!Number.isFinite(intercept) || !Number.isFinite(slope)) continue
    const form = left === 'P' ? 'price' : 'quantity'
    const candidates: MarketCurve[] = []
    for (const side of ['demand', 'supply'] as const) {
      const curve = resolveCurve({ form, intercept, slope }, side)
      if (curve.ok) candidates.push(curve.value)
    }
    if (
      !candidates.some((curve) => sameCurve(curve, demand.value) || sameCurve(curve, supply.value))
    )
      return false
  }
  return true
}

function shiftAgrees(stated: Partial<ShiftAnswer> | null, expected: ShiftAnswer): boolean {
  if (!stated) return false
  return (['demand', 'supply', 'price', 'quantity'] as const).every(
    (key) => stated[key] === undefined || stated[key] === expected[key],
  )
}

/** Read and check a `{"type":"market", …}` check; answer and solution from the engine. */
export function verifyMarketCheck(
  part: { prompt: string; answer: string; solution: string; stem?: string },
  check: Record<string, unknown>,
  language: MarketLanguage,
): MarketVerifyResult {
  const kind =
    check.kind ??
    (check.ask === 'shift'
      ? 'shift_id'
      : check.ask === 'value'
        ? 'area_read'
        : check.ask === 'draw'
          ? 'draw_diagram'
          : undefined)
  const spec = check.market ?? check.spec
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'market-unreadable' }
  const solved = (() => {
    try {
      return solveMarket(spec as MarketSpec)
    } catch {
      return null
    }
  })()
  const question = parseMarketQuestion({
    kind,
    figure: {
      spec,
      ...(typeof check.show === 'string' ? { show: check.show } : {}),
      priceUnit: typeof check.priceUnit === 'string' ? check.priceUnit : '$',
      ...(check.quantityScale ? { quantityScale: check.quantityScale } : {}),
    },
    ...(check.target ? { target: check.target } : {}),
    ...(check.draw ? { draw: check.draw } : {}),
    ...(check.qualitative === false ? { qualitative: false } : {}),
  })
  if (!question) {
    if (solved && !solved.ok) return { ok: false, reason: `market-${solved.reason}` }
    return { ok: false, reason: 'market-question-invalid' }
  }
  const text = `${part.stem ?? ''}\n${part.prompt}`
  if (!textMatchesSpec(text, question.figure.spec))
    return { ok: false, reason: 'stem-differs-from-figure' }
  const expected = expectedMarketAnswer(question)
  if (!expected) return { ok: false, reason: 'market-question-invalid' }
  let agrees = true
  if (expected.shift) agrees = shiftAgrees(readShiftText(part.answer), expected.shift)
  else if (expected.value) {
    const spec = targetEconSpec(expected.value.target, question.figure)
    agrees =
      compareEconNumber(part.answer, exactDecimal(expected.value.number), spec).outcome ===
      'correct'
  }
  const answer = marketAnswerText(question, language)
  // A disagreeing answer means the model's working is wrong too; a drawing's
  // worked solution is always the engine's (the prose cannot be checked).
  const engineSolution = !agrees || !!expected.draw || !part.solution.trim()
  return {
    ok: true,
    question,
    answer,
    solution: engineSolution ? marketSolutionText(question, language) : part.solution,
    corrected: !agrees,
  }
}
