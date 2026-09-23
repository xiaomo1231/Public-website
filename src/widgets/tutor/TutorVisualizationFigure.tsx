import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  TutorVisualization,
  VisualizationPoint,
  VisualizationRelation,
  VisualizationViewport,
} from '@/entities/tutorVisualization/types'
import {
  computeAutoViewport,
  DEFAULT_VIEWPORT,
  fitViewport,
  formatTick,
  isStrictRelation,
  lineIntersection,
  niceTickStep,
  parseRelationLatex,
  shadeDirection,
  type LineSpec,
  type LinearForm,
} from '@/entities/tutorVisualization/linear'
import {
  parseExplicitFunction,
  sampleFunction,
  type FunctionDomain,
} from '@/entities/tutorVisualization/nonlinear'
import { useTranslation, type UseTranslationResult } from '@/i18n'
import { Math as MathView } from '@/shared/ui/Math'
import { layoutForWidth } from './plotLayout'

/**
 * The single deterministic renderer for structured 2D visualizations.
 *
 * It draws only what the maths says: a line is derived from its relation, not
 * from AI-supplied sample points; a shaded region is computed from the
 * inequality; intersection points are solved, never guessed. It is a pure
 * function of (data, viewport, theme): no AI, no network, no randomness.
 *
 * SVG is used because axes, lines, points and regions map onto it directly,
 * accessibility is straightforward, and no plotting dependency is needed.
 *
 * Sizing is delegated to `layoutForWidth` so narrow screens keep readable text.
 */

/** Track an element's content width; 0 until it is measured. */
function useMeasuredWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      // Ignore sub-pixel churn to avoid render loops.
      setWidth((previous) => (Math.abs(previous - next) > 1 ? next : previous))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

const SERIES_COUNT = 4
const MAX_INTERSECTIONS = 4

const AXIS_STROKE = 'hsl(var(--viz-axis))'
const GRID_STROKE = 'hsl(var(--viz-grid))'
const LABEL_FILL = 'hsl(var(--viz-label))'
const FILL = 'hsl(var(--viz-fill) / 0.16)'

function seriesStroke(index: number): string {
  return `hsl(var(--viz-series-${(index % SERIES_COUNT) + 1}))`
}

interface LineEntry {
  line: LineSpec
  relation: VisualizationRelation
  form: LinearForm
  label?: string
  index: number
}

interface CurveEntry {
  /** Independent polylines; a break means "do not connect across here". */
  segments: { x: number; y: number }[][]
  index: number
}

interface PlotGeometry {
  lines: LineEntry[]
  curves: CurveEntry[]
  points: VisualizationPoint[]
  connect: boolean
  viewport: VisualizationViewport
}

function buildGeometry(visualization: TutorVisualization, aspect: number): PlotGeometry | null {
  if (visualization.type === 'points_2d' || visualization.type === 'table_2d') {
    const points = visualization.points
    if (points.length === 0) return null
    const viewport = visualization.viewport ?? computeAutoViewport([], points)
    return {
      lines: [],
      curves: [],
      points,
      connect: visualization.connect === true,
      viewport: fitViewport(viewport, aspect),
    }
  }

  const isFunction = visualization.type === 'function_2d'
  const lines: LineEntry[] = []
  const forms: LinearForm[] = []
  const curveSpecs: {
    index: number
    evaluate: (x: number) => number
    domain?: FunctionDomain
  }[] = []

  for (const [index, expression] of visualization.expressions.entries()) {
    // A nonlinear explicit function of x (Phase 2). Only `function_2d` can
    // carry one; anything that fails the whitelist falls through to the linear
    // path (and is dropped if that fails too).
    if (isFunction && expression.expression) {
      const parsed = parseExplicitFunction(expression.expression)
      if (parsed) {
        curveSpecs.push({
          index,
          evaluate: parsed.evaluate,
          ...(expression.domain ? { domain: expression.domain } : {}),
        })
        continue
      }
    }

    const parsed = parseRelationLatex(expression.latex)
    if (!parsed) continue
    forms.push(parsed.form)
    lines.push({
      line: parsed.line,
      relation: expression.relation,
      form: parsed.form,
      ...(expression.label ? { label: expression.label } : {}),
      index,
    })
  }

  if (lines.length === 0 && curveSpecs.length === 0) return null

  const baseViewport =
    visualization.viewport ??
    (forms.length > 0 ? computeAutoViewport(forms, []) : DEFAULT_VIEWPORT)
  const viewport = fitViewport(baseViewport, aspect)

  const curves: CurveEntry[] = curveSpecs.map((spec) => ({
    index: spec.index,
    segments: sampleFunction(spec.evaluate, viewport, spec.domain).segments,
  }))

  return { lines, curves, points: [], connect: false, viewport }
}

function ticksFor(min: number, max: number, step: number): number[] {
  const ticks: number[] = []
  const start = Math.ceil(min / step) * step
  for (let value = start, i = 0; value <= max + step * 1e-6 && i < 60; value += step, i++) {
    ticks.push(Number(value.toFixed(6)))
  }
  return ticks
}

function lineEndpoints(
  line: LineSpec,
  viewport: VisualizationViewport,
): { x1: number; y1: number; x2: number; y2: number } {
  if (line.kind === 'vertical') {
    return { x1: line.x, y1: viewport.yMin, x2: line.x, y2: viewport.yMax }
  }
  return {
    x1: viewport.xMin,
    y1: line.m * viewport.xMin + line.b,
    x2: viewport.xMax,
    y2: line.m * viewport.xMax + line.b,
  }
}

function shadePolygon(
  entry: LineEntry,
  viewport: VisualizationViewport,
): { x: number; y: number }[] | null {
  const direction = shadeDirection(entry.form, entry.relation)
  if (!direction) return null

  if (entry.line.kind === 'vertical') {
    if (direction === 'right') {
      return [
        { x: entry.line.x, y: viewport.yMin },
        { x: viewport.xMax, y: viewport.yMin },
        { x: viewport.xMax, y: viewport.yMax },
        { x: entry.line.x, y: viewport.yMax },
      ]
    }
    return [
      { x: entry.line.x, y: viewport.yMin },
      { x: viewport.xMin, y: viewport.yMin },
      { x: viewport.xMin, y: viewport.yMax },
      { x: entry.line.x, y: viewport.yMax },
    ]
  }

  const left = { x: viewport.xMin, y: entry.line.m * viewport.xMin + entry.line.b }
  const right = { x: viewport.xMax, y: entry.line.m * viewport.xMax + entry.line.b }
  const top = viewport.yMax
  const bottom = viewport.yMin
  if (direction === 'above') {
    return [left, right, { x: viewport.xMax, y: top }, { x: viewport.xMin, y: top }]
  }
  return [left, right, { x: viewport.xMax, y: bottom }, { x: viewport.xMin, y: bottom }]
}

function buildAriaLabel(visualization: TutorVisualization, t: UseTranslationResult['t']): string {
  if (visualization.type === 'points_2d') {
    const points = visualization.points
      .map((point) => `(${formatTick(point.x)}, ${formatTick(point.y)})`)
      .join(', ')
    return t('viz.ariaPoints', { points })
  }
  if (visualization.type === 'table_2d') return t('viz.ariaTable')
  const expressions = visualization.expressions.map((expression) => expression.latex).join(', ')
  return visualization.type === 'inequality_2d'
    ? t('viz.ariaInequality', { expressions })
    : t('viz.ariaGraph', { expressions })
}

export interface TutorVisualizationFigureProps {
  visualization: TutorVisualization
}

export function TutorVisualizationFigure({
  visualization,
}: TutorVisualizationFigureProps): JSX.Element | null {
  const { t } = useTranslation()
  const rawId = useId()
  const clipId = `viz-clip-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  const cardRef = useRef<HTMLDivElement>(null)
  const measured = useMeasuredWidth(cardRef)
  const layout = useMemo(() => layoutForWidth(measured), [measured])
  const plotW = layout.width - layout.pad.left - layout.pad.right
  const plotH = layout.height - layout.pad.top - layout.pad.bottom
  const aspect = plotW / plotH

  const geometry = useMemo(() => buildGeometry(visualization, aspect), [visualization, aspect])
  const label = useMemo(() => buildAriaLabel(visualization, t), [visualization, t])

  if (!geometry) return null

  const { viewport } = geometry
  const xSpan = viewport.xMax - viewport.xMin
  const ySpan = viewport.yMax - viewport.yMin

  const toScreen = (x: number, y: number): { sx: number; sy: number } => ({
    sx: layout.pad.left + ((x - viewport.xMin) / xSpan) * plotW,
    sy: layout.pad.top + (1 - (y - viewport.yMin) / ySpan) * plotH,
  })

  const tickTarget = layout.compact ? 4 : 8
  const xTicks = ticksFor(viewport.xMin, viewport.xMax, niceTickStep(xSpan, tickTarget))
  const yTicks = ticksFor(viewport.yMin, viewport.yMax, niceTickStep(ySpan, tickTarget))
  const axisX = toScreen(0, Math.min(Math.max(0, viewport.yMin), viewport.yMax))
  const axisY = toScreen(Math.min(Math.max(0, viewport.xMin), viewport.xMax), 0)

  const intersections = collectIntersections(geometry)

  const showPlot = visualization.type !== 'table_2d' || geometry.connect
  const showTable = visualization.type === 'table_2d'
  const lineExpressions =
    visualization.type === 'function_2d' ||
    visualization.type === 'equation_2d' ||
    visualization.type === 'inequality_2d'
      ? visualization.expressions
      : []
  const renderedIndices = new Set([
    ...geometry.lines.map((entry) => entry.index),
    ...geometry.curves.map((curve) => curve.index),
  ])
  const legendEntries = lineExpressions
    .map((expression, index) => ({ expression, index }))
    .filter((entry) => renderedIndices.has(entry.index))
  const showLegend =
    legendEntries.length > 1 ||
    legendEntries.some((entry) => entry.expression.label !== undefined)

  return (
    <figure data-tutor-visualization={visualization.id} className="my-5 min-w-0 space-y-2">
      <div
        ref={cardRef}
        className="w-full max-w-full overflow-hidden rounded-md border border-border/70 bg-card p-2"
      >
        {showPlot && (
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={label}
            className="block h-auto w-full max-w-full"
          >
            <title>{label}</title>
            <defs>
              <clipPath id={clipId}>
                <rect
                  x={layout.pad.left}
                  y={layout.pad.top}
                  width={plotW}
                  height={plotH}
                />
              </clipPath>
            </defs>

            {/* Grid */}
            <g aria-hidden="true">
              {xTicks.map((tick) => {
                const { sx } = toScreen(tick, 0)
                return (
                  <line
                    key={`gx-${tick}`}
                    x1={sx}
                    y1={layout.pad.top}
                    x2={sx}
                    y2={layout.pad.top + plotH}
                    stroke={GRID_STROKE}
                    strokeWidth={1}
                  />
                )
              })}
              {yTicks.map((tick) => {
                const { sy } = toScreen(0, tick)
                return (
                  <line
                    key={`gy-${tick}`}
                    x1={layout.pad.left}
                    y1={sy}
                    x2={layout.pad.left + plotW}
                    y2={sy}
                    stroke={GRID_STROKE}
                    strokeWidth={1}
                  />
                )
              })}
            </g>

            {/* Axes */}
            <g aria-hidden="true">
              <line
                x1={layout.pad.left}
                y1={axisX.sy}
                x2={layout.pad.left + plotW}
                y2={axisX.sy}
                stroke={AXIS_STROKE}
                strokeWidth={1.5}
              />
              <line
                x1={axisY.sx}
                y1={layout.pad.top}
                x2={axisY.sx}
                y2={layout.pad.top + plotH}
                stroke={AXIS_STROKE}
                strokeWidth={1.5}
              />
            </g>

            {/* Tick labels */}
            <g aria-hidden="true" fontSize={11} fill={LABEL_FILL}>
              {xTicks.map((tick) => {
                if (Math.abs(tick) < 1e-9) return null
                const { sx } = toScreen(tick, 0)
                return (
                  <text key={`tx-${tick}`} x={sx} y={layout.height - 10} textAnchor="middle">
                    {formatTick(tick)}
                  </text>
                )
              })}
              {yTicks.map((tick) => {
                if (Math.abs(tick) < 1e-9) return null
                const { sy } = toScreen(0, tick)
                return (
                  <text key={`ty-${tick}`} x={layout.pad.left - 6} y={sy + 4} textAnchor="end">
                    {formatTick(tick)}
                  </text>
                )
              })}
            </g>

            <g clipPath={`url(#${clipId})`}>
              {/* Shaded half-planes for inequalities. */}
              {geometry.lines.map((entry) => {
                const polygon = shadePolygon(entry, viewport)
                if (!polygon) return null
                const points = polygon
                  .map((point) => {
                    const { sx, sy } = toScreen(point.x, point.y)
                    return `${sx.toFixed(2)},${sy.toFixed(2)}`
                  })
                  .join(' ')
                return <polygon key={`shade-${entry.index}`} points={points} fill={FILL} />
              })}

              {/* Nonlinear curves: one polyline per continuous segment, so a
                  break at an asymptote is never bridged. */}
              {geometry.curves.map((curve) =>
                curve.segments.map((segment, segmentIndex) => (
                  <polyline
                    key={`curve-${curve.index}-${segmentIndex}`}
                    points={segment
                      .map((point) => {
                        const { sx, sy } = toScreen(point.x, point.y)
                        return `${sx.toFixed(2)},${sy.toFixed(2)}`
                      })
                      .join(' ')}
                    fill="none"
                    stroke={seriesStroke(curve.index)}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )),
              )}

              {/* Lines. */}
              {geometry.lines.map((entry) => {
                const ends = lineEndpoints(entry.line, viewport)
                const a = toScreen(ends.x1, ends.y1)
                const b = toScreen(ends.x2, ends.y2)
                return (
                  <line
                    key={`line-${entry.index}`}
                    x1={a.sx}
                    y1={a.sy}
                    x2={b.sx}
                    y2={b.sy}
                    stroke={seriesStroke(entry.index)}
                    strokeWidth={2}
                    strokeLinecap="round"
                    {...(isStrictRelation(entry.relation) ? { strokeDasharray: '6 5' } : {})}
                  />
                )
              })}

              {/* Points, optionally joined in order. */}
              {geometry.connect && geometry.points.length > 1 && (
                <polyline
                  points={geometry.points
                    .map((point) => {
                      const { sx, sy } = toScreen(point.x, point.y)
                      return `${sx.toFixed(2)},${sy.toFixed(2)}`
                    })
                    .join(' ')}
                  fill="none"
                  stroke={seriesStroke(0)}
                  strokeWidth={2}
                />
              )}
              {geometry.points.map((point, index) => {
                const { sx, sy } = toScreen(point.x, point.y)
                return (
                  <g key={`point-${index}`}>
                    <circle cx={sx} cy={sy} r={4} fill={seriesStroke(0)} />
                    {point.label && (
                      <text
                        x={sx + 7}
                        y={sy - 6}
                        fontSize={11}
                        fill={LABEL_FILL}
                        textAnchor="start"
                      >
                        {point.label}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Solved intersection points, never supplied by the model. */}
              {intersections.map((point, index) => {
                const { sx, sy } = toScreen(point.x, point.y)
                return (
                  <g key={`intersection-${index}`}>
                    <circle cx={sx} cy={sy} r={3} fill={AXIS_STROKE} />
                    <text x={sx + 7} y={sy + 14} fontSize={11} fill={LABEL_FILL}>
                      {`(${formatTick(point.x)}, ${formatTick(point.y)})`}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {showTable && (
          <table className="w-full border-collapse text-[14px]">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b border-border/70 px-3 py-1.5 text-left font-medium text-muted-foreground"
                >
                  x
                </th>
                <th
                  scope="col"
                  className="border-b border-border/70 px-3 py-1.5 text-left font-medium text-muted-foreground"
                >
                  y
                </th>
              </tr>
            </thead>
            <tbody>
              {geometry.points.map((point, index) => (
                <tr key={`row-${index}`}>
                  <td className="border-b border-border/40 px-3 py-1.5 tabular-nums text-foreground">
                    {formatTick(point.x)}
                  </td>
                  <td className="border-b border-border/40 px-3 py-1.5 tabular-nums text-foreground">
                    {formatTick(point.y)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {visualization.caption && (
        <figcaption className="text-center text-[13px] text-muted-foreground">
          {visualization.caption}
        </figcaption>
      )}

      {showLegend && (
        <ul
          aria-label={t('viz.legend')}
          className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground"
        >
          {legendEntries.map(({ expression, index }) => (
            <li key={`legend-${index}`} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4 shrink-0 rounded"
                style={{ backgroundColor: seriesStroke(index) }}
              />
              <MathView latex={expression.latex} />
              {expression.label ? <span>{expression.label}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

function collectIntersections(geometry: PlotGeometry): { x: number; y: number }[] {
  const solvable = geometry.lines.filter((entry) => entry.relation === '=')
  if (solvable.length < 2) return []

  const found: { x: number; y: number }[] = []
  for (let i = 0; i < solvable.length && found.length < MAX_INTERSECTIONS; i++) {
    for (let j = i + 1; j < solvable.length && found.length < MAX_INTERSECTIONS; j++) {
      const point = lineIntersection(solvable[i]!.form, solvable[j]!.form)
      if (!point) continue
      if (
        point.x < geometry.viewport.xMin ||
        point.x > geometry.viewport.xMax ||
        point.y < geometry.viewport.yMin ||
        point.y > geometry.viewport.yMax
      ) {
        continue
      }
      if (
        found.some(
          (other) => Math.abs(other.x - point.x) < 1e-9 && Math.abs(other.y - point.y) < 1e-9,
        )
      ) {
        continue
      }
      found.push(point)
    }
  }
  return found
}
