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
 * The interactive homepage plot: a real function family the learner chooses
 * and shapes. The curve, the coordinates and the printed formula all come from
 * one coefficient set (see `functionTypes.ts`), sampled with the lesson
 * visualizer's own engine. Nothing here calls AI or writes learning data.
 *
 * The initial family is chosen at random once, when the homepage mounts; it
 * then holds steady across re-renders, parameter changes and language/theme
 * switches, and only changes when the learner picks another one.
 *
 * Colours come from the theme tokens, so all four palettes and both light/dark
 * modes apply automatically.
 */

const VIEWPORT: VisualizationViewport = { xMin: -5, xMax: 5, yMin: -6, yMax: 6 }
const WIDTH = 460
const HEIGHT = 300
const PAD = { left: 34, right: 16, top: 16, bottom: 28 }
const DEFAULT_PROBE = 1

export function FunctionPlot(): JSX.Element {
  const { t } = useTranslation()
  const [type, setType] = useState<FunctionTypeId>(() => pickInitialFunctionType())
  const [values, setValues] = useState<Record<string, number>>(() => defaultsForType(type))
  const [probeX, setProbeX] = useState<number>(DEFAULT_PROBE)

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
    ? `(${num(probeX, 2)}, ${num(probeY, 2)})`
    : t('plot.offCurve')

  const xs = useMemo(() => {
    const list: number[] = []
    for (let x = VIEWPORT.xMin; x <= VIEWPORT.xMax; x++) list.push(x)
    return list
  }, [])
  const ys = useMemo(() => {
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
  }

  function reset(): void {
    setValues(defaultsForType(type))
    setProbeX(DEFAULT_PROBE)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="data-num font-mono text-sm font-medium text-foreground" dir="ltr">
          {formula}
        </p>
        <span className="label-mono shrink-0">{t('plot.title')}</span>
      </div>

      <div role="group" aria-label={t('plot.typeGroupLabel')} className="flex flex-wrap gap-1.5">
        {FUNCTION_TYPES.map((item) => {
          const active = item.id === type
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => chooseType(item.id)}
              className={cn(
                'focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'bg-primary-strong text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(item.labelKey)}
            </button>
          )
        })}
      </div>

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

        <g stroke="hsl(var(--border))" strokeWidth="1">
          {xs.map((x) => (
            <line key={`gx${x}`} x1={toPx(x)} y1={PAD.top} x2={toPx(x)} y2={PAD.top + plotH} />
          ))}
          {ys.map((y) => (
            <line key={`gy${y}`} x1={PAD.left} y1={toPy(y)} x2={PAD.left + plotW} y2={toPy(y)} />
          ))}
        </g>

        <g stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeLinecap="round">
          <line x1={PAD.left} y1={toPy(0)} x2={PAD.left + plotW} y2={toPy(0)} />
          <line x1={toPx(0)} y1={PAD.top} x2={toPx(0)} y2={PAD.top + plotH} />
        </g>

        <g clipPath={`url(#${clipId})`}>
          {/* Keyed by family so switching redraws the curve once; parameter
              changes keep the same node and update instantly. `pathLength={1}`
              makes the one-shot draw exact for any curve length. */}
          <path
            key={def.id}
            className="graph-draw"
            pathLength={1}
            style={{ ['--graph-len' as string]: 1 }}
            d={curvePath}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2.6"
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
          fill="hsl(var(--muted-foreground))"
        >
          x
        </text>
        <text x={toPx(0) + 6} y={PAD.top + 10} fontSize="11" fill="hsl(var(--muted-foreground))">
          y
        </text>
      </svg>

      <p className="text-xs leading-relaxed text-muted-foreground">{t('plot.hint')}</p>

      <p className="data-num font-mono text-sm text-foreground" dir="ltr">
        {probeReadout}
      </p>

      <div className="space-y-2.5">
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
        <Button type="button" variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          {t('common.reset')}
        </Button>
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
