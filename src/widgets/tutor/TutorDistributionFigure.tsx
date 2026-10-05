import { niceTickStep } from '@/entities/tutorVisualization/linear'
import {
  density,
  describeParams,
  formatNumber,
  intervalLabel,
  intervalProbability,
  isDiscrete,
  moments,
  plotRange,
} from '@/entities/tutorVisualization/distribution'
import type { DistributionVisualization } from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'

const AXIS = 'hsl(var(--viz-axis))'
const GRID = 'hsl(var(--viz-grid))'
const LABEL = 'hsl(var(--viz-label))'
const SERIES = 'hsl(var(--viz-series-1))'
const SERIES_SOFT = 'hsl(var(--viz-series-1) / 0.3)'
const FILL = 'hsl(var(--viz-fill) / 0.22)'

const SAMPLES = 240

function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = []
  const start = Math.ceil(min / step) * step
  for (let v = start; v <= max + step * 1e-9 && out.length < 40; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  }
  return out
}

/**
 * A probability distribution: bars for a discrete pmf, a curve for a
 * continuous pdf, with the lesson's interval shaded. Every number on the
 * figure is computed locally from the validated parameters.
 */
export function TutorDistributionSvg({
  visualization,
  layout,
  t,
}: {
  visualization: DistributionVisualization
  layout: PlotLayout
  t: UseTranslationResult['t']
}): JSX.Element {
  const { params, interval } = visualization
  const discrete = isDiscrete(params)
  const range = plotRange(params)
  const xMin = discrete ? range.min - 0.5 : range.min
  const xMax = discrete ? range.max + 0.5 : range.max

  const inInterval = (x: number): boolean =>
    Boolean(interval) &&
    (interval?.from === undefined || x >= interval.from) &&
    (interval?.to === undefined || x <= interval.to)

  // Values to draw.
  const bars = discrete
    ? Array.from({ length: range.max - range.min + 1 }, (_, i) => {
        const k = range.min + i
        return { k, p: density(params, k) }
      })
    : []
  const curve = discrete
    ? []
    : Array.from({ length: SAMPLES + 1 }, (_, i) => {
        const x = xMin + ((xMax - xMin) * i) / SAMPLES
        return { x, y: density(params, x) }
      })
  const yPeak = Math.max(...(discrete ? bars.map((b) => b.p) : curve.map((c) => c.y)), 1e-9)
  const yMax = yPeak * 1.12

  const { pad, width, height } = layout
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const sx = (x: number) => pad.left + ((x - xMin) / (xMax - xMin)) * plotW
  const sy = (y: number) => pad.top + (1 - y / yMax) * plotH
  const baseline = sy(0)

  const xStep = discrete
    ? Math.max(1, Math.round(niceTickStep(xMax - xMin, layout.compact ? 5 : 10)))
    : niceTickStep(xMax - xMin, layout.compact ? 4 : 8)
  const xTicks = ticks(discrete ? range.min : xMin, discrete ? range.max : xMax, xStep)
  const yTicks = ticks(0, yMax, niceTickStep(yMax, 4)).filter((v) => v > 0)

  const curvePath = curve
    .map((point, i) => `${i === 0 ? 'M' : 'L'} ${sx(point.x).toFixed(2)} ${sy(point.y).toFixed(2)}`)
    .join(' ')
  const shaded = discrete || !interval
    ? ''
    : (() => {
        const inside = curve.filter((point) => inInterval(point.x))
        if (inside.length < 2) return ''
        const first = inside[0]!
        const last = inside[inside.length - 1]!
        return [
          `M ${sx(first.x).toFixed(2)} ${baseline}`,
          ...inside.map((point) => `L ${sx(point.x).toFixed(2)} ${sy(point.y).toFixed(2)}`),
          `L ${sx(last.x).toFixed(2)} ${baseline}`,
          'Z',
        ].join(' ')
      })()

  const barWidth = Math.max(2, Math.min(28, (plotW / (bars.length || 1)) * 0.7))
  const name = describeParams(params)
  const label = t('viz.distributionAria', { distribution: name })

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="block h-auto w-full max-w-full"
    >
      <title>{label}</title>
      <g aria-hidden="true">
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(v)} y2={sy(v)} stroke={GRID} strokeWidth="1" />
            <text x={pad.left - 6} y={sy(v) + 4} textAnchor="end" fontSize="11" fill={LABEL}>
              {formatNumber(v, 2)}
            </text>
          </g>
        ))}
        <line x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} stroke={AXIS} strokeWidth="1.2" />
        {xTicks.map((v) => (
          <g key={`x-${v}`}>
            <line x1={sx(v)} x2={sx(v)} y1={baseline} y2={baseline + 4} stroke={AXIS} strokeWidth="1" />
            <text x={sx(v)} y={baseline + 17} textAnchor="middle" fontSize="11" fill={LABEL}>
              {formatNumber(v, 3)}
            </text>
          </g>
        ))}

        {discrete &&
          bars.map(({ k, p }) => (
            <rect
              key={k}
              x={sx(k) - barWidth / 2}
              y={sy(p)}
              width={barWidth}
              height={Math.max(0, baseline - sy(p))}
              rx="2"
              fill={!interval || inInterval(k) ? SERIES : SERIES_SOFT}
            />
          ))}

        {!discrete && shaded && <path d={shaded} fill={FILL} stroke="none" />}
        {!discrete && <path d={curvePath} fill="none" stroke={SERIES} strokeWidth="2.2" strokeLinejoin="round" />}
      </g>
    </svg>
  )
}

/** Text facts under the figure (also the accessible summary). */
export function DistributionFacts({
  visualization,
  t,
}: {
  visualization: DistributionVisualization
  t: UseTranslationResult['t']
}): JSX.Element {
  const { params, interval } = visualization
  const { mean, variance } = moments(params)
  const probabilityText = intervalLabel(interval)
  const probability = interval ? intervalProbability(params, interval) : null
  return (
    <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      <span className="font-medium text-foreground">X ~ {describeParams(params)}</span>
      <span>{t('viz.distributionMean', { value: formatNumber(mean) })}</span>
      <span>{t('viz.distributionVariance', { value: formatNumber(variance) })}</span>
      {probabilityText && probability !== null && (
        <span className="font-medium text-foreground">
          {probabilityText} = {formatNumber(probability)}
        </span>
      )}
    </p>
  )
}
