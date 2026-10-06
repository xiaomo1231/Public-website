import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { formatNumber } from '@/entities/tutorVisualization/distribution'
import {
  derivativeOf,
  evaluatePolynomial,
  integrate,
  numericDerivative,
  parseFormula,
  polynomialText,
  riemannSum,
  sampleFormula,
  taylorCoefficients,
  type ParsedFormula,
  type RiemannMethod,
} from '@/entities/tutorVisualization/formula'
import type {
  FormulaVisualization,
  RiemannVisualization,
  TangentVisualization,
  TaylorVisualization,
} from '@/entities/tutorVisualization/types'
import { Math as TeX } from '@/shared/ui/Math'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'
import { ParamSlider, PlotFrame } from './PlotFrame'
import { FOREGROUND, LABEL, SERIES, SERIES_SOFT, linePath, niceRange } from './plotUtils'

type T = UseTranslationResult['t']

/** LaTeX for a parsed formula (mathjs renders its own tree), or the plain source. */
function texOf(formula: Pick<ParsedFormula, 'node' | 'source'> | null): string {
  if (!formula) return ''
  try {
    return formula.node.toTex({ parenthesis: 'auto', implicit: 'hide' })
  } catch {
    return formula.source
  }
}

/** A top-level sum or difference needs brackets inside an integral. */
function isSum(formula: ParsedFormula): boolean {
  const node = formula.node as unknown as { type: string; op?: string; args?: unknown[] }
  return node.type === 'OperatorNode' && (node.op === '+' || node.op === '-') && (node.args?.length ?? 0) === 2
}

function plotHeight(layout: PlotLayout): number {
  return Math.round(layout.compact ? layout.width * 0.85 : layout.height * 0.82)
}

// --- formula explorer ----------------------------------------------------------

export function TutorFormulaFigure({ visualization, layout, t }: { visualization: FormulaVisualization; layout: PlotLayout; t: T }): JSX.Element | null {
  const { variable, params, domain } = visualization
  const initial = useMemo(() => Object.fromEntries(params.map((p) => [p.name, p.value])), [params])
  const [values, setValues] = useState<Record<string, number>>(initial)
  const formulas = useMemo(
    () => visualization.curves.map((curve) => parseFormula(curve.expression, [variable, ...params.map((p) => p.name)])),
    [visualization.curves, variable, params],
  )
  const changed = params.some((p) => values[p.name] !== initial[p.name])
  const current = formulas.map((f) => (f ? sampleFormula(f.evaluate, variable, values, domain.min, domain.max) : []))
  const reference = useMemo(
    () => formulas.map((f) => (f ? sampleFormula(f.evaluate, variable, initial, domain.min, domain.max) : [])),
    [formulas, variable, initial, domain],
  )
  if (formulas.some((f) => !f)) return null
  const yRange = niceRange([...current.flat(), ...reference.flat()].map((p) => p.y), [0])
  const height = plotHeight(layout)
  const label = t('viz.formulaAria', { formula: visualization.curves.map((c) => c.expression).join('; ') })

  return (
    <div className="space-y-2 px-1 py-2">
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm">
        {formulas.map((formula, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            {formulas.length > 1 && <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: SERIES[i % 4] }} />}
            {visualization.curves[i]!.label && <span className="text-muted-foreground">{visualization.curves[i]!.label}:</span>}
            <TeX latex={texOf(formula)} />
          </span>
        ))}
      </div>
      <PlotFrame
        width={layout.width}
        height={height}
        xRange={[domain.min, domain.max]}
        yRange={yRange}
        xLabel={visualization.xLabel ?? variable}
        {...(visualization.yLabel ? { yLabel: visualization.yLabel } : {})}
        label={label}
        compact={layout.compact}
      >
        {(scale) => (
          <>
            {changed &&
              reference.map((points, i) => (
                <path key={`ref${i}`} d={linePath(points, scale, yRange)} fill="none" stroke={LABEL} strokeWidth="1.4" strokeDasharray="5 4" />
              ))}
            {current.map((points, i) => (
              <path key={`cur${i}`} d={linePath(points, scale, yRange)} fill="none" stroke={SERIES[i % 4]} strokeWidth="2.4" strokeLinejoin="round" />
            ))}
          </>
        )}
      </PlotFrame>
      {params.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-border/70 px-3 py-2">
          {params.map((param) => (
            <ParamSlider
              key={param.name}
              label={param.label ? `${param.label} (${param.name})` : param.name}
              value={values[param.name]!}
              min={param.min}
              max={param.max}
              step={param.step}
              {...(param.unit ? { unit: param.unit } : {})}
              onChange={(value) => setValues((prev) => ({ ...prev, [param.name]: value }))}
            />
          ))}
          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <span>{changed ? t('viz.formulaReference') : t('viz.formulaHint')}</span>
            <button
              type="button"
              onClick={() => setValues(initial)}
              disabled={!changed}
              className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t('viz.formulaReset')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// --- tangent ------------------------------------------------------------------

export function TutorTangentFigure({ visualization, layout, t }: { visualization: TangentVisualization; layout: PlotLayout; t: T }): JSX.Element | null {
  const { variable, domain } = visualization
  const span = domain.max - domain.min
  const [x0, setX0] = useState(visualization.point)
  const [h, setH] = useState(span / 4)
  const formula = useMemo(() => parseFormula(visualization.expression, [variable]), [visualization.expression, variable])
  const derivative = useMemo(() => (formula ? derivativeOf(formula, variable) : null), [formula, variable])
  const curve = useMemo(() => (formula ? sampleFormula(formula.evaluate, variable, {}, domain.min, domain.max) : []), [formula, variable, domain])
  if (!formula) return null
  const f = (x: number) => formula.evaluate({ [variable]: x })
  const symbolic = derivative ? derivative.evaluate({ [variable]: x0 }) : NaN
  const slope = Number.isFinite(symbolic) ? symbolic : numericDerivative(formula.evaluate, { [variable]: x0 }, variable)
  const y0 = f(x0)
  const secantSlope = (f(x0 + h) - y0) / h
  const yRange = niceRange(curve.map((p) => p.y))
  const label = t('viz.tangentAria', { point: formatNumber(x0, 3), slope: formatNumber(slope, 4) })

  return (
    <div className="space-y-2 px-1 py-2">
      <p className="text-center text-sm">
        <TeX latex={`f(${variable}) = ${texOf(formula)}`} />
        {derivative && (
          <span className="ml-3">
            <TeX latex={`f'(${variable}) = ${texOf({ node: derivative.node, source: '' })}`} />
          </span>
        )}
      </p>
      <PlotFrame width={layout.width} height={plotHeight(layout)} xRange={[domain.min, domain.max]} yRange={yRange} xLabel={variable} label={label} compact={layout.compact}>
        {(scale) => (
          <>
            <path d={linePath(curve, scale, yRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.4" />
            <line x1={scale.sx(domain.min)} y1={scale.sy(y0 + slope * (domain.min - x0))} x2={scale.sx(domain.max)} y2={scale.sy(y0 + slope * (domain.max - x0))} stroke={SERIES[1]} strokeWidth="1.8" />
            {visualization.showSecant && Number.isFinite(secantSlope) && (
              <>
                <line x1={scale.sx(domain.min)} y1={scale.sy(y0 + secantSlope * (domain.min - x0))} x2={scale.sx(domain.max)} y2={scale.sy(y0 + secantSlope * (domain.max - x0))} stroke={SERIES[2]} strokeWidth="1.4" strokeDasharray="6 4" />
                <circle cx={scale.sx(x0 + h)} cy={scale.sy(f(x0 + h))} r="4" fill={SERIES[2]} />
              </>
            )}
            <circle cx={scale.sx(x0)} cy={scale.sy(y0)} r="5" fill={SERIES[1]} />
          </>
        )}
      </PlotFrame>
      <div className="space-y-1.5 rounded-md border border-border/70 px-3 py-2">
        <ParamSlider label={t('viz.tangentPoint', { variable })} value={x0} min={domain.min} max={domain.max} step={span / 200} onChange={setX0} />
        {visualization.showSecant && <ParamSlider label="h" value={h} min={span / 200} max={span / 2} step={span / 400} onChange={setH} />}
      </div>
      <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{t('viz.tangentSlope', { point: formatNumber(x0, 4), slope: formatNumber(slope, 5) })}</span>
        <span>
          {t('viz.tangentLine', {
            line: `y = ${formatNumber(slope, 4)}(${variable} ${x0 < 0 ? '+' : '−'} ${formatNumber(Math.abs(x0), 4)}) ${y0 < 0 ? '−' : '+'} ${formatNumber(Math.abs(y0), 4)}`,
          })}
        </span>
        {visualization.showSecant && <span>{t('viz.secantSlope', { h: formatNumber(h, 3), slope: formatNumber(secantSlope, 5) })}</span>}
      </p>
    </div>
  )
}

// --- Riemann sums ------------------------------------------------------------------

const METHODS: RiemannMethod[] = ['left', 'right', 'midpoint', 'trapezoid']
const METHOD_KEYS = {
  left: 'viz.riemannLeft',
  right: 'viz.riemannRight',
  midpoint: 'viz.riemannMidpoint',
  trapezoid: 'viz.riemannTrapezoid',
} as const

export function TutorRiemannFigure({ visualization, layout, t }: { visualization: RiemannVisualization; layout: PlotLayout; t: T }): JSX.Element | null {
  const { variable, a, b } = visualization
  const [n, setN] = useState(visualization.n)
  const [method, setMethod] = useState<RiemannMethod>(visualization.method)
  const formula = useMemo(() => parseFormula(visualization.expression, [variable]), [visualization.expression, variable])
  if (!formula) return null
  const f = (x: number) => formula.evaluate({ [variable]: x })
  const pad = (b - a) * 0.1
  const curve = sampleFormula(formula.evaluate, variable, {}, a - pad, b + pad)
  const { sum, pieces } = riemannSum(f, a, b, n, method)
  const exact = integrate(f, a, b)
  const yRange = niceRange(curve.map((p) => p.y), [0])
  const label = t('viz.riemannAria', { n, sum: formatNumber(sum, 5), integral: formatNumber(exact, 5) })

  return (
    <div className="space-y-2 px-1 py-2">
      <p className="text-center text-sm">
        <TeX latex={`\\int_{${formatNumber(a, 4)}}^{${formatNumber(b, 4)}} ${isSum(formula) ? `\\left(${texOf(formula)}\\right)` : texOf(formula)}\\,d${variable}`} />
      </p>
      <PlotFrame width={layout.width} height={plotHeight(layout)} xRange={[a - pad, b + pad]} yRange={yRange} xLabel={variable} label={label} compact={layout.compact}>
        {(scale) => (
          <>
            {pieces.map((piece, i) => {
              const base = scale.sy(0)
              if (method === 'trapezoid') {
                return (
                  <path
                    key={i}
                    d={`M ${scale.sx(piece.x0)} ${base} L ${scale.sx(piece.x0)} ${scale.sy(piece.left)} L ${scale.sx(piece.x1)} ${scale.sy(piece.right)} L ${scale.sx(piece.x1)} ${base} Z`}
                    fill={SERIES_SOFT[0]}
                    stroke={SERIES[0]}
                    strokeWidth="0.8"
                  />
                )
              }
              const top = scale.sy(piece.height)
              return (
                <rect
                  key={i}
                  x={scale.sx(piece.x0)}
                  y={Math.min(top, base)}
                  width={Math.max(0, scale.sx(piece.x1) - scale.sx(piece.x0))}
                  height={Math.abs(base - top)}
                  fill={piece.height >= 0 ? SERIES_SOFT[0] : SERIES_SOFT[1]}
                  stroke={piece.height >= 0 ? SERIES[0] : SERIES[1]}
                  strokeWidth="0.8"
                />
              )
            })}
            <path d={linePath(curve, scale, yRange)} fill="none" stroke={FOREGROUND} strokeWidth="2.2" />
          </>
        )}
      </PlotFrame>
      <div className="space-y-2 rounded-md border border-border/70 px-3 py-2">
        <ParamSlider label={t('viz.riemannN')} value={n} min={1} max={200} step={1} onChange={(value) => setN(Math.round(value))} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('viz.riemannMethod')}>
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              onClick={() => setMethod(m)}
              className={`focus-ring rounded-md border px-2 py-1 text-xs ${method === m ? 'border-primary bg-primary/10 text-foreground' : 'border-border/80 text-muted-foreground hover:bg-accent'}`}
            >
              {t(METHOD_KEYS[m])}
            </button>
          ))}
        </div>
      </div>
      <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{t('viz.riemannSum', { n, sum: formatNumber(sum, 6) })}</span>
        <span>{t('viz.riemannIntegral', { value: formatNumber(exact, 6) })}</span>
        <span>{t('viz.riemannError', { value: formatNumber(sum - exact, 3) })}</span>
      </p>
    </div>
  )
}

// --- Taylor polynomials ----------------------------------------------------------

export function TutorTaylorFigure({ visualization, layout, t }: { visualization: TaylorVisualization; layout: PlotLayout; t: T }): JSX.Element | null {
  const { variable, center, domain } = visualization
  const [order, setOrder] = useState(visualization.order)
  const formula = useMemo(() => parseFormula(visualization.expression, [variable]), [visualization.expression, variable])
  const coefficients = useMemo(() => (formula ? taylorCoefficients(formula, variable, center, 10) : null), [formula, variable, center])
  const curve = useMemo(() => (formula ? sampleFormula(formula.evaluate, variable, {}, domain.min, domain.max) : []), [formula, variable, domain])
  if (!formula || !coefficients) return null
  const used = coefficients.slice(0, order + 1)
  const poly = curve.map((p) => ({ x: p.x, y: evaluatePolynomial(used, center, p.x) }))
  const yRange = niceRange(curve.map((p) => p.y))
  const edge = (domain.max - center) / 2 + center
  const error = Math.abs(formula.evaluate({ [variable]: edge }) - evaluatePolynomial(used, center, edge))
  const label = t('viz.taylorAria', { order, center: formatNumber(center, 3) })

  return (
    <div className="space-y-2 px-1 py-2">
      <p className="text-center text-sm">
        <TeX latex={`f(${variable}) = ${texOf(formula)}`} />
      </p>
      <PlotFrame width={layout.width} height={plotHeight(layout)} xRange={[domain.min, domain.max]} yRange={yRange} xLabel={variable} label={label} compact={layout.compact}>
        {(scale) => (
          <>
            <path d={linePath(curve, scale, yRange)} fill="none" stroke={FOREGROUND} strokeWidth="2.2" />
            <path d={linePath(poly, scale, yRange)} fill="none" stroke={SERIES[1]} strokeWidth="2.2" strokeDasharray="7 4" />
            <circle cx={scale.sx(center)} cy={scale.sy(coefficients[0]!)} r="4.5" fill={SERIES[1]} />
          </>
        )}
      </PlotFrame>
      <div className="rounded-md border border-border/70 px-3 py-2">
        <ParamSlider label={t('viz.taylorOrder')} value={order} min={0} max={10} step={1} onChange={(value) => setOrder(Math.round(value))} />
      </div>
      <p className="data-num break-words text-center text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">
          P<sub>{order}</sub>({variable}) = {polynomialText(used, center, variable, (v) => formatNumber(v, 4))}
        </span>
        <span className="ml-3">{t('viz.taylorError', { x: formatNumber(edge, 3), value: formatNumber(error, 3) })}</span>
      </p>
    </div>
  )
}
