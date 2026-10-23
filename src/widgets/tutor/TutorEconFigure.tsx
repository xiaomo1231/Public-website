import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ChevronLeft, ChevronRight, Play, RotateCcw } from 'lucide-react'
import {
  exploreMarket,
  formatCurveEquation,
  formatMarketNumber,
  policyAxis,
  policyValue,
  scaleScenario,
  solveMarket,
  type MarketArea,
  type MarketCurve,
  type MarketExploration,
  type MarketNumber,
  type MarketSolution,
} from '@/entities/econ/market'
import { niceTickStep } from '@/entities/tutorVisualization/linear'
import type { MarketPanel, MarketVisualization } from '@/entities/tutorVisualization/types'
import type { TranslationKey, UseTranslationResult } from '@/i18n'
import { prefersReducedMotion } from '@/shared/lib/motion'
import { capturePointer, releasePointer } from '@/shared/lib/pointerGesture'
import type { PlotLayout } from './plotLayout'
import { PlotFrame } from './PlotFrame'
import {
  CurvePath,
  ShiftArrows,
  PolicyLine,
  EquilibriumMark,
  OutcomeMarks,
  CurveLabels,
} from '@/widgets/econ/marketPlot'
import {
  PAD,
  AREA_FILL,
  EFFECT_FILL,
  DEMAND,
  SUPPLY,
  POLICY,
  marketRanges,
  signed,
  type Formatters,
  formatters,
  curveD,
  policyLineOf,
  policyD,
} from '@/widgets/econ/marketPlotUtils'

type T = UseTranslationResult['t']

/** Reveal steps: axes → original curves & equilibrium → change → new outcome → areas. */
export const MARKET_STEPS = 5
const PLAY_MS = 1400

type Target = 'demand' | 'supply' | 'policy'
type AreaMode = 'surplus' | 'cs' | 'ps'

/** Plain-language summary of a solved market (screen readers, the SVG label). */
function describeMarket(solution: MarketSolution, t: T, fmt: Formatters): string {
  const parts = [
    t('viz.market.srCurves', {
      demand: formatCurveEquation(solution.demand),
      supply: formatCurveEquation(solution.supply),
    }),
    t('viz.market.srEquilibrium', {
      q: fmt.quantity(solution.original.q),
      p: fmt.price(solution.original.p),
    }),
  ]
  if (solution.scenario !== 'equilibrium') {
    if (!solution.binding) parts.push(t('viz.market.nonBinding'))
    else
      parts.push(
        t('viz.market.srOutcome', {
          q: fmt.quantity(solution.outcome.q),
          p: fmt.price(solution.outcome.p),
          dp: signed(formatMarketNumber(solution.deltaP)),
          dq: signed(formatMarketNumber(solution.deltaQ)),
        }),
      )
  }
  if (solution.buyerPrice && solution.sellerPrice)
    parts.push(
      t('viz.market.srPrices', {
        pb: fmt.price(solution.buyerPrice),
        ps: fmt.price(solution.sellerPrice),
      }),
    )
  if (solution.gap && solution.binding) {
    const amount = Math.abs(solution.gap.q1 - solution.gap.q0)
    const gapAmount = solution.control?.gap ?? solution.trade?.volume
    parts.push(
      t('viz.market.srGap', {
        kind: t(`viz.market.gap.${solution.gap.kind}` as TranslationKey),
        amount: gapAmount ? fmt.quantity(gapAmount) : String(amount),
        price: fmt.price(solution.control?.price ?? solution.trade!.domesticPrice),
      }),
    )
  }
  parts.push(
    t('viz.market.srAreas', {
      cs: solution.after.cs ? fmt.money(solution.after.cs) : t('viz.market.unbounded'),
      ps: fmt.money(solution.after.ps),
      dwl: solution.deadweightLoss ? fmt.money(solution.deadweightLoss) : '—',
    }),
  )
  return parts.join(' ')
}

/** The regions to shade for the chosen mode. */
function visibleAreas(solution: MarketSolution, mode: AreaMode): MarketArea[] {
  if (mode !== 'surplus') {
    const changes = solution.areas.filter((a) => a.effect && a.kind === mode)
    if (changes.length > 0) return changes
  }
  const after = solution.areas.filter(
    (a) => a.phase === 'after' && !a.effect && a.kind !== 'total_revenue',
  )
  if (after.length > 0) return after
  return solution.areas.filter((a) => a.phase === 'before' && a.kind !== 'total_revenue')
}

// --- figure -----------------------------------------------------------------------

export function TutorMarketFigure({
  visualization,
  layout,
  t,
}: {
  visualization: MarketVisualization
  layout: PlotLayout
  t: T
}): JSX.Element {
  const [step, setStep] = useState(MARKET_STEPS - 1)
  const [progress, setProgress] = useState(1)
  const frame = useRef<number | null>(null)
  const twin = visualization.panels.length > 1
  const sideBySide = twin && !layout.compact
  const width = sideBySide ? Math.round(layout.width / 2) : layout.width
  const height = Math.round(
    sideBySide ? width * 0.95 : layout.compact ? layout.width * 0.85 : layout.height * 0.82,
  )
  const hasChange = visualization.panels.some((p) => p.spec.scenario.kind !== 'equilibrium')

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const play = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    setStep(MARKET_STEPS - 1)
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setProgress(1)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const x = Math.min(1, (now - start) / PLAY_MS)
      // Ease out, matching the app's motion tokens.
      setProgress(Number((1 - (1 - x) ** 3).toFixed(3)))
      frame.current = x < 1 ? requestAnimationFrame(tick) : null
    }
    setProgress(0)
    frame.current = requestAnimationFrame(tick)
  }

  const stepName = t(`viz.market.step.${step}` as TranslationKey)

  return (
    <div className="min-w-0 space-y-3 px-1 py-2" data-market-figure>
      <div className={sideBySide ? 'grid grid-cols-2 gap-2' : 'space-y-4'}>
        {visualization.panels.map((panel, index) => (
          <MarketPanelView
            key={index}
            panel={panel}
            visualization={visualization}
            width={width}
            height={height}
            compact={layout.compact || sideBySide}
            step={step}
            progress={progress}
            t={t}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-[13px]">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          aria-label={t('viz.market.prevStep')}
          title={t('viz.market.prevStep')}
          className="focus-ring grid h-11 w-11 place-items-center rounded-md border border-border/80 transition-colors hover:bg-accent disabled:opacity-40 sm:h-8 sm:w-8"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-[12rem] text-center text-muted-foreground" aria-live="polite">
          {t('viz.market.stepLabel', { n: step + 1, total: MARKET_STEPS, name: stepName })}
        </span>
        <button
          type="button"
          onClick={() => setStep((s) => Math.min(MARKET_STEPS - 1, s + 1))}
          disabled={step === MARKET_STEPS - 1}
          aria-label={t('viz.market.nextStep')}
          title={t('viz.market.nextStep')}
          className="focus-ring grid h-11 w-11 place-items-center rounded-md border border-border/80 transition-colors hover:bg-accent disabled:opacity-40 sm:h-8 sm:w-8"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {hasChange && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-[13px]">
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-muted-foreground">{t('viz.market.progress')}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={progress}
              onChange={(event) => {
                if (frame.current !== null) cancelAnimationFrame(frame.current)
                frame.current = null
                setProgress(Number(event.target.value))
              }}
              className="focus-ring h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
            />
            <span className="data-num w-10 shrink-0 text-right">{Math.round(progress * 100)}%</span>
          </label>
          <button
            type="button"
            onClick={play}
            className="focus-ring inline-flex h-11 items-center gap-1.5 rounded-md border border-border/80 px-2.5 hover:bg-accent sm:h-8"
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {t('viz.market.play')}
          </button>
        </div>
      )}
      <p className="px-1 text-xs text-muted-foreground">{t('viz.market.exploreHint')}</p>
    </div>
  )
}

function MarketPanelView({
  panel,
  visualization,
  width,
  height,
  compact,
  step,
  progress,
  t,
}: {
  panel: MarketPanel
  visualization: MarketVisualization
  width: number
  height: number
  compact: boolean
  step: number
  progress: number
  t: T
}): JSX.Element | null {
  const full = useMemo(() => solveMarket(panel.spec), [panel.spec])
  const [explore, setExplore] = useState<MarketExploration>({})
  const axis = policyAxis(panel.spec.scenario)
  const [selected, setSelected] = useState<Target>(axis ? 'policy' : 'demand')
  const [mode, setMode] = useState<AreaMode>('surplus')
  const drag = useRef<{
    target: Target
    start: { q: number; p: number }
    explore: MarketExploration
  } | null>(null)

  const scaled = useMemo(() => scaleScenario(panel.spec, progress), [panel.spec, progress])
  const current = useMemo(() => {
    const explored = solveMarket(exploreMarket(scaled, explore))
    if (explored.ok) return { spec: exploreMarket(scaled, explore), solution: explored.solution }
    const plain = solveMarket(scaled)
    return plain.ok ? { spec: scaled, solution: plain.solution } : null
  }, [scaled, explore])

  if (!full.ok || !current) return null
  const ranges = marketRanges(full.solution)
  const solution = current.solution
  const fmt = formatters(visualization)
  const summary = describeMarket(solution, t, fmt)
  const explored = Object.keys(explore).length > 0
  const hasChanges = solution.areas.some((a) => a.effect)

  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const toData = (event: ReactPointerEvent<SVGElement>) => {
    const svg = (event.currentTarget as SVGElement).ownerSVGElement
    const rect = svg?.getBoundingClientRect()
    const k = rect && rect.width > 0 ? width / rect.width : 1
    const x = (event.clientX - (rect?.left ?? 0)) * k
    const y = (event.clientY - (rect?.top ?? 0)) * k
    return {
      q: ((x - PAD.left) / plotW) * ranges.q,
      p: (1 - (y - PAD.top) / plotH) * ranges.p,
    }
  }

  /** The curve a target moves: the new one when the scenario shifts that side. */
  const movedCurve = (target: 'demand' | 'supply'): MarketCurve =>
    target === 'demand'
      ? (solution.newDemand ?? solution.demand)
      : (solution.newSupply ?? solution.supply)

  /** Apply a move in data units; ignored when the market would stop making sense. */
  const apply = (target: Target, base: MarketExploration, dq: number, dp: number) => {
    let next: MarketExploration
    if (target === 'policy') {
      const start = base.policy ?? policyValue(current.spec.scenario) ?? 0
      next = { ...base, policy: Math.max(0, start + (axis === 'quantity' ? dq : dp)) }
    } else {
      const previous = base[target] ?? {}
      const vertical = movedCurve(target).kind === 'vertical'
      next = {
        ...base,
        [target]: vertical
          ? { ...previous, dq: (previous.dq ?? 0) + dq }
          : { ...previous, dp: (previous.dp ?? 0) + dp },
      }
    }
    if (solveMarket(exploreMarket(scaled, next)).ok) setExplore(next)
  }

  const onPointerDown = (target: Target) => (event: ReactPointerEvent<SVGElement>) => {
    event.preventDefault()
    setSelected(target)
    capturePointer(event.currentTarget, event.pointerId)
    drag.current = { target, start: toData(event), explore }
  }
  const onPointerMove = (event: ReactPointerEvent<SVGElement>) => {
    const state = drag.current
    if (!state) return
    const now = toData(event)
    apply(state.target, state.explore, now.q - state.start.q, now.p - state.start.p)
  }
  const onPointerUp = (event: ReactPointerEvent<SVGElement>) => {
    releasePointer(event.currentTarget, event.pointerId)
    drag.current = null
  }
  const dragProps = (target: Target) => ({
    'data-drag': target,
    onPointerDown: onPointerDown(target),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    style: { touchAction: 'none' as const, cursor: 'grab' },
    stroke: 'transparent',
    strokeWidth: 18,
    fill: 'none',
    pointerEvents: 'stroke' as const,
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const up = event.key === 'ArrowUp' || event.key === 'ArrowRight'
    const down = event.key === 'ArrowDown' || event.key === 'ArrowLeft'
    if (!up && !down) return
    event.preventDefault()
    const sign = up ? 1 : -1
    const qStep = niceTickStep(ranges.q, 40)
    const pStep = niceTickStep(ranges.p, 40)
    apply(selected, explore, sign * qStep, sign * pStep)
  }

  const labels = panel.labels ?? {}
  const scenario = solution.scenario
  const changed = solution.binding && scenario !== 'equilibrium'
  const showNew = step >= 2
  const xLabel = visualization.quantityScale
    ? `Q (${t(`viz.market.scale.${visualization.quantityScale}` as TranslationKey)}${visualization.quantityUnit ? ` ${visualization.quantityUnit}` : ''})`
    : visualization.quantityUnit
      ? `Q (${visualization.quantityUnit})`
      : 'Q'
  const yLabel = visualization.priceUnit ? `P (${visualization.priceUnit})` : 'P'
  const areas = step >= 4 ? visibleAreas(solution, mode) : []
  const policyLine = policyLineOf(current.spec, solution, t)

  return (
    <section className="min-w-0 space-y-2">
      {panel.title && <h4 className="text-center text-sm font-medium">{panel.title}</h4>}
      <div
        tabIndex={0}
        role="group"
        aria-label={t('viz.market.panelAria', {
          title: panel.title ?? `${t('viz.market.demand')} / ${t('viz.market.supply')}`,
        })}
        onKeyDown={onKeyDown}
        className="focus-ring rounded-md"
        data-market-panel
      >
        <PlotFrame
          width={width}
          height={height}
          xRange={[0, ranges.q]}
          yRange={[0, ranges.p]}
          xLabel={xLabel}
          yLabel={yLabel}
          label={t('viz.market.aria', { summary })}
          compact={compact}
          pad={PAD}
          overlay={(scale) => (
            <>
              {step >= 1 && (
                <EquilibriumMark
                  scale={scale}
                  q={solution.original.q.value}
                  p={solution.original.p.value}
                  index={changed ? '₁' : ''}
                  fmt={fmt}
                  point={solution.original}
                />
              )}
              {step >= 3 && changed && (
                <OutcomeMarks scale={scale} solution={solution} fmt={fmt} t={t} />
              )}
              {step >= 1 && (
                <CurveLabels
                  scale={scale}
                  solution={solution}
                  ranges={ranges}
                  labels={labels}
                  showNew={showNew}
                />
              )}
              {showNew && policyLine && (
                <text
                  x={policyLine.axis === 'price' ? scale.right - 4 : scale.sx(policyLine.value) + 4}
                  y={policyLine.axis === 'price' ? scale.sy(policyLine.value) - 5 : scale.top + 12}
                  textAnchor={policyLine.axis === 'price' ? 'end' : 'start'}
                  fontSize="11"
                  fill={POLICY}
                  data-policy-label
                >
                  {policyLine.label}
                </text>
              )}
            </>
          )}
        >
          {(scale) => (
            <>
              {areas.map((area) => (
                <polygon
                  key={area.id}
                  data-area={area.id}
                  points={area.polygon
                    .map((pt) => `${scale.sx(pt.q).toFixed(2)},${scale.sy(pt.p).toFixed(2)}`)
                    .join(' ')}
                  fill={area.effect ? EFFECT_FILL[area.effect] : AREA_FILL[area.kind]}
                  stroke="none"
                />
              ))}
              {step >= 1 && (
                <>
                  <CurvePath
                    scale={scale}
                    curve={solution.demand}
                    ranges={ranges}
                    color={DEMAND}
                    dashed={showNew && !!solution.newDemand}
                    id="demand"
                  />
                  <CurvePath
                    scale={scale}
                    curve={solution.supply}
                    ranges={ranges}
                    color={SUPPLY}
                    dashed={showNew && !!solution.newSupply}
                    id="supply"
                  />
                </>
              )}
              {showNew && solution.newDemand && (
                <CurvePath
                  scale={scale}
                  curve={solution.newDemand}
                  ranges={ranges}
                  color={DEMAND}
                  id="new-demand"
                />
              )}
              {showNew && solution.newSupply && (
                <CurvePath
                  scale={scale}
                  curve={solution.newSupply}
                  ranges={ranges}
                  color={SUPPLY}
                  id="new-supply"
                />
              )}
              {showNew && scenario === 'shift' && <ShiftArrows scale={scale} solution={solution} />}
              {showNew && policyLine && (
                <PolicyLine scale={scale} line={policyLine} ranges={ranges} />
              )}
              {/* Pointer hit areas (keyboard users move curves with the arrow keys). */}
              {step >= 1 && (
                <>
                  <path d={curveD(movedCurve('demand'), scale, ranges)} {...dragProps('demand')} />
                  <path d={curveD(movedCurve('supply'), scale, ranges)} {...dragProps('supply')} />
                  {showNew && policyLine && (
                    <path d={policyD(policyLine, scale, ranges)} {...dragProps('policy')} />
                  )}
                </>
              )}
            </>
          )}
        </PlotFrame>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-1 text-[13px]">
        <span className="text-muted-foreground">{t('viz.market.move')}</span>
        {(['demand', 'supply', ...(axis ? (['policy'] as const) : [])] as Target[]).map(
          (target) => (
            <button
              key={target}
              type="button"
              aria-pressed={selected === target}
              onClick={() => setSelected(target)}
              className={`focus-ring h-11 rounded-md border px-2 text-xs sm:h-7 ${selected === target ? 'border-primary bg-primary/10 text-foreground' : 'border-border/80 text-muted-foreground hover:bg-accent'}`}
            >
              {target === 'policy'
                ? t('viz.market.movePolicy')
                : t(target === 'demand' ? 'viz.market.demand' : 'viz.market.supply')}
            </button>
          ),
        )}
        {explored && (
          <button
            type="button"
            onClick={() => setExplore({})}
            className="focus-ring inline-flex h-11 items-center gap-1 rounded-md border border-border/80 px-2 text-xs hover:bg-accent sm:h-7"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {t('viz.market.reset')}
          </button>
        )}
        {hasChanges && step >= 4 && (
          <span className="ml-auto inline-flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">{t('viz.market.areaMode')}</span>
            {(['surplus', 'cs', 'ps'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`focus-ring h-11 rounded-md border px-2 text-xs sm:h-7 ${mode === m ? 'border-primary bg-primary/10 text-foreground' : 'border-border/80 text-muted-foreground hover:bg-accent'}`}
              >
                {t(
                  m === 'surplus'
                    ? 'viz.market.areaMode.surplus'
                    : m === 'cs'
                      ? 'viz.market.areaMode.changeCs'
                      : 'viz.market.areaMode.changePs',
                )}
              </button>
            ))}
          </span>
        )}
      </div>

      {areas.length > 0 && <AreaLegend areas={areas} fmt={fmt} t={t} />}
      <MarketReadout solution={solution} fmt={fmt} t={t} />
      <p className="sr-only" aria-live="polite" data-market-summary>
        {summary}
      </p>
    </section>
  )
}

// --- readouts -----------------------------------------------------------------------

function AreaLegend({
  areas,
  fmt,
  t,
}: {
  areas: MarketArea[]
  fmt: Formatters
  t: T
}): JSX.Element {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px]" data-area-legend>
      {areas
        .filter((a) => a.area.value > 1e-12)
        .map((area) => (
          <li key={area.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-sm border border-border/60"
              style={{ background: area.effect ? EFFECT_FILL[area.effect] : AREA_FILL[area.kind] }}
            />
            <span className="text-muted-foreground">
              {t(`viz.market.area.${area.kind}` as TranslationKey)}
              {area.effect ? ` (${t(`viz.market.effect.${area.effect}` as TranslationKey)})` : ''}
            </span>
            <span className="data-num">{fmt.money(area.area)}</span>
          </li>
        ))}
    </ul>
  )
}

function MarketReadout({
  solution,
  fmt,
  t,
}: {
  solution: MarketSolution
  fmt: Formatters
  t: T
}): JSX.Element {
  const changed = solution.scenario !== 'equilibrium'
  const money = (n: MarketNumber | null) => (n ? fmt.money(n) : t('viz.market.unbounded'))
  const rows: Array<[string, MarketNumber | null, MarketNumber | null, MarketNumber | null]> = [
    [t('viz.market.area.cs'), solution.before.cs, solution.after.cs, solution.change.cs],
    [t('viz.market.area.ps'), solution.before.ps, solution.after.ps, solution.change.ps],
  ]
  if (solution.after.government.value !== 0)
    rows.push([
      t('viz.market.government'),
      null,
      solution.after.government,
      solution.after.government,
    ])
  if (solution.after.rent.value !== 0)
    rows.push([t('viz.market.area.rent'), null, solution.after.rent, solution.after.rent])
  rows.push([
    t('viz.market.totalSurplus'),
    solution.before.total,
    solution.after.total,
    solution.change.total,
  ])
  const along = solution.elasticity.alongUnshifted
  const atDemand = solution.elasticity.demandAtOriginal
  return (
    <div className="space-y-1.5 px-1 text-[13px]" data-market-readout>
      <p className="data-num">
        {`Q₁* = ${fmt.quantity(solution.original.q)}, P₁* = ${fmt.price(solution.original.p)}`}
        {changed && solution.binding && (
          <>
            {` → Q₂ = ${fmt.quantity(solution.outcome.q)}, P₂ = ${fmt.price(solution.outcome.p)}`}
            <span className="text-muted-foreground" data-delta>
              {` (ΔP ${signed(formatMarketNumber(solution.deltaP))}, ΔQ ${signed(formatMarketNumber(solution.deltaQ))})`}
            </span>
          </>
        )}
      </p>
      {changed && !solution.binding && (
        <p className="text-muted-foreground">{t('viz.market.nonBinding')}</p>
      )}
      {solution.buyerPrice && solution.sellerPrice && (
        <p data-prices>
          {`${t('viz.market.buyerPrice')} ${fmt.price(solution.buyerPrice)} · ${t('viz.market.sellerPrice')} ${fmt.price(solution.sellerPrice)}`}
          {solution.incidence && (
            <span className="block text-muted-foreground" data-incidence>
              {t('viz.market.incidence', {
                buyers: fmt.price(solution.incidence.buyersPerUnit),
                sellers: fmt.price(solution.incidence.sellersPerUnit),
              })}
            </span>
          )}
        </p>
      )}
      {solution.shift?.ambiguous && solution.shift.resolved && (
        <p data-ambiguity>
          {t('viz.market.ambiguity', {
            variable: t(`viz.market.variable.${solution.shift.ambiguous}` as TranslationKey),
            direction: t(`viz.market.direction.${solution.shift.resolved}` as TranslationKey),
          })}
        </p>
      )}
      {along && (
        <p className="text-muted-foreground" data-elasticity>
          {t('viz.market.elasticityAlong', {
            side: t(along.side === 'demand' ? 'viz.market.demand' : 'viz.market.supply'),
            value: along.value.exact ? formatMarketNumber(along.value.exact) : '∞',
            kind: t(`viz.market.kind.${along.value.kind}` as TranslationKey),
          })}
        </p>
      )}
      {!along && atDemand && solution.scenario === 'equilibrium' && (
        <p className="text-muted-foreground" data-elasticity>
          {t('viz.market.elasticityAt', {
            value: atDemand.exact ? formatMarketNumber(atDemand.exact) : '−∞',
            kind: t(`viz.market.kind.${atDemand.kind}` as TranslationKey),
          })}
        </p>
      )}
      <table className="w-full max-w-md text-left text-[13px]">
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-0.5 font-normal" />
            <th scope="col" className="py-0.5 text-right font-normal">
              {t('viz.market.before')}
            </th>
            <th scope="col" className="py-0.5 text-right font-normal">
              {t('viz.market.after')}
            </th>
            <th scope="col" className="py-0.5 text-right font-normal">
              {t('viz.market.change')}
            </th>
          </tr>
        </thead>
        <tbody className="data-num">
          {rows.map(([name, before, after, change]) => (
            <tr key={name}>
              <th scope="row" className="py-0.5 font-normal text-muted-foreground">
                {name}
              </th>
              <td className="py-0.5 text-right">{before ? money(before) : '—'}</td>
              <td className="py-0.5 text-right">{money(after)}</td>
              <td className="py-0.5 text-right">{change ? signed(money(change)) : '—'}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-0.5 font-normal text-muted-foreground">
              {t('viz.market.area.dwl')}
            </th>
            <td className="py-0.5 text-right">—</td>
            <td className="py-0.5 text-right" data-dwl>
              {solution.deadweightLoss ? fmt.money(solution.deadweightLoss) : '—'}
            </td>
            <td className="py-0.5 text-right">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
