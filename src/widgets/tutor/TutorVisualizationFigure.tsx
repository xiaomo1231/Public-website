import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  Matrix2x2,
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
import { computeVectorViewport, vectorEnd, vectorStart } from '@/entities/tutorVisualization/vector'
import {
  applyMatrix,
  computeTransform,
  computeTransformViewport,
  type TransformGeometry,
} from '@/entities/tutorVisualization/transform'
import { computeEigenViewport, type EigenPair } from '@/entities/tutorVisualization/eigen'
import { useTranslation, type UseTranslationResult, type TranslationKey } from '@/i18n'
import { Math as MathView } from '@/shared/ui/Math'
import { layoutForWidth } from './plotLayout'
import { TutorGraphSvg } from './TutorGraphFigure'
import { TutorVennSvg } from './TutorVennFigure'

/**
 * The single deterministic renderer for structured 2D visualizations.
 *
 * It draws only what the maths says: a line is derived from its relation, a
 * shaded region from the inequality, intersection points are solved, vectors
 * from their components, and a graph from a local layout. The model never
 * supplies coordinates. It is a pure function of (data, viewport, theme): no
 * AI, no network, no randomness.
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

/**
 * Zero-based colour slot for a vector role, fed to `seriesStroke` (which is
 * itself zero-based) and to the arrow marker id (`slot + 1`). Keeping both on
 * the same basis is what makes the line and its arrowhead the same colour.
 */
function vectorColorSlot(role: string | undefined): number {
  if (role === 'result') return 1
  if (role === 'basis') return 2
  if (role === 'component') return 3
  return 0
}

const VECTOR_ROLE_KEYS: Record<string, TranslationKey> = {
  basis: 'viz.roleBasis',
  component: 'viz.roleComponent',
  result: 'viz.roleResult',
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

interface VectorEntry {
  id: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  role: string
  highlighted: boolean
  label?: string
  index: number
}

interface EigenGeometry {
  pairs: EigenPair[]
  fullEigenspace: boolean
  defective: boolean
}

interface PlotGeometry {
  lines: LineEntry[]
  curves: CurveEntry[]
  vectors: VectorEntry[]
  points: VisualizationPoint[]
  connect: boolean
  viewport: VisualizationViewport
  transform?: TransformGeometry
  eigen?: EigenGeometry
}

function buildGeometry(visualization: TutorVisualization, aspect: number): PlotGeometry | null {
  // graph_2d and venn_2d have their own content renderers.
  if (visualization.type === 'graph_2d' || visualization.type === 'venn_2d') return null

  if (visualization.type === 'transform_2d') {
    const viewport =
      visualization.viewport ??
      computeTransformViewport(visualization.matrix, visualization.vectors)
    return {
      lines: [],
      curves: [],
      vectors: [],
      points: [],
      connect: false,
      viewport: fitViewport(viewport, aspect),
      transform: computeTransform(visualization.matrix, visualization.vectors),
    }
  }

  if (visualization.type === 'eigen_2d') {
    // Every stored eigenpair was computed and verified locally; `Av` is simply
    // `λ·v`, so the transformed vector is never taken from the model.
    const pairs: EigenPair[] = visualization.eigenpairs.map((pair) => ({
      value: pair.value,
      vector: { x: pair.vector.x, y: pair.vector.y },
      transformed: { x: pair.value * pair.vector.x, y: pair.value * pair.vector.y },
      ...(pair.label ? { label: pair.label } : {}),
    }))
    if (pairs.length === 0) return null
    const viewport =
      visualization.viewport ?? computeEigenViewport(pairs, visualization.showUnitCircle)
    return {
      lines: [],
      curves: [],
      vectors: [],
      points: [],
      connect: false,
      viewport: fitViewport(viewport, aspect),
      eigen: {
        pairs,
        fullEigenspace: visualization.fullEigenspace,
        defective: visualization.defective,
      },
    }
  }

  if (visualization.type === 'points_2d' || visualization.type === 'table_2d') {
    const points = visualization.points
    if (points.length === 0) return null
    const viewport = visualization.viewport ?? computeAutoViewport([], points)
    return {
      lines: [],
      curves: [],
      vectors: [],
      points,
      connect: visualization.connect === true,
      viewport: fitViewport(viewport, aspect),
    }
  }

  if (visualization.type === 'vectors_2d') {
    const vectors: VectorEntry[] = visualization.vectors.map((vector, index) => ({
      id: vector.id,
      start: vectorStart(vector),
      end: vectorEnd(vector),
      role: vector.role ?? 'vector',
      highlighted: vector.highlighted === true,
      ...(vector.label ? { label: vector.label } : {}),
      index,
    }))
    if (vectors.length === 0) return null
    const viewport = visualization.viewport ?? computeVectorViewport(visualization.vectors)
    return {
      lines: [],
      curves: [],
      vectors,
      points: [],
      connect: false,
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

  return { lines, curves, vectors: [], points: [], connect: false, viewport }
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

function transformGridLines(
  matrix: Matrix2x2,
  viewport: VisualizationViewport,
  xTicks: number[],
  yTicks: number[],
): { from: { x: number; y: number }; to: { x: number; y: number } }[] {
  const lines: { from: { x: number; y: number }; to: { x: number; y: number } }[] = []
  for (const tick of xTicks) {
    lines.push({
      from: applyMatrix(matrix, { x: tick, y: viewport.yMin }),
      to: applyMatrix(matrix, { x: tick, y: viewport.yMax }),
    })
  }
  for (const tick of yTicks) {
    lines.push({
      from: applyMatrix(matrix, { x: viewport.xMin, y: tick }),
      to: applyMatrix(matrix, { x: viewport.xMax, y: tick }),
    })
  }
  return lines
}

function transformFactLine(transform: TransformGeometry, t: UseTranslationResult['t']): string {
  if (transform.degenerate) return t('viz.transformDegenerate')
  return [
    t('viz.transformDeterminant', { value: formatTick(transform.determinant) }),
    t('viz.transformArea', { area: formatTick(transform.areaScale) }),
    transform.orientationFlipped
      ? t('viz.transformOrientationReversed')
      : t('viz.transformOrientationPreserved'),
  ].join(' · ')
}

function buildAriaLabel(visualization: TutorVisualization, t: UseTranslationResult['t']): string {
  if (visualization.type === 'points_2d') {
    const points = visualization.points
      .map((point) => `(${formatTick(point.x)}, ${formatTick(point.y)})`)
      .join(', ')
    return t('viz.ariaPoints', { points })
  }
  if (visualization.type === 'table_2d') return t('viz.ariaTable')
  if (visualization.type === 'vectors_2d') {
    return t('viz.vectorsAria', { count: visualization.vectors.length })
  }
  // graph_2d / venn_2d build their own accessible labels.
  if (visualization.type === 'graph_2d' || visualization.type === 'venn_2d') return ''
  if (visualization.type === 'transform_2d') return t('viz.transformAria')
  if (visualization.type === 'eigen_2d') return t('viz.eigenAria')
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
  const idBase = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const clipId = `viz-clip-${idBase}`

  const cardRef = useRef<HTMLDivElement>(null)
  const measured = useMeasuredWidth(cardRef)
  const layout = useMemo(() => layoutForWidth(measured), [measured])
  const plotW = layout.width - layout.pad.left - layout.pad.right
  const plotH = layout.height - layout.pad.top - layout.pad.bottom
  const aspect = plotW / plotH

  const hasOwnRenderer = visualization.type === 'graph_2d' || visualization.type === 'venn_2d'
  const geometry = useMemo(
    () => (hasOwnRenderer ? null : buildGeometry(visualization, aspect)),
    [visualization, aspect, hasOwnRenderer],
  )
  const label = useMemo(
    () => (hasOwnRenderer ? '' : buildAriaLabel(visualization, t)),
    [visualization, t, hasOwnRenderer],
  )

  // graph_2d / venn_2d have their own content renderers (same viewBox and tokens).
  if (visualization.type === 'graph_2d') {
    return (
      <figure data-tutor-visualization={visualization.id} className="my-5 min-w-0 space-y-2">
        <div
          ref={cardRef}
          className="w-full max-w-full overflow-hidden rounded-md border border-border/70 bg-card p-2"
        >
          <TutorGraphSvg visualization={visualization} layout={layout} idBase={idBase} t={t} />
        </div>
        {visualization.caption && (
          <figcaption className="text-center text-[13px] text-muted-foreground">
            {visualization.caption}
          </figcaption>
        )}
      </figure>
    )
  }

  if (visualization.type === 'venn_2d') {
    return (
      <figure data-tutor-visualization={visualization.id} className="my-5 min-w-0 space-y-2">
        <div
          ref={cardRef}
          className="w-full max-w-full overflow-hidden rounded-md border border-border/70 bg-card p-2"
        >
          <TutorVennSvg visualization={visualization} layout={layout} idBase={idBase} t={t} />
        </div>
        {visualization.caption && (
          <figcaption className="text-center text-[13px] text-muted-foreground">
            {visualization.caption}
          </figcaption>
        )}
      </figure>
    )
  }

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
  const originScreen = toScreen(0, 0)
  const unitRadius = Math.abs(toScreen(1, 0).sx - originScreen.sx)

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

  const vectorEntries = geometry.vectors
  const showVectorLegend = vectorEntries.length > 1

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
                <rect x={layout.pad.left} y={layout.pad.top} width={plotW} height={plotH} />
              </clipPath>
              {[1, 2, 3, 4].map((slot) => (
                <marker
                  key={`varrow-${slot}`}
                  id={`viz-varrow-${slot}-${idBase}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={`hsl(var(--viz-series-${slot}))`} />
                </marker>
              ))}
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

              {/* transform_2d: original objects are dashed, images are solid
                  and filled, so the two are never distinguished by colour only. */}
              {geometry.transform && visualization.type === 'transform_2d' && (
                <g>
                  {visualization.showGrid &&
                    transformGridLines(visualization.matrix, viewport, xTicks, yTicks).map(
                      (line, index) => {
                        const a = toScreen(line.from.x, line.from.y)
                        const b = toScreen(line.to.x, line.to.y)
                        return (
                          <line
                            key={`tgrid-${index}`}
                            x1={a.sx}
                            y1={a.sy}
                            x2={b.sx}
                            y2={b.sy}
                            stroke={GRID_STROKE}
                            strokeWidth={1}
                          />
                        )
                      },
                    )}

                  {visualization.showUnitSquare && (
                    <>
                      <polygon
                        points={geometry.transform.unitSquare
                          .map((point) => {
                            const screen = toScreen(point.x, point.y)
                            return `${screen.sx.toFixed(2)},${screen.sy.toFixed(2)}`
                          })
                          .join(' ')}
                        fill="none"
                        stroke={AXIS_STROKE}
                        strokeWidth={1.5}
                        strokeDasharray="5 4"
                      />
                      <polygon
                        points={geometry.transform.transformedSquare
                          .map((point) => {
                            const screen = toScreen(point.x, point.y)
                            return `${screen.sx.toFixed(2)},${screen.sy.toFixed(2)}`
                          })
                          .join(' ')}
                        fill={FILL}
                        stroke={seriesStroke(1)}
                        strokeWidth={2}
                      />
                    </>
                  )}

                  {visualization.showBasis &&
                    geometry.transform.basis.map((entry, index) => {
                      const origin = toScreen(0, 0)
                      const original = toScreen(entry.original.x, entry.original.y)
                      const image = toScreen(entry.transformed.x, entry.transformed.y)
                      return (
                        <g key={`basis-${index}`}>
                          <line
                            x1={origin.sx}
                            y1={origin.sy}
                            x2={original.sx}
                            y2={original.sy}
                            stroke={AXIS_STROKE}
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                          />
                          <line
                            x1={origin.sx}
                            y1={origin.sy}
                            x2={image.sx}
                            y2={image.sy}
                            stroke={seriesStroke(1)}
                            strokeWidth={2}
                            markerEnd={`url(#viz-varrow-2-${idBase})`}
                          />
                        </g>
                      )
                    })}

                  {geometry.transform.vectors.map((vector, index) => {
                    const origin = toScreen(0, 0)
                    const original = toScreen(vector.original.x, vector.original.y)
                    const image = toScreen(vector.transformed.x, vector.transformed.y)
                    return (
                      <g key={`tvec-${index}`}>
                        <line
                          x1={origin.sx}
                          y1={origin.sy}
                          x2={original.sx}
                          y2={original.sy}
                          stroke={seriesStroke(2)}
                          strokeWidth={2}
                          strokeDasharray="5 4"
                        />
                        <line
                          x1={origin.sx}
                          y1={origin.sy}
                          x2={image.sx}
                          y2={image.sy}
                          stroke={seriesStroke(2)}
                          strokeWidth={2.5}
                          markerEnd={`url(#viz-varrow-3-${idBase})`}
                        />
                        {vector.label && (
                          <text
                            x={original.sx + 6}
                            y={original.sy - 6}
                            fontSize={12}
                            fill={LABEL_FILL}
                          >
                            {vector.label}
                          </text>
                        )}
                        {vector.label && (
                          <text x={image.sx + 6} y={image.sy - 6} fontSize={12} fill={LABEL_FILL}>
                            {`${vector.label}′`}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </g>
              )}

              {/* eigen_2d: the original eigenvector is dashed, its image
                  Av = λv is solid with an arrowhead, and a reference line runs
                  along the whole eigen-direction, so direction and scaling are
                  readable without relying on colour. */}
              {geometry.eigen && visualization.type === 'eigen_2d' && (
                <g>
                  {visualization.showUnitCircle && unitRadius > 0 && (
                    <circle
                      cx={originScreen.sx}
                      cy={originScreen.sy}
                      r={unitRadius}
                      fill="none"
                      stroke={GRID_STROKE}
                      strokeWidth={1}
                      strokeDasharray="3 4"
                    />
                  )}
                  {geometry.eigen.pairs.map((pair, index) => {
                    const v = toScreen(pair.vector.x, pair.vector.y)
                    const negV = toScreen(-pair.vector.x, -pair.vector.y)
                    const image = toScreen(pair.transformed.x, pair.transformed.y)
                    const baseLabel =
                      pair.label ?? (geometry.eigen!.pairs.length > 1 ? `v${index + 1}` : 'v')
                    const mapsToOrigin = Math.abs(pair.value) < 1e-9
                    return (
                      <g key={`eigen-${index}`}>
                        <line
                          x1={negV.sx}
                          y1={negV.sy}
                          x2={v.sx}
                          y2={v.sy}
                          stroke={AXIS_STROKE}
                          strokeWidth={1}
                          strokeDasharray="5 4"
                        />
                        <line
                          x1={originScreen.sx}
                          y1={originScreen.sy}
                          x2={v.sx}
                          y2={v.sy}
                          stroke={seriesStroke(0)}
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          markerEnd={`url(#viz-varrow-1-${idBase})`}
                        />
                        {visualization.showTransform && !mapsToOrigin && (
                          <line
                            x1={originScreen.sx}
                            y1={originScreen.sy}
                            x2={image.sx}
                            y2={image.sy}
                            stroke={seriesStroke(1)}
                            strokeWidth={2.5}
                            markerEnd={`url(#viz-varrow-2-${idBase})`}
                          />
                        )}
                        {mapsToOrigin && (
                          <circle
                            cx={originScreen.sx}
                            cy={originScreen.sy}
                            r={4}
                            fill={seriesStroke(1)}
                          />
                        )}
                        <text
                          x={v.sx + 7}
                          y={v.sy - 7}
                          fontSize={12}
                          fill={LABEL_FILL}
                          textAnchor="start"
                        >
                          {baseLabel}
                        </text>
                        {visualization.showTransform && !mapsToOrigin && (
                          <text
                            x={image.sx + 7}
                            y={image.sy - 7}
                            fontSize={12}
                            fill={LABEL_FILL}
                            textAnchor="start"
                          >
                            {`A${baseLabel}`}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </g>
              )}

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

              {/* Vectors: arrows from `start` (default origin) to `start + v`.
                  The endpoint is always computed locally. */}
              {vectorEntries.map((entry) => {
                const a = toScreen(entry.start.x, entry.start.y)
                const b = toScreen(entry.end.x, entry.end.y)
                if (Math.hypot(b.sx - a.sx, b.sy - a.sy) < 0.5) return null
                const slot = vectorColorSlot(entry.role)
                const emphasized = entry.highlighted || entry.role === 'result'
                const dash =
                  entry.role === 'basis'
                    ? '6 4'
                    : entry.role === 'component'
                      ? '2 3'
                      : undefined
                return (
                  <g key={`vector-${entry.index}`}>
                    {entry.role === 'component' && entry.start.x === 0 && entry.start.y === 0 && (
                      <g stroke={seriesStroke(slot)} strokeWidth={1} strokeDasharray="2 3" opacity={0.55}>
                        <line x1={b.sx} y1={b.sy} x2={b.sx} y2={axisX.sy} />
                        <line x1={b.sx} y1={b.sy} x2={axisY.sx} y2={b.sy} />
                      </g>
                    )}
                    <line
                      x1={a.sx}
                      y1={a.sy}
                      x2={b.sx}
                      y2={b.sy}
                      stroke={seriesStroke(slot)}
                      strokeWidth={emphasized ? 3 : 2}
                      strokeLinecap="round"
                      markerEnd={`url(#viz-varrow-${slot + 1}-${idBase})`}
                      {...(dash ? { strokeDasharray: dash } : {})}
                    />
                    {entry.label && (
                      <text
                        x={b.sx + 7}
                        y={b.sy - 7}
                        fontSize={12}
                        fill={LABEL_FILL}
                        textAnchor="start"
                      >
                        {entry.label}
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

      {visualization.type === 'transform_2d' && geometry.transform && (
        <div className="space-y-1 text-center text-[13px] text-muted-foreground">
          <MathView
            latex={`A = \\begin{bmatrix} ${formatTick(visualization.matrix.a)} & ${formatTick(visualization.matrix.b)} \\\\ ${formatTick(visualization.matrix.c)} & ${formatTick(visualization.matrix.d)} \\end{bmatrix}`}
          />
          <p>{transformFactLine(geometry.transform, t)}</p>
        </div>
      )}

      {visualization.type === 'eigen_2d' && geometry.eigen && (
        <div className="space-y-1 text-center text-[13px] text-muted-foreground">
          <MathView
            latex={`A = \\begin{bmatrix} ${formatTick(visualization.matrix.a)} & ${formatTick(visualization.matrix.b)} \\\\ ${formatTick(visualization.matrix.c)} & ${formatTick(visualization.matrix.d)} \\end{bmatrix}`}
          />
          <ul
            aria-label={t('viz.legend')}
            className="flex flex-wrap justify-center gap-x-4 gap-y-1.5"
          >
            {geometry.eigen.pairs.map((pair, index) => {
              const name =
                pair.label ?? (geometry.eigen!.pairs.length > 1 ? `v${index + 1}` : 'v')
              return (
                <li key={`eigen-legend-${index}`} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-0.5 w-4 shrink-0 rounded"
                    style={{ backgroundColor: seriesStroke(1) }}
                  />
                  <span className="font-medium text-foreground">{name}</span>
                  <span className="tabular-nums">
                    {t('viz.eigenValue', { value: formatTick(pair.value) })}
                  </span>
                  <span className="tabular-nums">
                    {`A${name} = (${formatTick(pair.transformed.x)}, ${formatTick(pair.transformed.y)})`}
                  </span>
                </li>
              )
            })}
          </ul>
          {geometry.eigen.fullEigenspace && <p>{t('viz.eigenFullEigenspace')}</p>}
          {geometry.eigen.defective && <p>{t('viz.eigenDefective')}</p>}
          {geometry.eigen.pairs.some((pair) => Math.abs(pair.value) < 1e-9) && (
            <p>{t('viz.eigenZero')}</p>
          )}
        </div>
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

      {showVectorLegend && (
        <ul
          aria-label={t('viz.legend')}
          className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground"
        >
          {vectorEntries.map((entry) => (
            <li key={`vector-legend-${entry.index}`} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-4 shrink-0 rounded"
                style={{ backgroundColor: seriesStroke(vectorColorSlot(entry.role)) }}
              />
              {entry.label ? <span className="font-medium text-foreground">{entry.label}</span> : null}
              <span className="tabular-nums">
                ({formatTick(entry.end.x - entry.start.x)}, {formatTick(entry.end.y - entry.start.y)})
              </span>
              {VECTOR_ROLE_KEYS[entry.role] ? (
                <span>· {t(VECTOR_ROLE_KEYS[entry.role]!)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {visualization.type === 'vectors_2d' && (
        <div className="sr-only">
          <p>{label}</p>
          <p>
            {t('viz.vectorsList', {
              vectors: vectorEntries
                .map((entry) => {
                  const components = `(${formatTick(entry.end.x - entry.start.x)}, ${formatTick(entry.end.y - entry.start.y)})`
                  return entry.label ? `${entry.label} ${components}` : components
                })
                .join(', '),
            })}
          </p>
        </div>
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
