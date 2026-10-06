import { useId } from 'react'
import { chiSquareTest } from '@/entities/tutorVisualization/chiSquare'
import { density, formatNumber } from '@/entities/tutorVisualization/distribution'
import { niceTickStep } from '@/entities/tutorVisualization/linear'
import type { ChiSquareTestVisualization } from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'

type T = UseTranslationResult['t']

const AXIS = 'hsl(var(--viz-axis))'
const LABEL = 'hsl(var(--viz-label))'
const SERIES = 'hsl(var(--viz-series-1))'
const ACCENT = 'hsl(var(--viz-series-2))'
const FILL = 'hsl(var(--viz-series-2) / 0.22)'
const SAMPLES = 240

/** p-values: four significant figures, or "< 0.0001". */
function formatP(p: number): string {
  return p < 1e-4 ? '< 0.0001' : formatNumber(p, 3)
}

/**
 * A χ² goodness-of-fit test: the observed / expected table, and the χ²
 * distribution with the statistic, the critical value and the p-value tail.
 */
export function TutorChiSquareFigure({
  visualization,
  layout,
  t,
}: {
  visualization: ChiSquareTestVisualization
  layout: PlotLayout
  t: T
}): JSX.Element {
  const { categories, df, alpha } = visualization
  const result = chiSquareTest(categories, df, alpha)
  const params = { family: 'chisquare' as const, df }

  const xMax = Math.max(result.critical, result.statistic, df + 4 * Math.sqrt(2 * df)) * 1.15
  const curve = Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const x = (xMax * i) / SAMPLES
    return { x, y: density(params, x) }
  })
  const finite = curve.map((point) => point.y).filter(Number.isFinite)
  const yMax = (df < 2 ? density(params, xMax * 0.04) : Math.max(...finite)) * 1.15
  const width = layout.width
  const height = Math.round(layout.height * 0.7)
  const pad = { ...layout.pad, top: layout.pad.top + 4 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const sx = (x: number) => pad.left + (x / xMax) * plotW
  const sy = (y: number) => pad.top + (1 - Math.min(y, yMax * 4) / yMax) * plotH
  const clipId = `chi-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const baseline = sy(0)
  const path = curve.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`).join(' ')
  const tail = curve.filter((p) => p.x >= result.statistic)
  const tailPath =
    tail.length > 1
      ? [`M ${sx(tail[0]!.x).toFixed(2)} ${baseline}`, ...tail.map((p) => `L ${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`), `L ${sx(tail[tail.length - 1]!.x).toFixed(2)} ${baseline}`, 'Z'].join(' ')
      : ''
  const step = niceTickStep(xMax, layout.compact ? 4 : 8)
  const xTicks: number[] = []
  for (let v = 0; v <= xMax + 1e-9 && xTicks.length < 30; v += step) xTicks.push(Number(v.toPrecision(10)))
  const label = t('viz.chiSquareAria', { statistic: formatNumber(result.statistic, 4), df, p: formatP(result.pValue) })

  return (
    <div className="space-y-3 px-1 py-2">
      <div className="overflow-x-auto">
        <table className="mx-auto border-collapse text-center text-sm" aria-label={t('viz.chiSquareTable')}>
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-1 text-left font-normal">{t('viz.chiSquareCategory')}</th>
              <th scope="col" className="px-2 py-1 font-normal">{t('viz.chiSquareObserved')}</th>
              <th scope="col" className="px-2 py-1 font-normal">{t('viz.chiSquareExpected')}</th>
              <th scope="col" className="px-2 py-1 font-normal">(O − E)² / E</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category, i) => (
              <tr key={`${category.label}-${i}`} className="border-t border-border/70">
                <th scope="row" className="px-2 py-1 text-left font-medium">{category.label}</th>
                <td className="data-num px-2 py-1">{formatNumber(category.observed, 6)}</td>
                <td className={`data-num px-2 py-1 ${category.expected < 5 ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                  {formatNumber(category.expected, 4)}
                </td>
                <td className="data-num px-2 py-1">{formatNumber(result.contributions[i]!, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
        <title>{label}</title>
        <defs>
          <clipPath id={clipId}>
            <rect x={pad.left} y={pad.top} width={plotW} height={plotH + 1} />
          </clipPath>
        </defs>
        <g aria-hidden="true">
          <line x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} stroke={AXIS} strokeWidth="1.2" />
          {xTicks.map((v) => (
            <g key={`x-${v}`}>
              <line x1={sx(v)} x2={sx(v)} y1={baseline} y2={baseline + 4} stroke={AXIS} strokeWidth="1" />
              <text x={sx(v)} y={baseline + 17} textAnchor="middle" fontSize="11" fill={LABEL}>
                {formatNumber(v, 3)}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {tailPath && <path d={tailPath} fill={FILL} stroke="none" />}
            <path d={path} fill="none" stroke={SERIES} strokeWidth="2.2" strokeLinejoin="round" />
          </g>
          <line x1={sx(result.critical)} x2={sx(result.critical)} y1={baseline} y2={pad.top} stroke={LABEL} strokeWidth="1" strokeDasharray="4 4" />
          <text x={sx(result.critical) + 4} y={pad.top + 12} fontSize="11" fill={LABEL}>
            {t('viz.chiSquareCritical', { alpha: formatNumber(alpha, 3), value: formatNumber(result.critical, 4) })}
          </text>
          <line x1={sx(result.statistic)} x2={sx(result.statistic)} y1={baseline} y2={pad.top + 18} stroke={ACCENT} strokeWidth="1.6" />
          <text x={sx(result.statistic) + 4} y={pad.top + 30} fontSize="12" fill={ACCENT}>
            χ² = {formatNumber(result.statistic, 4)}
          </text>
        </g>
      </svg>
      <div className="space-y-1 text-center text-[13px] text-muted-foreground">
        <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1">
          <span className="font-medium text-foreground">χ² = {formatNumber(result.statistic, 4)}</span>
          <span>df = {df}</span>
          <span>p = {formatP(result.pValue)}</span>
          <span>α = {formatNumber(alpha, 3)}</span>
        </p>
        <p className="font-medium text-foreground">
          {result.rejects ? t('viz.chiSquareReject') : t('viz.chiSquareKeep')}
        </p>
        {result.smallExpected && <p className="text-xs text-amber-700 dark:text-amber-400">{t('viz.chiSquareSmall')}</p>}
      </div>
    </div>
  )
}
