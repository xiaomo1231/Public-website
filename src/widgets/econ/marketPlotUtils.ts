/**
 * Numbers and paths of a supply-and-demand diagram, shared by the tutor
 * figure (`market_2d`) and the graded graph questions: axis ranges, colours,
 * formatters, curve and policy-line paths. Components are in `marketPlot.tsx`.
 */
import {
  curveNumbers,
  formatMarketNumber,
  quantityScaleFactor,
  type AreaEffect,
  type AreaKind,
  type MarketCurve,
  type MarketNumber,
  type MarketSolution,
  type MarketSpec,
} from '@/entities/econ/market'
import { niceTickStep } from '@/entities/tutorVisualization/linear'
import type { MarketVisualization } from '@/entities/tutorVisualization/types'
import type { MarketFigure } from '@/entities/econ/graphQuestion'
import type { TranslationKey, UseTranslationResult } from '@/i18n'
import { FOREGROUND, SERIES, SERIES_SOFT, type PlotScale } from '@/widgets/tutor/plotUtils'

type T = UseTranslationResult['t']

export const PAD = { left: 50, right: 16, top: 16, bottom: 34 }

export const AREA_FILL: Record<AreaKind, string> = {
  cs: SERIES_SOFT[0]!,
  ps: SERIES_SOFT[1]!,
  revenue: SERIES_SOFT[2]!,
  cost: SERIES_SOFT[2]!,
  rent: SERIES_SOFT[2]!,
  tariff: SERIES_SOFT[2]!,
  transfer: SERIES_SOFT[3]!,
  dwl: 'hsl(var(--destructive) / 0.24)',
  total_revenue: SERIES_SOFT[2]!,
}
export const EFFECT_FILL: Record<AreaEffect, string> = {
  gain: 'hsl(var(--primary) / 0.28)',
  loss: 'hsl(var(--destructive) / 0.26)',
  unchanged: 'hsl(var(--muted-foreground) / 0.16)',
}
export const DEMAND = SERIES[0]!
export const SUPPLY = SERIES[1]!
export const POLICY = FOREGROUND

// --- numeric helpers for drawing -----------------------------------------------

export function priceOf(curve: MarketCurve, q: number): number | null {
  const c = curveNumbers(curve)
  return c.kind === 'sloped' ? c.intercept + c.slope * q : null
}

export function quantityOf(curve: MarketCurve, p: number): number | null {
  const c = curveNumbers(curve)
  if (c.kind === 'vertical') return c.quantity
  return c.slope === 0 ? null : (p - c.intercept) / c.slope
}

/** Axis ranges from the full scenario, fixed while animating or exploring. */
export function marketRanges(solution: MarketSolution): { q: number; p: number } {
  const qs = [solution.original.q.value, solution.outcome.q.value]
  const ps = [solution.original.p.value, solution.outcome.p.value]
  for (const curve of [solution.demand, solution.newDemand]) {
    if (!curve) continue
    const c = curveNumbers(curve)
    if (c.kind === 'sloped' && c.slope < 0) {
      ps.push(c.intercept)
      qs.push(-c.intercept / c.slope)
    }
  }
  if (solution.gap) qs.push(solution.gap.q1)
  for (const n of [solution.buyerPrice, solution.sellerPrice, solution.control?.price]) {
    if (n) ps.push(n.value)
  }
  if (solution.trade) ps.push(solution.trade.worldPrice.value, solution.trade.domesticPrice.value)
  for (const curve of [solution.supply, solution.newSupply]) {
    if (!curve) continue
    const c = curveNumbers(curve)
    if (c.kind === 'vertical') qs.push(c.quantity)
  }
  const nice = (values: number[]) => {
    const top = Math.max(...values.filter((v) => Number.isFinite(v) && v > 0)) * 1.1
    const step = niceTickStep(top, 5)
    return Math.ceil(top / step) * step
  }
  return { q: nice(qs), p: nice(ps) }
}

export function withUnit(text: string, unit: string | undefined): string {
  if (!unit) return text
  if (text.startsWith('≈ ')) return `≈ ${withUnit(text.slice(2), unit)}`
  if (text.startsWith('−')) return `−${unit}${text.slice(1)}`
  return `${unit}${text}`
}

export function signed(text: string): string {
  return text.startsWith('−') || text.startsWith('≈') || text === '0' ? text : `+${text}`
}

export interface Formatters {
  price: (n: MarketNumber) => string
  quantity: (n: MarketNumber) => string
  money: (n: MarketNumber) => string
}

export function formatters(
  visualization: Pick<MarketVisualization, 'priceUnit' | 'quantityScale'>,
): Formatters {
  const factor = quantityScaleFactor(visualization.quantityScale)
  const scale = factor > 1 ? ` ×${factor.toLocaleString('en-US')}` : ''
  return {
    price: (n) => withUnit(formatMarketNumber(n), visualization.priceUnit),
    quantity: (n) => formatMarketNumber(n),
    money: (n) => `${withUnit(formatMarketNumber(n), visualization.priceUnit)}${scale}`,
  }
}

// --- drawing parts ------------------------------------------------------------------

export function curveD(
  curve: MarketCurve,
  scale: PlotScale,
  ranges: { q: number; p: number },
): string {
  const c = curveNumbers(curve)
  if (c.kind === 'vertical')
    return `M ${scale.sx(c.quantity)} ${scale.sy(0)} L ${scale.sx(c.quantity)} ${scale.sy(ranges.p)}`
  const q1 = ranges.q
  return `M ${scale.sx(0)} ${scale.sy(c.intercept)} L ${scale.sx(q1)} ${scale.sy(c.intercept + c.slope * q1)}`
}

export function arrowHead(x0: number, y0: number, x1: number, y1: number, size = 7): string {
  const angle = Math.atan2(y1 - y0, x1 - x0)
  const a = angle + Math.PI * 0.85
  const b = angle - Math.PI * 0.85
  return `M ${x1} ${y1} L ${x1 + size * Math.cos(a)} ${y1 + size * Math.sin(a)} L ${x1 + size * Math.cos(b)} ${y1 + size * Math.sin(b)} Z`
}

export interface PolicyLineSpec {
  axis: 'price' | 'quantity'
  value: number
  label: string
  /** A second line (world price + tariff). */
  extra?: { value: number; label: string }
}

export function policyLineOf(
  spec: MarketSpec,
  solution: MarketSolution,
  t: T,
): PolicyLineSpec | null {
  const scenario = spec.scenario
  switch (scenario.kind) {
    case 'ceiling':
    case 'floor':
      return {
        axis: 'price',
        value: scenario.price,
        label: t(
          scenario.kind === 'ceiling' ? 'viz.market.label.ceiling' : 'viz.market.label.floor',
        ),
      }
    case 'quota':
      return { axis: 'quantity', value: scenario.quantity, label: t('viz.market.label.quota') }
    case 'trade': {
      const domestic = solution.trade?.domesticPrice.value
      return {
        axis: 'price',
        value: scenario.worldPrice,
        label: t('viz.market.label.world'),
        ...(domestic !== undefined && domestic > scenario.worldPrice + 1e-9
          ? { extra: { value: domestic, label: t('viz.market.label.tariff') } }
          : {}),
      }
    }
    default:
      return null
  }
}

export function policyD(
  line: PolicyLineSpec,
  scale: PlotScale,
  ranges: { q: number; p: number },
): string {
  return line.axis === 'price'
    ? `M ${scale.sx(0)} ${scale.sy(line.value)} L ${scale.sx(ranges.q)} ${scale.sy(line.value)}`
    : `M ${scale.sx(line.value)} ${scale.sy(0)} L ${scale.sx(line.value)} ${scale.sy(ranges.p)}`
}

/** The size of a question figure / answer diagram (scaled to the column). */
export const FIGURE_WIDTH = 520
export const FIGURE_HEIGHT = 380

/** The axis labels of a market figure (units, "in thousands"). */
export function axisLabels(
  figure: Pick<MarketFigure, 'priceUnit' | 'quantityUnit' | 'quantityScale'>,
  t: (key: TranslationKey) => string,
): { x: string; y: string } {
  const x =
    figure.quantityScale && figure.quantityScale !== 'units'
      ? `Q (${t(`viz.market.scale.${figure.quantityScale}` as TranslationKey)}${figure.quantityUnit ? ` ${figure.quantityUnit}` : ''})`
      : figure.quantityUnit
        ? `Q (${figure.quantityUnit})`
        : 'Q'
  const y = figure.priceUnit ? `P (${figure.priceUnit})` : 'P'
  return { x, y }
}
