import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { RotateCcw } from 'lucide-react'
import {
  nudgeCurveSpec,
  resolveCurve,
  solveMarket,
  type CurveSide,
  type MarketCurve,
} from '@/entities/econ/market'
import {
  decodeDrawAnswer,
  drawnSpec,
  encodeDrawAnswer,
  expectedPolicy,
  regionCandidates,
  type DrawAnswer,
  type MarketQuestion,
  type RegionKey,
} from '@/entities/econ/graphQuestion'
import { niceTickStep } from '@/entities/tutorVisualization/linear'
import { capturePointer, releasePointer } from '@/shared/lib/pointerGesture'
import { onRadioKeyDown } from '@/shared/lib/radioGroupKeys'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'
import { PlotFrame } from '@/widgets/tutor/PlotFrame'
import { FOREGROUND, LABEL } from '@/widgets/tutor/plotUtils'
import { CurveLabels, CurvePath, EquilibriumMark } from './marketPlot'
import {
  AREA_FILL,
  DEMAND,
  PAD,
  POLICY,
  SUPPLY,
  axisLabels,
  curveD,
  formatters,
  marketRanges,
  FIGURE_HEIGHT as HEIGHT,
  FIGURE_WIDTH as WIDTH,
} from './marketPlotUtils'

type Target = CurveSide | 'policy'
type Tool = 'move' | 'point'

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function pointInPolygon(point: { q: number; p: number }, polygon: Array<{ q: number; p: number }>) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (
      a.p > point.p !== b.p > point.p &&
      point.q < ((b.q - a.q) * (point.p - a.p)) / (b.p - a.p) + a.q
    )
      inside = !inside
  }
  return inside
}

/**
 * 作图题的作答 (tablet, mouse and keyboard): start from the original diagram,
 * drag the curve(s) or set the policy line to show the change, mark the new
 * outcome (tap / click, or the arrow keys with “Mark the outcome”), and choose
 * the requested region (a button, or a tap inside it). Every action rewrites
 * the answer as `draw: demand=dq,dp; supply=…; policy=…; point=q,p; region=…`,
 * graded item by item by the engine.
 */
export function MarketDrawInput({
  question,
  value,
  onChange,
  disabled,
}: {
  question: MarketQuestion
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  const spec = question.figure.spec
  const task = question.draw
  const full = useMemo(() => solveMarket(spec), [spec])
  const base = useMemo(() => solveMarket({ ...spec, scenario: { kind: 'equilibrium' } }), [spec])
  const answer = useMemo<DrawAnswer>(() => decodeDrawAnswer(value) ?? {}, [value])
  const drawn = useMemo(() => solveMarket(drawnSpec(spec, answer)), [spec, answer])
  const policy = task?.items.includes('policy') ? expectedPolicy(spec) : null
  const [tool, setTool] = useState<Tool>('move')
  const [selected, setSelected] = useState<Target>(
    task?.items.includes('curve') || !policy ? 'demand' : 'policy',
  )
  const drag = useRef<{
    target: Target
    start: { q: number; p: number }
    answer: DrawAnswer
  } | null>(null)
  if (!full.ok || !base.ok || !task) return null
  const ranges = marketRanges(full.solution)
  const qStep = niceTickStep(ranges.q, 40)
  const pStep = niceTickStep(ranges.p, 40)
  const snap = (n: number, step: number) => round(Math.round(n / step) * step)
  const fmt = formatters(question.figure)
  const labels = axisLabels(question.figure, t)
  const regions = task.items.includes('region') ? regionCandidates(full.solution) : []
  const curveMoves = task.items.includes('curve') || task.items.includes('direction')

  const commit = (next: DrawAnswer) => {
    if (disabled) return
    onChange(encodeDrawAnswer(next))
  }

  const studentCurve = (side: CurveSide): MarketCurve | null => {
    const moved = answer[side]
    const written = side === 'demand' ? spec.demand : spec.supply
    const resolved = resolveCurve(moved ? nudgeCurveSpec(written, moved) : written, side)
    return resolved.ok ? resolved.value : null
  }
  const isMoved = (side: CurveSide) => {
    const moved = answer[side]
    return !!moved && (Math.abs(moved.dq) > 1e-9 || Math.abs(moved.dp) > 1e-9)
  }

  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const toData = (event: ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>) => {
    const svg = (event.currentTarget as SVGElement).ownerSVGElement
    const rect = svg?.getBoundingClientRect()
    const k = rect && rect.width > 0 ? WIDTH / rect.width : 1
    const x = (event.clientX - (rect?.left ?? 0)) * k
    const y = (event.clientY - (rect?.top ?? 0)) * k
    return {
      q: Math.max(0, Math.min(ranges.q, ((x - PAD.left) / plotW) * ranges.q)),
      p: Math.max(0, Math.min(ranges.p, (1 - (y - PAD.top) / plotH) * ranges.p)),
    }
  }

  /** Move a target by a data delta from a starting answer (snapped to the grid). */
  const moved = (from: DrawAnswer, target: Target, dq: number, dp: number): DrawAnswer => {
    if (target === 'policy') {
      const start = from.policy ?? policy?.value ?? 0
      const delta = policy?.axis === 'quantity' ? dq : dp
      return {
        ...from,
        policy: Math.max(0, snap(start + delta, policy?.axis === 'quantity' ? qStep : pStep)),
      }
    }
    const previous = from[target] ?? { dq: 0, dp: 0 }
    const curve = studentCurve(target)
    const vertical = curve?.kind === 'vertical'
    const next = vertical
      ? { dq: snap(previous.dq + dq, qStep), dp: previous.dp }
      : { dq: previous.dq, dp: snap(previous.dp + dp, pStep) }
    const candidate = { ...from, [target]: next }
    // A move that leaves no sensible market (curves not crossing) is ignored.
    return solveMarket(drawnSpec(spec, candidate)).ok ? candidate : from
  }

  const onPointerDown = (target: Target) => (event: ReactPointerEvent<SVGElement>) => {
    if (disabled || tool !== 'move') return
    event.preventDefault()
    setSelected(target)
    capturePointer(event.currentTarget, event.pointerId)
    drag.current = { target, start: toData(event), answer }
  }
  const onPointerMove = (event: ReactPointerEvent<SVGElement>) => {
    const state = drag.current
    if (!state) return
    const now = toData(event)
    const next = moved(state.answer, state.target, now.q - state.start.q, now.p - state.start.p)
    if (next !== state.answer) commit(next)
  }
  const onPointerUp = (event: ReactPointerEvent<SVGElement>) => {
    releasePointer(event.currentTarget, event.pointerId)
    drag.current = null
  }
  const hit = (target: Target) => ({
    'data-drag': target,
    onPointerDown: onPointerDown(target),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    style: { touchAction: 'none' as const, cursor: tool === 'move' ? 'grab' : 'crosshair' },
    stroke: 'transparent',
    strokeWidth: 22,
    fill: 'none',
    pointerEvents: tool === 'move' ? ('stroke' as const) : ('none' as const),
  })

  const drawnAreas = drawn.ok
    ? drawn.solution.areas.filter((area) => !area.effect && area.kind !== 'total_revenue')
    : []
  const regionAreas = (region: RegionKey) => {
    const after = drawnAreas.filter((area) => area.kind === region && area.phase === 'after')
    return after.length ? after : drawnAreas.filter((area) => area.kind === region)
  }

  const onPlotClick = (event: ReactMouseEvent<SVGRectElement>) => {
    if (disabled) return
    const at = toData(event)
    if (tool === 'point') {
      commit({ ...answer, point: { q: snap(at.q, qStep / 2), p: snap(at.p, pStep / 2) } })
      return
    }
    // A tap inside a region of the student's own drawing selects it.
    const inside = regions.find((region) =>
      regionAreas(region).some((area) => pointInPolygon(at, area.polygon)),
    )
    if (inside) commit({ ...answer, region: inside })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const dx = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const dy = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
    const fine = event.shiftKey ? 0.5 : 1
    if (tool === 'point') {
      if (event.key === 'Enter' && !answer.point) {
        event.preventDefault()
        commit({
          ...answer,
          point: {
            q: round(base.solution.original.q.value),
            p: round(base.solution.original.p.value),
          },
        })
        return
      }
      if (!dx && !dy) return
      event.preventDefault()
      const start = answer.point ?? {
        q: base.solution.original.q.value,
        p: base.solution.original.p.value,
      }
      commit({
        ...answer,
        point: {
          q: Math.max(0, round(start.q + dx * qStep * fine)),
          p: Math.max(0, round(start.p + dy * pStep * fine)),
        },
      })
      return
    }
    if (!dx && !dy) return
    event.preventDefault()
    if (selected === 'policy') {
      if (!policy) return
      if (answer.policy === undefined) {
        placePolicy()
        return
      }
      // A price line moves up / down, a quota line left / right.
      const step = policy.axis === 'price' ? dy * pStep : dx * qStep
      if (!step) return
      commit({ ...answer, policy: Math.max(0, round(answer.policy + step * fine)) })
      return
    }
    const previous = answer[selected] ?? { dq: 0, dp: 0 }
    const next = {
      ...answer,
      [selected]: {
        dq: round(previous.dq + dx * qStep * fine),
        dp: round(previous.dp + dy * pStep * fine),
      },
    }
    if (solveMarket(drawnSpec(spec, next)).ok) commit(next)
  }

  const placePolicy = () => {
    if (!policy) return
    const start =
      policy.axis === 'price' ? base.solution.original.p.value : base.solution.original.q.value
    commit({ ...answer, policy: round(start) })
    setSelected('policy')
    setTool('move')
  }

  const demandCurve = studentCurve('demand')
  const supplyCurve = studentCurve('supply')
  const targets: Target[] = [
    ...(curveMoves ? (['demand', 'supply'] as const) : []),
    ...(policy ? (['policy'] as const) : []),
  ]
  const summary = [
    ...(['demand', 'supply'] as const)
      .filter((side) => isMoved(side))
      .map((side) =>
        t('marketQ.draw.moved', {
          curve: t(`marketQ.draw.target.${side}` as TranslationKey),
          dq: String(answer[side]!.dq),
          dp: String(answer[side]!.dp),
        }),
      ),
    answer.policy !== undefined ? `${t('marketQ.draw.target.policy')}: ${answer.policy}` : '',
    answer.point
      ? t('marketQ.draw.pointMarked', { q: String(answer.point.q), p: String(answer.point.p) })
      : t('marketQ.draw.pointNone'),
    regions.length
      ? `${t('marketQ.draw.region')} ${answer.region ? t(`viz.market.area.${answer.region}` as TranslationKey) : t('marketQ.draw.regionNone')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="space-y-2" data-market-draw>
      <p className="text-xs text-muted-foreground">{t('marketQ.draw.instructions')}</p>
      <div
        tabIndex={0}
        role="group"
        aria-label={t('marketQ.draw.aria', { summary })}
        onKeyDown={onKeyDown}
        className="focus-ring max-w-xl rounded-md"
        data-market-draw-plot
        translate="no"
      >
        <PlotFrame
          width={WIDTH}
          height={HEIGHT}
          xRange={[0, ranges.q]}
          yRange={[0, ranges.p]}
          xLabel={labels.x}
          yLabel={labels.y}
          label={t('marketQ.draw.aria', { summary })}
          pad={PAD}
          overlay={(scale) => (
            <>
              <EquilibriumMark
                scale={scale}
                q={base.solution.original.q.value}
                p={base.solution.original.p.value}
                index="₁"
                fmt={fmt}
                point={base.solution.original}
              />
              <CurveLabels
                scale={scale}
                solution={base.solution}
                ranges={ranges}
                labels={{}}
                showNew={false}
              />
              {answer.point && (
                <g data-student-point>
                  <circle
                    cx={scale.sx(answer.point.q)}
                    cy={scale.sy(answer.point.p)}
                    r="6"
                    fill="none"
                    stroke={FOREGROUND}
                    strokeWidth="2"
                  />
                  <path
                    d={`M ${scale.sx(answer.point.q)} ${scale.sy(0)} L ${scale.sx(answer.point.q)} ${scale.sy(answer.point.p)} L ${scale.sx(0)} ${scale.sy(answer.point.p)}`}
                    fill="none"
                    stroke={LABEL}
                    strokeDasharray="2 3"
                  />
                </g>
              )}
            </>
          )}
        >
          {(scale) => (
            <>
              {answer.region &&
                regionAreas(answer.region).map((area) => (
                  <polygon
                    key={area.id}
                    data-student-region={area.kind}
                    points={area.polygon
                      .map((pt) => `${scale.sx(pt.q).toFixed(2)},${scale.sy(pt.p).toFixed(2)}`)
                      .join(' ')}
                    fill={AREA_FILL[area.kind]}
                    stroke="none"
                  />
                ))}
              <rect
                x={scale.left}
                y={scale.top}
                width={scale.right - scale.left}
                height={scale.bottom - scale.top}
                fill="transparent"
                onClick={onPlotClick}
                style={{ cursor: tool === 'point' ? 'crosshair' : 'default' }}
                data-plot-area
              />
              <CurvePath
                scale={scale}
                curve={base.solution.demand}
                ranges={ranges}
                color={DEMAND}
                dashed={isMoved('demand')}
                id="demand"
              />
              <CurvePath
                scale={scale}
                curve={base.solution.supply}
                ranges={ranges}
                color={SUPPLY}
                dashed={isMoved('supply')}
                id="supply"
              />
              {isMoved('demand') && demandCurve && (
                <CurvePath
                  scale={scale}
                  curve={demandCurve}
                  ranges={ranges}
                  color={DEMAND}
                  id="student-demand"
                />
              )}
              {isMoved('supply') && supplyCurve && (
                <CurvePath
                  scale={scale}
                  curve={supplyCurve}
                  ranges={ranges}
                  color={SUPPLY}
                  id="student-supply"
                />
              )}
              {policy && answer.policy !== undefined && (
                <path
                  d={
                    policy.axis === 'price'
                      ? `M ${scale.sx(0)} ${scale.sy(answer.policy)} L ${scale.sx(ranges.q)} ${scale.sy(answer.policy)}`
                      : `M ${scale.sx(answer.policy)} ${scale.sy(0)} L ${scale.sx(answer.policy)} ${scale.sy(ranges.p)}`
                  }
                  stroke={POLICY}
                  strokeWidth="1.8"
                  fill="none"
                  data-student-policy
                />
              )}
              {curveMoves && demandCurve && (
                <path d={curveD(demandCurve, scale, ranges)} {...hit('demand')} />
              )}
              {curveMoves && supplyCurve && (
                <path d={curveD(supplyCurve, scale, ranges)} {...hit('supply')} />
              )}
              {policy && answer.policy !== undefined && (
                <path
                  d={
                    policy.axis === 'price'
                      ? `M ${scale.sx(0)} ${scale.sy(answer.policy)} L ${scale.sx(ranges.q)} ${scale.sy(answer.policy)}`
                      : `M ${scale.sx(answer.policy)} ${scale.sy(0)} L ${scale.sx(answer.policy)} ${scale.sy(ranges.p)}`
                  }
                  {...hit('policy')}
                />
              )}
            </>
          )}
        </PlotFrame>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
        {(['move', 'point'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={tool === item}
            disabled={disabled}
            onClick={() => setTool(item)}
            data-tool={item}
            className={cn(
              'focus-ring min-h-11 rounded-md border px-3 text-xs',
              tool === item
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border/80 text-muted-foreground hover:bg-accent',
            )}
          >
            {t(item === 'move' ? 'marketQ.draw.tool.move' : 'marketQ.draw.tool.point')}
          </button>
        ))}
        {tool === 'move' && targets.length > 1 && (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">{t('marketQ.draw.select')}</span>
            {targets.map((target) => (
              <button
                key={target}
                type="button"
                aria-pressed={selected === target}
                disabled={disabled}
                onClick={() => setSelected(target)}
                data-target={target}
                className={cn(
                  'focus-ring min-h-11 rounded-md border px-3 text-xs',
                  selected === target
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border/80 text-muted-foreground hover:bg-accent',
                )}
              >
                {t(`marketQ.draw.target.${target}` as TranslationKey)}
              </button>
            ))}
          </span>
        )}
        {policy && answer.policy === undefined && (
          <button
            type="button"
            disabled={disabled}
            onClick={placePolicy}
            data-place-policy
            className="focus-ring min-h-11 rounded-md border border-border/80 px-3 text-xs hover:bg-accent"
          >
            {t('marketQ.draw.addPolicy')}
          </button>
        )}
        <button
          type="button"
          disabled={disabled || !value}
          onClick={() => onChange('')}
          className="focus-ring ml-auto inline-flex min-h-11 items-center gap-1 rounded-md border border-border/80 px-3 text-xs hover:bg-accent disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          {t('marketQ.draw.reset')}
        </button>
      </div>

      {regions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-muted-foreground" aria-hidden>
            {t('marketQ.draw.region')}
          </span>
          <div
            role="radiogroup"
            aria-label={t('marketQ.draw.region')}
            className="flex flex-wrap gap-1.5"
          >
            {regions.map((region, index) => {
              const checked = answer.region === region
              const selectedIndex = answer.region ? regions.indexOf(answer.region) : -1
              return (
                <button
                  key={region}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked || (selectedIndex < 0 && index === 0) ? 0 : -1}
                  disabled={disabled}
                  onClick={() => commit({ ...answer, region })}
                  onKeyDown={(event) =>
                    onRadioKeyDown(event, regions, Math.max(0, selectedIndex), (next) =>
                      commit({ ...answer, region: next }),
                    )
                  }
                  data-region={region}
                  className={cn(
                    'focus-ring min-h-11 rounded-md border px-3 text-xs',
                    checked
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border/80 text-muted-foreground hover:bg-accent',
                  )}
                >
                  {t(`viz.market.area.${region}` as TranslationKey)}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('marketQ.draw.keys')}</p>
      <p className="sr-only" aria-live="polite" data-draw-summary>
        {summary}
      </p>
    </div>
  )
}
