/**
 * A course graph rebuilt from a picture (「把这张图做成可交互图并出同类题」):
 * the vision model's reading (`econ-graph-read/v1`) is parsed with
 * `parseMarketSpec` and solved with `solveMarket`; the questions it found are
 * kept only when the engine can grade them. Then the rebuilt graph is
 * compared with the professor's answer, when there is one: every value or
 * direction the answer states must agree with the engine, otherwise the graph
 * is flagged and not used for variants. Pure.
 */
import { compareEconNumber, readEconNumber } from '@/infrastructure/math/economicsAnswer'
import {
  exactDecimal,
  expectedMarketAnswer,
  formatTargetValue,
  parseMarketQuestion,
  readShiftText,
  solveQuestion,
  targetEconSpec,
  type MarketFigure,
  type MarketQuestion,
} from './graphQuestion'
import { parseCurveSpec, parseQuantityScale, parseScenario } from './marketSpec'
import { solveMarket, type MarketScenario, type MarketSpec } from './market'

export interface GraphReading {
  figure: MarketFigure
  /** The graded questions found on the graph (may be empty). */
  asks: Array<{ label: string; question: MarketQuestion }>
  /** The picture showed no change the model could read (curves only). */
  scenarioUnknown: boolean
}

export type GraphReadResult = { ok: true; reading: GraphReading } | { ok: false; reason: string }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** A curve as the model wrote it: {points}, {intercept, slope}, {vertical}, {horizontal}. */
function curveOf(value: unknown) {
  const item = record(value)
  if (!item) return null
  if (Array.isArray(item.points)) return parseCurveSpec({ form: 'points', points: item.points })
  if ('vertical' in item) return parseCurveSpec({ form: 'vertical', quantity: item.vertical })
  if ('horizontal' in item) return parseCurveSpec({ form: 'horizontal', price: item.horizontal })
  return parseCurveSpec({ form: 'price', ...item })
}

/** Parse and solve the model's reading of a graph. */
export function readGraphReply(data: unknown): GraphReadResult {
  const reply = record(data)
  if (!reply) return { ok: false, reason: 'invalid-reply' }
  if (reply.readable === false)
    return {
      ok: false,
      reason:
        typeof reply.reason === 'string' && reply.reason.trim()
          ? reply.reason.trim().slice(0, 200)
          : 'unreadable',
    }
  const demand = curveOf(reply.demand)
  const supply = curveOf(reply.supply)
  if (!demand || !supply) return { ok: false, reason: 'curves-unreadable' }
  let scenario: MarketScenario | null = reply.scenario ? parseScenario(reply.scenario) : null
  const newDemand = reply.newDemand ? curveOf(reply.newDemand) : null
  const newSupply = reply.newSupply ? curveOf(reply.newSupply) : null
  if (!scenario && (newDemand || newSupply))
    scenario = {
      kind: 'shift',
      ...(newDemand ? { demand: { to: newDemand } } : {}),
      ...(newSupply ? { supply: { to: newSupply } } : {}),
    }
  const spec: MarketSpec = { demand, supply, scenario: scenario ?? { kind: 'equilibrium' } }
  const solved = solveMarket(spec)
  if (!solved.ok) return { ok: false, reason: `market-${solved.reason}` }
  const axes = record(reply.axes)
  const scale = parseQuantityScale(axes?.quantityScale)
  const priceUnit =
    typeof axes?.priceUnit === 'string' && axes.priceUnit.length <= 4 ? axes.priceUnit : '$'
  const figure: MarketFigure = {
    spec,
    show: 'after',
    ...(priceUnit ? { priceUnit } : {}),
    ...(scale && scale !== 'units' ? { quantityScale: scale } : {}),
  }
  const asks: GraphReading['asks'] = []
  const rawAsks = Array.isArray(reply.asks) ? reply.asks.slice(0, 6) : []
  for (const raw of rawAsks) {
    const item = record(raw)
    if (!item) continue
    const kind = item.kind
    const region = typeof item.region === 'string' ? item.region : undefined
    const question = parseMarketQuestion({
      kind,
      figure: { ...figure, show: 'before' },
      ...(item.target ? { target: item.target } : {}),
      ...(kind === 'draw_diagram'
        ? {
            draw: {
              items: drawItemsFor(spec, region),
              ...(region ? { region } : {}),
            },
          }
        : {}),
      // Both shifted curves drawn: their sizes are given, so the textbook
      // "ambiguous" is resolved by the drawing.
      ...(kind === 'shift_id' && newDemand && newSupply ? { qualitative: false } : {}),
    })
    if (!question) continue
    const label =
      typeof item.label === 'string' ? item.label.replace(/[()（）\s]/g, '').toLowerCase() : ''
    asks.push({ label, question })
  }
  return { ok: true, reading: { figure, asks, scenarioUnknown: !scenario } }
}

/** The items a drawing of this scenario can be graded on. */
function drawItemsFor(spec: MarketSpec, region: string | undefined): string[] {
  const kind = spec.scenario.kind
  const items =
    kind === 'shift'
      ? ['curve', 'direction', 'equilibrium']
      : kind === 'tax' || kind === 'subsidy'
        ? ['curve', 'direction', 'amount', 'equilibrium']
        : kind === 'equilibrium'
          ? []
          : kind === 'trade'
            ? ['policy']
            : ['policy', 'equilibrium']
  return region ? [...items, 'region'] : items
}

// --- the professor's answer ---------------------------------------------------------

export interface KeyComparison {
  status: 'agree' | 'disagree' | 'no-numbers'
  /** What was compared, e.g. "DWL $25 · answer $25". */
  details: string[]
}

const NUMBER_TOKEN =
  /[-−]?\s*(?:US\$|[$€£¥]\s*)?[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*(?:k|thousand|million))?\s*%?/gi

/** Mark annotations ("(2 marks)", "[3]", "B1", "2分") are not answer numbers. */
const MARK_NOTE =
  /[([]\s*\d+(?:\.\d+)?\s*(?:marks?|pts?|points?|分)?\s*[)\]]|\b[MAB]\d\b|\d+\s*分/gi

function numbersIn(text: string): string[] {
  return [...text.replace(MARK_NOTE, ' ').matchAll(NUMBER_TOKEN)]
    .map((match) => match[0].trim())
    .filter((token) => /\d/.test(token) && readEconNumber(token) !== null)
}

/** The part of the key for one labelled ask: after "(a)", before the next label. */
function keySection(key: string, label: string): string {
  if (!label) return key
  const pattern = new RegExp(`(?:^|\\n|\\s)\\(?${label}\\)\\s*`, 'i')
  const start = key.search(pattern)
  if (start < 0) return key
  const rest = key.slice(start + 1)
  const next = rest.search(/(?:^|\n|\s)\(?[a-h]\)\s/i)
  return next > 0 ? rest.slice(0, next) : rest
}

/**
 * Compare the rebuilt graph with the professor's answer: each value asked
 * (area_read) must appear among the numbers of its part of the answer; each
 * shift direction the answer states must be the engine's. Parts the answer
 * says nothing comparable about are not judged.
 */
export function compareWithKey(reading: GraphReading, key: string): KeyComparison {
  const details: string[] = []
  let compared = 0
  let disagree = false
  for (const ask of reading.asks) {
    const section = keySection(key, ask.label)
    const expected = expectedMarketAnswer(ask.question)
    if (!expected) continue
    if (expected.value) {
      const numbers = numbersIn(section)
      if (numbers.length === 0) continue
      compared += 1
      const spec = targetEconSpec(expected.value.target, ask.question.figure)
      const exact = exactDecimal(expected.value.number)
      const match = numbers.find(
        (token) => compareEconNumber(token, exact, spec).outcome === 'correct',
      )
      const shown = formatTargetValue(
        expected.value.number,
        expected.value.target,
        ask.question.figure,
      )
      details.push(
        `${ask.label ? `(${ask.label}) ` : ''}${expected.value.target}: ${shown}${match ? ` = ${match}` : ` ≠ ${numbers.slice(0, 3).join(', ')}`}`,
      )
      if (!match) disagree = true
      continue
    }
    if (expected.shift) {
      const stated = readShiftText(section)
      if (!stated) continue
      for (const component of ['demand', 'supply', 'price', 'quantity'] as const) {
        const said = stated[component]
        if (!said) continue
        compared += 1
        const right = said === expected.shift[component]
        details.push(
          `${ask.label ? `(${ask.label}) ` : ''}${component}: ${expected.shift[component]}${right ? '' : ` ≠ ${said}`}`,
        )
        if (!right) disagree = true
      }
      continue
    }
    if (expected.draw) {
      // A drawing's answer may state the new price and quantity; only then
      // are they compared.
      if (!/\b[PQ]\b|\bprice|\bquantit|价格|数量/i.test(section)) continue
      const numbers = numbersIn(section)
      if (numbers.length === 0) continue
      const solution = solveQuestion(ask.question)
      if (!solution) continue
      const point = [solution.outcome.p, solution.outcome.q]
      for (const value of point) {
        compared += 1
        const exact = exactDecimal(value)
        const match = numbers.find((token) => compareEconNumber(token, exact).outcome === 'correct')
        details.push(
          `${ask.label ? `(${ask.label}) ` : ''}${exact}${match ? ` = ${match}` : ' ∉ answer'}`,
        )
        if (!match) disagree = true
      }
    }
  }
  if (compared === 0) return { status: 'no-numbers', details }
  return { status: disagree ? 'disagree' : 'agree', details }
}
