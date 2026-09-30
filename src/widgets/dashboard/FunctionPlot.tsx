import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { parseExplicitFunction, sampleFunction } from '@/entities/tutorVisualization/nonlinear'
import type { VisualizationViewport } from '@/entities/tutorVisualization/types'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/Button'
import { useTranslation } from '@/i18n'
import {
  FUNCTION_TYPE_BY_ID,
  FUNCTION_TYPES,
  defaultsForType,
  num,
  pickInitialFunctionType,
  type FunctionTypeId,
} from './functionTypes'

/**
 * The interactive homepage plot: the product's signature instrument. A real
 * function family the learner chooses and shapes — one coefficient set drives
 * the curve, the printed formula and the printed coordinate (see
 * `functionTypes.ts`), sampled with the lesson visualizer's own engine.
 * Nothing here calls AI or writes learning data.
 *
 * The initial family is chosen at random once, when the homepage mounts; it
 * then holds steady across re-renders, parameter changes and language/theme
 * switches, and only changes when the learner picks another one.
 *
 * Layout: on a wide screen the plane takes the larger left pane (so the curve
 * has real room to be read and pointed at) with the readout and sliders in a
 * compact right rail; below `lg` the rail stacks under the plane.
 *
 * Colours come from the theme tokens, so all four palettes and both light/dark
 * modes apply automatically.
 */

const VIEWPORT: VisualizationViewport = { xMin: -5, xMax: 5, yMin: -6, yMax: 6 }
const WIDTH = 520
const HEIGHT = 360
const PAD = { left: 46, right: 18, top: 18, bottom: 36 }
const DEFAULT_PROBE = 1
/** Integer gridlines that get a printed number (kept clear of the frame). */
const X_TICKS = [-4, -3, -2, -1, 1, 2, 3, 4]
const Y_TICKS = [-4, -3, -2, -1, 1, 2, 3, 4]

export function FunctionPlot(): JSX.Element {
  const { t } = useTranslation()
  const [type, setType] = useState<FunctionTypeId>(() => pickInitialFunctionType())
  const [values, setValues] = useState<Record<string, number>>(() => defaultsForType(type))
  const [probeX, setProbeX] = useState<number>(DEFAULT_PROBE)
  /** Bumped on a family switch / reset so the curve redraws (never mid-drag). */
  const [drawKey, setDrawKey] = useState(0)
  /** Bumped on a family switch / reset so the printed value flashes once. */
  const [flashKey, setFlashKey] = useState(0)

  const def = FUNCTION_TYPE_BY_ID[type]

  const { evaluate, formula } = useMemo(() => {
    const parsed = parseExplicitFunction(def.buildExpression(values))
    return {
      evaluate: parsed?.evaluate ?? null,
      formula: def.formatFormula(values),
    }
  }, [def, values])

  const segments = useMemo(
    () => (evaluate ? sampleFunction(evaluate, VIEWPORT).segments : []),
    [evaluate],
  )

  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const toPx = (x: number): number =>
    PAD.left + ((x - VIEWPORT.xMin) / (VIEWPORT.xMax - VIEWPORT.xMin)) * plotW
  const toPy = (y: number): number =>
    PAD.top + ((VIEWPORT.yMax - y) / (VIEWPORT.yMax - VIEWPORT.yMin)) * plotH
  const fromPx = (px: number): number =>
    VIEWPORT.xMin + ((px - PAD.left) / plotW) * (VIEWPORT.xMax - VIEWPORT.xMin)

  const probeY = evaluate ? evaluate(probeX) : Number.NaN
  const probeOnCurve =
    Number.isFinite(probeY) && probeY >= VIEWPORT.yMin && probeY <= VIEWPORT.yMax
  const probeReadout = probeOnCurve
    ? `P (${num(probeX, 2)}, ${num(probeY, 2)})`
    : t('plot.offCurve')

  const gridXs = useMemo(() => {
    const list: number[] = []
    for (let x = VIEWPORT.xMin; x <= VIEWPORT.xMax; x++) list.push(x)
    return list
  }, [])
  const gridYs = useMemo(() => {
    const list: number[] = []
    for (let y = VIEWPORT.yMin; y <= VIEWPORT.yMax; y++) list.push(y)
    return list
  }, [])

  const curvePath = segments
    .map((segment) =>
      segment
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${toPx(point.x).toFixed(2)} ${toPy(point.y).toFixed(2)}`)
        .join(' '),
    )
    .join(' ')

  const clipId = 'function-plot-clip'

  function handlePointer(event: React.PointerEvent<SVGSVGElement>): void {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const px = ((event.clientX - rect.left) / rect.width) * WIDTH
    const next = fromPx(px)
    setProbeX(Number(Math.max(VIEWPORT.xMin, Math.min(VIEWPORT.xMax, next)).toFixed(2)))
  }

  function chooseType(next: FunctionTypeId): void {
    if (next === type) return
    setType(next)
    setValues(defaultsForType(next))
    setDrawKey((key) => key + 1)
    setFlashKey((key) => key + 1)
  }

  function reset(): void {
    setValues(defaultsForType(type))
    setProbeX(DEFAULT_PROBE)
    setDrawKey((key) => key + 1)
    setFlashKey((key) => key + 1)
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          key={flashKey}
          className="value-flash data-num -mx-1 rounded-md px-1 font-mono text-base font-semibold text-foreground"
          dir="ltr"
        >
          {formula}
        </p>
        <div className="flex items-center gap-1">
          <div
            role="group"
            aria-label={t('plot.typeGroupLabel')}
            className="flex items-center gap-0.5 rounded-full border border-border/70 bg-muted/40 p-0.5"
          >
            {FUNCTION_TYPES.map((item) => {
              const active = item.id === type
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => chooseType(item.id)}
                  className={cn(
                    'focus-ring rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-card text-foreground shadow-soft'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(item.labelKey)}
                </button>
              )
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={reset}
            aria-label={t('common.reset')}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        {/* The plane is the instrument; it gets the larger pane on wide screens. */}
        <div className="rounded-xl border border-border/70 bg-background/60 p-2">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full touch-pan-y select-none"
            role="img"
            aria-label={t('plot.srDescription')}
            onPointerMove={handlePointer}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
              </clipPath>
            </defs>

            {/* Graph-paper minor grid: one cell per unit. */}
            <g stroke="hsl(var(--border) / 0.7)" strokeWidth="1">
              {gridXs.map((x) => (
                <line key={`gx${x}`} x1={toPx(x)} y1={PAD.top} x2={toPx(x)} y2={PAD.top + plotH} />
              ))}
              {gridYs.map((y) => (
                <line key={`gy${y}`} x1={PAD.left} y1={toPy(y)} x2={PAD.left + plotW} y2={toPy(y)} />
              ))}
            </g>

            {/* Axes, with short ticks. */}
            <g stroke="hsl(var(--muted-foreground) / 0.9)" strokeWidth="1.5" strokeLinecap="round">
              <line x1={PAD.left} y1={toPy(0)} x2={PAD.left + plotW} y2={toPy(0)} />
              <line x1={toPx(0)} y1={PAD.top} x2={toPx(0)} y2={PAD.top + plotH} />
            </g>
            <g stroke="hsl(var(--muted-foreground) / 0.55)" strokeWidth="1">
              {X_TICKS.map((x) => (
                <line key={`tx${x}`} x1={toPx(x)} y1={toPy(0) - 3} x2={toPx(x)} y2={toPy(0) + 3} />
              ))}
              {Y_TICKS.map((y) => (
                <line key={`ty${y}`} x1={toPx(0) - 3} y1={toPy(y)} x2={toPx(0) + 3} y2={toPy(y)} />
              ))}
            </g>

            {/* Printed scale numbers — real coordinates, not decoration. */}
            <g fill="hsl(var(--muted-foreground))" fontSize="9" fontFamily="ui-monospace, monospace">
              {X_TICKS.map((x) => (
                <text key={`nx${x}`} x={toPx(x)} y={toPy(0) + 14} textAnchor="middle">
                  {x}
                </text>
              ))}
              {Y_TICKS.map((y) => (
                <text key={`ny${y}`} x={toPx(0) - 5} y={toPy(y) + 3} textAnchor="end">
                  {y}
                </text>
              ))}
            </g>

            <g clipPath={`url(#${clipId})`}>
              {/* Keyed by family so switching redraws the curve once; parameter
                  changes keep the same node and update instantly. `pathLength={1}`
                  makes the one-shot draw exact for any curve length. */}
              <path
                key={drawKey}
                className="graph-draw"
                pathLength={1}
                style={{ ['--graph-len' as string]: 1 }}
                d={curvePath}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {probeOnCurve && (
                <>
                  <line
                    x1={toPx(probeX)}
                    y1={PAD.top}
                    x2={toPx(probeX)}
                    y2={PAD.top + plotH}
                    stroke="hsl(var(--theme-accent))"
                    strokeWidth="1"
                    strokeDasharray="3 4"
                  />
                  <line
                    x1={PAD.left}
                    y1={toPy(probeY)}
                    x2={PAD.left + plotW}
                    y2={toPy(probeY)}
                    stroke="hsl(var(--theme-accent))"
                    strokeWidth="1"
                    strokeDasharray="3 4"
                  />
                  <circle cx={toPx(probeX)} cy={toPy(probeY)} r="4.5" fill="hsl(var(--theme-accent))" />
                </>
              )}
            </g>

            <text
              x={PAD.left + plotW}
              y={toPy(0) - 6}
              textAnchor="end"
              fontSize="11"
              fontStyle="italic"
              fill="hsl(var(--muted-foreground))"
            >
              x
            </text>
            <text
              x={toPx(0) + 6}
              y={PAD.top + 10}
              fontSize="11"
              fontStyle="italic"
              fill="hsl(var(--muted-foreground))"
            >
              y
            </text>
          </svg>
        </div>

        {/* Readout + controls rail. */}
        <div className="flex flex-col gap-3">
          <div
            key={flashKey}
            className="value-flash flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5"
          >
            <span className="label-mono">{t('plot.readout')}</span>
            <span className="data-num font-mono text-sm font-medium text-foreground" dir="ltr">
              {probeReadout}
            </span>
          </div>
          <div className="grid gap-3">
            {def.params.map((param) => (
              <ParamSlider
                key={`${def.id}-${param.key}`}
                id={`plot-${param.key}`}
                label={param.symbol}
                value={values[param.key] ?? param.default}
                valueText={num(values[param.key] ?? param.default)}
                min={param.min}
                max={param.max}
                step={param.step}
                onChange={(next) => setValues((prev) => ({ ...prev, [param.key]: next }))}
              />
            ))}
            <ParamSlider
              id="plot-probe"
              label={t('plot.probe')}
              value={probeX}
              valueText={num(probeX, 2)}
              ariaValueText={probeReadout}
              min={VIEWPORT.xMin}
              max={VIEWPORT.xMax}
              step={0.1}
              onChange={setProbeX}
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('plot.hint')}</p>
        </div>
      </div>
    </div>
  )
}

function ParamSlider({
  id,
  label,
  value,
  valueText,
  ariaValueText,
  min,
  max,
  step,
  onChange,
}: {
  id: string
  label: string
  value: number
  valueText: string
  ariaValueText?: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
      <label htmlFor={id} className="font-mono text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <span className="data-num font-mono text-xs text-foreground">{valueText}</span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        {...(ariaValueText ? { 'aria-valuetext': ariaValueText } : {})}
        onChange={(event) => onChange(Number(event.target.value))}
        className="col-span-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
    </div>
  )
}
