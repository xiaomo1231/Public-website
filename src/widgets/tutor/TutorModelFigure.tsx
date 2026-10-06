import { useState, type ReactNode } from 'react'
import { density, formatNumber } from '@/entities/tutorVisualization/distribution'
import {
  apparentConstants,
    concentrationAt,
  confidenceInterval,
  fitArrhenius,
  halfLife,
  kineticsSpan,
  linearFit,
  linearized,
  michaelisMenten,
  populationAt,
  populationFacts,
  populationSpan,
  regressionBands,
  slopePValue,
  GAS_CONSTANT,
} from '@/entities/tutorVisualization/models'
import type {
  ArrheniusVisualization,
  ConfidenceIntervalVisualization,
  EnzymeVisualization,
  KineticsVisualization,
  PopulationVisualization,
  RegressionVisualization,
} from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'
import { ParamSlider, PlotFrame } from './PlotFrame'
import { FOREGROUND, LABEL, SERIES, SERIES_SOFT, linePath, niceRange } from './plotUtils'

type T = UseTranslationResult['t']
const f = formatNumber

function half(layout: PlotLayout): number {
  return Math.round(layout.compact ? layout.width * 0.7 : layout.height * 0.6)
}

function Facts({ children }: { children: ReactNode }): JSX.Element {
  return <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">{children}</p>
}

const range = (min: number, max: number, n = 200) => Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n)

// --- regression -----------------------------------------------------------------

export function TutorRegressionFigure({ visualization, layout, t }: { visualization: RegressionVisualization; layout: PlotLayout; t: T }): JSX.Element | null {
  const { points, level } = visualization
  const [showBands, setShowBands] = useState(true)
  const fit = linearFit(points)
  if (!fit) return null
  const xs = points.map((p) => p.x)
  const xRange = niceRange(xs, [], 0.08)
  const grid = range(xRange[0], xRange[1], 60)
  const bands = grid.map((x) => ({ x, y: fit.intercept + fit.slope * x, ...regressionBands(fit, x, level) }))
  const yRange = niceRange([...points.map((p) => p.y), ...(showBands ? bands.flatMap((b) => [b.y - b.prediction, b.y + b.prediction]) : [])])
  const p = slopePValue(fit)
  const band = (key: 'confidence' | 'prediction', scale: { sx: (x: number) => number; sy: (y: number) => number }) =>
    [
      ...bands.map((b, i) => `${i === 0 ? 'M' : 'L'} ${scale.sx(b.x).toFixed(1)} ${scale.sy(b.y + b[key]).toFixed(1)}`),
      ...[...bands].reverse().map((b) => `L ${scale.sx(b.x).toFixed(1)} ${scale.sy(b.y - b[key]).toFixed(1)}`),
      'Z',
    ].join(' ')
  const label = t('viz.regressionAria', { n: fit.n, slope: f(fit.slope, 4), r2: f(fit.r2, 3) })

  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame
        width={layout.width}
        height={half(layout) + 40}
        xRange={xRange}
        yRange={yRange}
        {...(visualization.xLabel ? { xLabel: visualization.xLabel } : {})}
        {...(visualization.yLabel ? { yLabel: visualization.yLabel } : {})}
        label={label}
        compact={layout.compact}
      >
        {(scale) => (
          <>
            {showBands && fit.n > 2 && <path d={band('prediction', scale)} fill={SERIES_SOFT[2]} stroke="none" />}
            {showBands && fit.n > 2 && <path d={band('confidence', scale)} fill={SERIES_SOFT[0]} stroke="none" />}
            <line x1={scale.sx(xRange[0])} y1={scale.sy(fit.intercept + fit.slope * xRange[0])} x2={scale.sx(xRange[1])} y2={scale.sy(fit.intercept + fit.slope * xRange[1])} stroke={SERIES[0]} strokeWidth="2.2" />
            {points.map((pt, i) => (
              <circle key={i} cx={scale.sx(pt.x)} cy={scale.sy(pt.y)} r="3.6" fill={SERIES[1]} />
            ))}
          </>
        )}
      </PlotFrame>
      <label className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" className="accent-primary" checked={showBands} onChange={(e) => setShowBands(e.target.checked)} />
        {t('viz.regressionBands', { level: f(level * 100, 3) })}
      </label>
      <Facts>
        <span className="font-medium text-foreground">
          ŷ = {f(fit.intercept, 4)} {fit.slope < 0 ? '−' : '+'} {f(Math.abs(fit.slope), 4)}x
        </span>
        <span>r = {f(fit.r, 4)}</span>
        <span>R² = {f(fit.r2, 4)}</span>
        <span>s = {f(fit.residualSe, 4)}</span>
        {p !== null && <span>{t('viz.regressionSlopeTest', { se: f(fit.slopeSe, 3), p: p < 1e-4 ? '< 0.0001' : f(p, 3), df: fit.n - 2 })}</span>}
      </Facts>
    </div>
  )
}

// --- confidence interval ---------------------------------------------------------

export function TutorConfidenceFigure({ visualization, layout, t }: { visualization: ConfidenceIntervalVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { mean, sd, n, sigmaKnown } = visualization
  const [level, setLevel] = useState(visualization.level)
  const ci = confidenceInterval(mean, sd, n, level, sigmaKnown)
  const params = sigmaKnown ? ({ family: 'normal', mu: 0, sigma: 1 } as const) : ({ family: 't', df: n - 1 } as const)
  const reach = Math.max(4, ci.critical * 1.4) * ci.standardError
  const xs = range(mean - reach, mean + reach)
  const curve = xs.map((x) => ({ x, y: density(params, (x - mean) / ci.standardError) / ci.standardError }))
  const yRange: [number, number] = [0, Math.max(...curve.map((p) => p.y)) * 1.15]
  const inside = curve.filter((p) => p.x >= ci.lower && p.x <= ci.upper)
  const label = t('viz.ciAria', { level: f(level * 100, 3), lower: f(ci.lower, 5), upper: f(ci.upper, 5) })

  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame width={layout.width} height={half(layout)} xRange={[mean - reach, mean + reach]} yRange={yRange} xLabel={visualization.label ?? 'x̄'} label={label} compact={layout.compact}>
        {(scale) => (
          <>
            {inside.length > 1 && (
              <path
                d={`M ${scale.sx(inside[0]!.x)} ${scale.sy(0)} ${inside.map((p) => `L ${scale.sx(p.x)} ${scale.sy(p.y)}`).join(' ')} L ${scale.sx(inside[inside.length - 1]!.x)} ${scale.sy(0)} Z`}
                fill={SERIES_SOFT[0]}
              />
            )}
            <path d={linePath(curve, scale, yRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.2" />
            <line x1={scale.sx(mean)} x2={scale.sx(mean)} y1={scale.top} y2={scale.bottom} stroke={FOREGROUND} strokeDasharray="4 4" />
            <line x1={scale.sx(ci.lower)} x2={scale.sx(ci.upper)} y1={scale.bottom - 10} y2={scale.bottom - 10} stroke={SERIES[1]} strokeWidth="4" />
          </>
        )}
      </PlotFrame>
      <div className="rounded-md border border-border/70 px-3 py-2">
        <ParamSlider label={t('viz.ciLevel')} value={level} min={0.5} max={0.999} step={0.001} onChange={setLevel} />
      </div>
      <Facts>
        <span className="font-medium text-foreground">
          {f(level * 100, 3)}% CI: [{f(ci.lower, 5)}, {f(ci.upper, 5)}]
        </span>
        <span>SE = {f(ci.standardError, 4)}</span>
        <span>
          {ci.distribution === 'z' ? 'z' : `t(${n - 1})`}* = {f(ci.critical, 4)}
        </span>
        <span>{t('viz.ciMargin', { value: f(ci.margin, 4) })}</span>
      </Facts>
    </div>
  )
}

// --- reaction kinetics ---------------------------------------------------------------

export function TutorKineticsFigure({ visualization, layout, t }: { visualization: KineticsVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { order, k, a0, timeUnit } = visualization
  const span = kineticsSpan(order, k, a0)
  const times = range(0, span)
  const conc = times.map((time) => ({ x: time, y: concentrationAt(order, k, a0, time) }))
  const lin = conc.filter((p) => p.y > 0).map((p) => ({ x: p.x, y: linearized(order, p.y) }))
  const t12 = halfLife(order, k, a0)
  const species = visualization.species ?? 'A'
  const linLabel = order === 0 ? `[${species}]` : order === 1 ? `ln[${species}]` : `1/[${species}]`
  const height = half(layout)
  const cRange = niceRange(conc.map((p) => p.y), [0])
  const lRange = niceRange(lin.map((p) => p.y))

  return (
    <div className="space-y-1 px-1 py-2">
      <PlotFrame width={layout.width} height={height} xRange={[0, span]} yRange={cRange} xLabel={`t (${timeUnit})`} yLabel={`[${species}]`} label={t('viz.kineticsAria', { order, halfLife: f(t12, 4) })} compact={layout.compact}>
        {(scale) => (
          <>
            <path d={linePath(conc, scale, cRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.2" />
            {[1, 2, 3].map((m) => {
              // Successive half-lives: constant only for first order.
              const time = order === 1 ? m * t12 : order === 0 ? (a0 * (1 - 0.5 ** m)) / k : (2 ** m - 1) / (k * a0)
              if (time > span) return null
              return <line key={m} x1={scale.sx(time)} x2={scale.sx(time)} y1={scale.sy(0)} y2={scale.sy(a0 * 0.5 ** m)} stroke={LABEL} strokeDasharray="3 4" />
            })}
          </>
        )}
      </PlotFrame>
      <PlotFrame width={layout.width} height={Math.round(height * 0.8)} xRange={[0, span]} yRange={lRange} xLabel={`t (${timeUnit})`} yLabel={linLabel} label={t('viz.kineticsLinearAria', { quantity: linLabel })} compact>
        {(scale) => <path d={linePath(lin, scale, lRange)} fill="none" stroke={SERIES[1]} strokeWidth="2.2" />}
      </PlotFrame>
      <Facts>
        <span className="font-medium text-foreground">{t('viz.kineticsOrder', { order })}</span>
        <span>k = {f(k, 4)}</span>
        <span>
          t<sub>1/2</sub> = {f(t12, 4)} {timeUnit}
        </span>
        <span>{t(order === 0 ? 'viz.kineticsSlope0' : order === 1 ? 'viz.kineticsSlope1' : 'viz.kineticsSlope2', { k: f(k, 4) })}</span>
      </Facts>
    </div>
  )
}

// --- Arrhenius -------------------------------------------------------------------------

export function TutorArrheniusFigure({ visualization, layout, t }: { visualization: ArrheniusVisualization; layout: PlotLayout; t: T }): JSX.Element | null {
  const fitted = visualization.points ? fitArrhenius(visualization.points) : null
  const ea = fitted?.ea ?? visualization.ea
  const a = fitted?.a ?? visualization.a
  if (ea === undefined || a === undefined) return null
  const temps = visualization.points?.map((p) => p.t) ?? [273, 373]
  const tMin = Math.min(...temps) * 0.95
  const tMax = Math.max(...temps) * 1.05
  const invRange = niceRange([1 / tMin, 1 / tMax], [], 0.05)
  const line = range(invRange[0], invRange[1], 40).map((inv) => ({ x: inv * 1000, y: Math.log(a) - ea / (GAS_CONSTANT / inv) }))
  const data = (visualization.points ?? []).map((p) => ({ x: 1000 / p.t, y: Math.log(p.k) }))
  const yRange = niceRange([...line.map((p) => p.y), ...data.map((p) => p.y)])
  const xRange: [number, number] = [invRange[0] * 1000, invRange[1] * 1000]

  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame width={layout.width} height={half(layout) + 30} xRange={xRange} yRange={yRange} xLabel="1000 / T (K⁻¹)" yLabel="ln k" label={t('viz.arrheniusAria', { ea: f(ea / 1000, 4) })} compact={layout.compact}>
        {(scale) => (
          <>
            <path d={linePath(line, scale, yRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.2" />
            {data.map((p, i) => (
              <circle key={i} cx={scale.sx(p.x)} cy={scale.sy(p.y)} r="4" fill={SERIES[1]} />
            ))}
          </>
        )}
      </PlotFrame>
      <Facts>
        <span className="font-medium text-foreground">
          E<sub>a</sub> = {f(ea / 1000, 4)} kJ/mol
        </span>
        <span>A = {f(a, 4)}</span>
        <span>{t('viz.arrheniusSlope', { slope: f(-ea / GAS_CONSTANT, 4) })}</span>
        {fitted?.r2 !== undefined && <span>R² = {f(fitted.r2, 4)}</span>}
      </Facts>
    </div>
  )
}

const INHIBITION_KEYS = {
  competitive: 'viz.inhibitionCompetitive',
  noncompetitive: 'viz.inhibitionNoncompetitive',
  uncompetitive: 'viz.inhibitionUncompetitive',
  mixed: 'viz.inhibitionMixed',
} as const

// --- enzyme kinetics ---------------------------------------------------------------------

export function TutorEnzymeFigure({ visualization, layout, t }: { visualization: EnzymeVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { vmax, km, inhibitor } = visualization
  const apparent = apparentConstants(vmax, km, inhibitor)
  const sMax = Math.max(km, apparent.km) * 8
  const s = range(0, sMax)
  const base = s.map((x) => ({ x, y: michaelisMenten(vmax, km, x) }))
  const inhibited = inhibitor ? s.map((x) => ({ x, y: michaelisMenten(apparent.vmax, apparent.km, x) })) : []
  const height = half(layout)
  const vRange: [number, number] = [0, vmax * 1.12]
  // Lineweaver–Burk: 1/v = (Km/Vmax)(1/[S]) + 1/Vmax.
  const invMax = 2 / Math.min(km, apparent.km)
  const invMin = -1.3 / Math.min(km, apparent.km)
  const lb = (vm: number, k: number) => range(invMin, invMax, 2).map((x) => ({ x, y: (k / vm) * x + 1 / vm }))
  const lbLines = [lb(vmax, km), ...(inhibitor ? [lb(apparent.vmax, apparent.km)] : [])]
  const lbRange = niceRange(lbLines.flat().map((p) => p.y), [0])
  const sUnit = visualization.substrateUnit ?? ''
  const vUnit = visualization.rateUnit ?? ''

  return (
    <div className="space-y-1 px-1 py-2">
      <PlotFrame width={layout.width} height={height} xRange={[0, sMax]} yRange={vRange} xLabel={`[S]${sUnit ? ` (${sUnit})` : ''}`} yLabel="v₀" label={t('viz.enzymeAria', { vmax: f(vmax, 4), km: f(km, 4) })} compact={layout.compact}>
        {(scale) => (
          <>
            <line x1={scale.left} x2={scale.right} y1={scale.sy(vmax)} y2={scale.sy(vmax)} stroke={LABEL} strokeDasharray="5 4" />
            <line x1={scale.sx(km)} x2={scale.sx(km)} y1={scale.sy(0)} y2={scale.sy(vmax / 2)} stroke={LABEL} strokeDasharray="3 4" />
            <path d={linePath(base, scale, vRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.2" />
            {inhibitor && <path d={linePath(inhibited, scale, vRange)} fill="none" stroke={SERIES[1]} strokeWidth="2.2" strokeDasharray="7 4" />}
          </>
        )}
      </PlotFrame>
      <PlotFrame width={layout.width} height={Math.round(height * 0.85)} xRange={[invMin, invMax]} yRange={lbRange} xLabel="1/[S]" yLabel="1/v₀" label={t('viz.enzymeLbAria')} compact>
        {(scale) => (
          <>
            {lbLines.map((points, i) => (
              <path key={i} d={linePath(points, scale, lbRange)} fill="none" stroke={SERIES[i]} strokeWidth="2" strokeDasharray={i ? '7 4' : undefined} />
            ))}
          </>
        )}
      </PlotFrame>
      <Facts>
        <span className="font-medium text-foreground">
          V<sub>max</sub> = {f(vmax, 4)} {vUnit}, K<sub>m</sub> = {f(km, 4)} {sUnit}
        </span>
        {inhibitor && (
          <>
            <span>{t(INHIBITION_KEYS[inhibitor.type])}</span>
            <span className="text-foreground">
              V<sub>max</sub><sup>app</sup> = {f(apparent.vmax, 4)}, K<sub>m</sub><sup>app</sup> = {f(apparent.km, 4)}
            </span>
          </>
        )}
        <span>{t('viz.enzymeIntercepts')}</span>
      </Facts>
    </div>
  )
}

// --- population growth ---------------------------------------------------------------

export function TutorPopulationFigure({ visualization, layout, t }: { visualization: PopulationVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { model, n0, r, k } = visualization
  const span = populationSpan(model, n0, r, k)
  const curve = range(0, span).map((time) => ({ x: time, y: populationAt(model, n0, r, time, k) }))
  const facts = populationFacts(model, n0, r, k)
  const unit = visualization.timeUnit ?? 't'
  const height = half(layout)
  const nRange = niceRange(curve.map((p) => p.y), [0, ...(k ? [k] : [])])
  const rate = model === 'logistic' && k ? range(0, k, 100).map((N) => ({ x: N, y: r * N * (1 - N / k) })) : []
  const rateRange = rate.length ? niceRange(rate.map((p) => p.y), [0]) : ([0, 1] as [number, number])

  return (
    <div className="space-y-1 px-1 py-2">
      <PlotFrame width={layout.width} height={height} xRange={[0, span]} yRange={nRange} xLabel={unit} yLabel="N" label={t('viz.populationAria', { model: t(model === 'logistic' ? 'viz.populationLogistic' : 'viz.populationExponential') })} compact={layout.compact}>
        {(scale) => (
          <>
            {k && <line x1={scale.left} x2={scale.right} y1={scale.sy(k)} y2={scale.sy(k)} stroke={LABEL} strokeDasharray="5 4" />}
            {facts.inflectionTime !== undefined && (
              <circle cx={scale.sx(facts.inflectionTime)} cy={scale.sy(k! / 2)} r="4.5" fill={SERIES[1]} />
            )}
            <path d={linePath(curve, scale, nRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.2" />
          </>
        )}
      </PlotFrame>
      {rate.length > 0 && (
        <PlotFrame width={layout.width} height={Math.round(height * 0.75)} xRange={[0, k!]} yRange={rateRange} xLabel="N" yLabel="dN/dt" label={t('viz.populationRateAria')} compact>
          {(scale) => <path d={linePath(rate, scale, rateRange)} fill="none" stroke={SERIES[1]} strokeWidth="2.2" />}
        </PlotFrame>
      )}
      <Facts>
        <span className="font-medium text-foreground">{model === 'logistic' ? 'dN/dt = rN(1 − N/K)' : 'dN/dt = rN'}</span>
        <span>
          N₀ = {f(n0, 4)}, r = {f(r, 4)}
          {k ? `, K = ${f(k, 4)}` : ''}
        </span>
        {model === 'exponential' && <span>{t('viz.populationDoubling', { value: f(facts.doublingTime, 4) })}</span>}
        {facts.inflectionTime !== undefined && <span>{t('viz.populationInflection', { time: f(facts.inflectionTime, 4), n: f(k! / 2, 4) })}</span>}
        {facts.maxGrowthRate !== undefined && <span>{t('viz.populationMaxRate', { value: f(facts.maxGrowthRate, 4) })}</span>}
      </Facts>
    </div>
  )
}
