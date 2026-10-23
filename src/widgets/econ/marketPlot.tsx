/**
 * Drawing pieces of a supply-and-demand diagram (SVG), shared by the tutor
 * figure (`market_2d`) and the graded graph questions: curves, shift arrows,
 * policy lines, equilibrium and outcome marks, curve labels.
 */
import { curveNumbers, type MarketCurve, type MarketSolution } from '@/entities/econ/market'
import type { MarketPanel } from '@/entities/tutorVisualization/types'
import type { TranslationKey, UseTranslationResult } from '@/i18n'
import { FOREGROUND, LABEL, type PlotScale } from '@/widgets/tutor/plotUtils'
import {
  DEMAND,
  POLICY,
  SUPPLY,
  arrowHead,
  curveD,
  policyD,
  priceOf,
  quantityOf,
  type Formatters,
  type PolicyLineSpec,
} from './marketPlotUtils'

type T = UseTranslationResult['t']

export function CurvePath({
  scale,
  curve,
  ranges,
  color,
  dashed,
  id,
}: {
  scale: PlotScale
  curve: MarketCurve
  ranges: { q: number; p: number }
  color: string
  dashed?: boolean
  id: string
}): JSX.Element {
  return (
    <path
      d={curveD(curve, scale, ranges)}
      fill="none"
      stroke={color}
      strokeWidth={dashed ? 1.6 : 2.2}
      strokeDasharray={dashed ? '6 5' : undefined}
      opacity={dashed ? 0.75 : 1}
      data-curve={id}
      data-dashed={dashed ? 'true' : undefined}
    />
  )
}

export function Arrow({
  x0,
  y0,
  x1,
  y1,
  color,
  both,
  ...rest
}: {
  x0: number
  y0: number
  x1: number
  y1: number
  color: string
  both?: boolean
  [data: `data-${string}`]: string | undefined
}): JSX.Element | null {
  if (Math.hypot(x1 - x0, y1 - y0) < 6) return null
  return (
    <g {...rest}>
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth="1.4" />
      <path d={arrowHead(x0, y0, x1, y1)} fill={color} />
      {both && <path d={arrowHead(x1, y1, x0, y0)} fill={color} />}
    </g>
  )
}

/** Old → new arrows for each shifted curve, at the old equilibrium price (or quantity). */
export function ShiftArrows({
  scale,
  solution,
}: {
  scale: PlotScale
  solution: MarketSolution
}): JSX.Element {
  const p = solution.original.p.value
  const q = solution.original.q.value
  const arrow = (from: MarketCurve, to: MarketCurve | undefined, color: string, key: string) => {
    if (!to) return null
    const q0 = quantityOf(from, p)
    const q1 = quantityOf(to, p)
    if (q0 !== null && q1 !== null && Math.abs(q1 - q0) > 1e-9) {
      // Offset slightly above the equilibrium so the arrow does not hide the point.
      const y = scale.sy(p) - 10
      return (
        <Arrow
          key={key}
          data-shift-arrow={key}
          x0={scale.sx(q0)}
          y0={y}
          x1={scale.sx(q1)}
          y1={y}
          color={color}
        />
      )
    }
    const p0 = priceOf(from, q)
    const p1 = priceOf(to, q)
    if (p0 === null || p1 === null) return null
    return (
      <Arrow
        key={key}
        data-shift-arrow={key}
        x0={scale.sx(q) + 10}
        y0={scale.sy(p0)}
        x1={scale.sx(q) + 10}
        y1={scale.sy(p1)}
        color={color}
      />
    )
  }
  return (
    <>
      {arrow(solution.demand, solution.newDemand, DEMAND, 'demand')}
      {arrow(solution.supply, solution.newSupply, SUPPLY, 'supply')}
    </>
  )
}

export function PolicyLine({
  scale,
  line,
  ranges,
}: {
  scale: PlotScale
  line: PolicyLineSpec
  ranges: { q: number; p: number }
}): JSX.Element {
  return (
    <g data-policy-line>
      <path d={policyD(line, scale, ranges)} stroke={POLICY} strokeWidth="1.6" fill="none" />
      {line.extra && (
        <path
          d={policyD({ ...line, value: line.extra.value }, scale, ranges)}
          stroke={POLICY}
          strokeWidth="1.2"
          strokeDasharray="3 3"
          fill="none"
        />
      )}
    </g>
  )
}

export function Guides({ scale, q, p }: { scale: PlotScale; q: number; p: number }): JSX.Element {
  return (
    <path
      d={`M ${scale.sx(q)} ${scale.sy(0)} L ${scale.sx(q)} ${scale.sy(p)} L ${scale.sx(0)} ${scale.sy(p)}`}
      fill="none"
      stroke={LABEL}
      strokeWidth="1"
      strokeDasharray="3 3"
    />
  )
}

export function EquilibriumMark({
  scale,
  q,
  p,
  index,
  fmt,
  point,
}: {
  scale: PlotScale
  q: number
  p: number
  index: string
  fmt: Formatters
  point: MarketSolution['original']
}): JSX.Element {
  return (
    <g data-equilibrium={index || 'only'}>
      <Guides scale={scale} q={q} p={p} />
      <circle cx={scale.sx(q)} cy={scale.sy(p)} r="4" fill={FOREGROUND} />
      <text x={scale.left + 4} y={scale.sy(p) - 4} fontSize="11" fill={FOREGROUND}>
        {`P${index}* = ${fmt.price(point.p)}`}
      </text>
      <text x={scale.sx(q) + 4} y={scale.bottom - 5} fontSize="11" fill={FOREGROUND}>
        {`Q${index}* = ${fmt.quantity(point.q)}`}
      </text>
    </g>
  )
}

export function OutcomeMarks({
  scale,
  solution,
  fmt,
  t,
}: {
  scale: PlotScale
  solution: MarketSolution
  fmt: Formatters
  t: T
}): JSX.Element {
  const q = solution.outcome.q.value
  const p = solution.outcome.p.value
  const pb = solution.buyerPrice
  const ps = solution.sellerPrice
  const wedge = pb && ps && Math.abs(pb.value - ps.value) > 1e-9
  return (
    <g data-outcome>
      <Guides scale={scale} q={q} p={p} />
      <circle cx={scale.sx(q)} cy={scale.sy(p)} r="4" fill={FOREGROUND} />
      <text x={scale.left + 4} y={scale.sy(p) - 4} fontSize="11" fill={FOREGROUND}>
        {pb ? `Pb = ${fmt.price(pb)}` : `P₂* = ${fmt.price(solution.outcome.p)}`}
      </text>
      <text x={scale.sx(q) + 4} y={scale.bottom - 18} fontSize="11" fill={FOREGROUND}>
        {`Q₂* = ${fmt.quantity(solution.outcome.q)}`}
      </text>
      {wedge && (
        <>
          <path
            d={`M ${scale.sx(q)} ${scale.sy(ps.value)} L ${scale.sx(0)} ${scale.sy(ps.value)}`}
            stroke={LABEL}
            strokeWidth="1"
            strokeDasharray="3 3"
            fill="none"
          />
          <text x={scale.left + 4} y={scale.sy(ps.value) + 13} fontSize="11" fill={FOREGROUND}>
            {`Ps = ${fmt.price(ps)}`}
          </text>
          <Arrow
            data-wedge="true"
            x0={scale.sx(q) - 8}
            y0={scale.sy(ps.value)}
            x1={scale.sx(q) - 8}
            y1={scale.sy(pb.value)}
            color={FOREGROUND}
            both
          />
          <text
            x={scale.sx(q) - 12}
            y={(scale.sy(ps.value) + scale.sy(pb.value)) / 2 + 4}
            textAnchor="end"
            fontSize="11"
            fill={FOREGROUND}
          >
            {t('viz.market.label.wedge', {
              amount: fmt.price(solution.wedge ?? { value: pb.value - ps.value, exact: pb.exact }),
            })}
          </text>
        </>
      )}
      {solution.gap && Math.abs(solution.gap.q1 - solution.gap.q0) > 1e-9 && (
        <GapBrace scale={scale} gap={solution.gap} solution={solution} fmt={fmt} t={t} />
      )}
    </g>
  )
}

export function GapBrace({
  scale,
  gap,
  solution,
  fmt,
  t,
}: {
  scale: PlotScale
  gap: NonNullable<MarketSolution['gap']>
  solution: MarketSolution
  fmt: Formatters
  t: T
}): JSX.Element {
  const y = scale.sy(gap.p) + (gap.kind === 'surplus' || gap.kind === 'exports' ? -14 : 14)
  const x0 = scale.sx(gap.q0)
  const x1 = scale.sx(gap.q1)
  const amount = solution.control?.gap ?? solution.trade?.volume
  return (
    <g data-gap={gap.kind}>
      <path
        d={`M ${x0} ${y - 4} L ${x0} ${y} L ${x1} ${y} L ${x1} ${y - 4}`}
        fill="none"
        stroke={FOREGROUND}
        strokeWidth="1.2"
      />
      <text x={(x0 + x1) / 2} y={y + 13} textAnchor="middle" fontSize="11" fill={FOREGROUND}>
        {`${t(`viz.market.gap.${gap.kind}` as TranslationKey)} ${amount ? fmt.quantity(amount) : ''}`.trim()}
      </text>
    </g>
  )
}

export function CurveLabels({
  scale,
  solution,
  ranges,
  labels,
  showNew,
}: {
  scale: PlotScale
  solution: MarketSolution
  ranges: { q: number; p: number }
  labels: NonNullable<MarketPanel['labels']>
  showNew: boolean
}): JSX.Element {
  const place = (curve: MarketCurve, side: 'demand' | 'supply') => {
    const c = curveNumbers(curve)
    if (c.kind === 'vertical') return { x: scale.sx(c.quantity) + 4, y: scale.top + 12 }
    if (c.slope === 0) return { x: scale.right - 18, y: scale.sy(c.intercept) - 5 }
    // Demand: near where it meets the bottom; supply: near the top of the plot.
    const p = side === 'demand' ? ranges.p * 0.08 : ranges.p * 0.92
    const q = Math.min(ranges.q * 0.94, Math.max(0, (p - c.intercept) / c.slope))
    const y = c.intercept + c.slope * q
    return { x: scale.sx(q) + 5, y: scale.sy(y) - 4 }
  }
  const items: Array<{ curve: MarketCurve; side: 'demand' | 'supply'; text: string; key: string }> =
    [
      { curve: solution.demand, side: 'demand', text: labels.demand ?? 'D', key: 'd' },
      { curve: solution.supply, side: 'supply', text: labels.supply ?? 'S', key: 's' },
    ]
  if (showNew && solution.newDemand)
    items.push({
      curve: solution.newDemand,
      side: 'demand',
      text: labels.newDemand ?? 'D₂',
      key: 'd2',
    })
  if (showNew && solution.newSupply)
    items.push({
      curve: solution.newSupply,
      side: 'supply',
      text: labels.newSupply ?? 'S₂',
      key: 's2',
    })
  return (
    <>
      {items.map((item) => {
        const at = place(item.curve, item.side)
        return (
          <text
            key={item.key}
            x={at.x}
            y={at.y}
            fontSize="12"
            fontWeight={600}
            fill={item.side === 'demand' ? DEMAND : SUPPLY}
            data-curve-label={item.key}
          >
            {item.text}
          </text>
        )
      })}
    </>
  )
}
