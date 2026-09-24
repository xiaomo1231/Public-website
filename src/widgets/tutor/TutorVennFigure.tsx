import type { VennVisualization } from '@/entities/tutorVisualization/types'
import {
  applyVennOperation,
  computeVennRegions,
  type VennRegionKey,
} from '@/entities/tutorVisualization/setOperations'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'

/**
 * SVG content for `venn_2d`.
 *
 * Fixed, local geometry (two or three circles). Region membership, the
 * operation result and the highlighted regions all come from the deterministic
 * `setOperations` module; the model supplies no circle coordinates.
 */

const BASE_FILL = 'hsl(var(--card))'
const STROKE = 'hsl(var(--viz-axis))'
const HIGHLIGHT = 'hsl(var(--viz-series-2))'
const LABEL_FILL = 'hsl(var(--viz-label))'
const SET_TEXT = 'hsl(var(--foreground))'

interface Circle {
  cx: number
  cy: number
  r: number
}

interface VennGeometry {
  circles: Circle[]
  anchors: Partial<Record<VennRegionKey, { x: number; y: number }>>
  setLabels: { x: number; y: number }[]
}

function twoSetGeometry(width: number, height: number): VennGeometry {
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(width, height) * 0.28
  const offset = r * 0.55
  return {
    circles: [
      { cx: cx - offset, cy, r },
      { cx: cx + offset, cy, r },
    ],
    anchors: {
      A: { x: cx - offset - r * 0.5, y: cy },
      AB: { x: cx, y: cy },
      B: { x: cx + offset + r * 0.5, y: cy },
      outside: { x: width - 26, y: 22 },
    },
    setLabels: [
      { x: cx - offset, y: cy - r - 8 },
      { x: cx + offset, y: cy - r - 8 },
    ],
  }
}

function threeSetGeometry(width: number, height: number): VennGeometry {
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(width, height) * 0.26
  const d = r * 0.62
  const left = { x: cx - d * 0.866, y: cy + d * 0.5 }
  const right = { x: cx + d * 0.866, y: cy + d * 0.5 }
  return {
    circles: [
      { cx, cy: cy - d, r },
      { cx: left.x, cy: left.y, r },
      { cx: right.x, cy: right.y, r },
    ],
    anchors: {
      A: { x: cx, y: cy - d - r * 0.4 },
      B: { x: left.x - r * 0.4, y: left.y + r * 0.15 },
      C: { x: right.x + r * 0.4, y: right.y + r * 0.15 },
      AB: { x: cx - d * 0.5, y: cy - d * 0.05 },
      AC: { x: cx + d * 0.5, y: cy - d * 0.05 },
      BC: { x: cx, y: cy + d * 0.62 },
      ABC: { x: cx, y: cy - d * 0.08 },
      outside: { x: width - 26, y: 22 },
    },
    setLabels: [
      { x: cx, y: cy - d - r - 8 },
      { x: left.x, y: left.y - r - 8 },
      { x: right.x, y: right.y - r - 8 },
    ],
  }
}

type MaskShape =
  | { kind: 'rect'; fill: 'white' | 'black' }
  | { kind: 'circle'; setIndex: number; fill: 'white' | 'black'; clipBy: number[] }

/** Shapes whose union (white minus black) is exactly one region. */
function regionShapes(regionKey: VennRegionKey, setCount: number): MaskShape[] {
  const rect = (): MaskShape => ({ kind: 'rect', fill: 'white' })
  const circle = (setIndex: number, fill: 'white' | 'black' = 'white', clipBy: number[] = []): MaskShape => ({
    kind: 'circle',
    setIndex,
    fill,
    clipBy,
  })
  const blackOthers = (keep: number[]): MaskShape[] =>
    Array.from({ length: setCount }, (_, index) => index)
      .filter((index) => !keep.includes(index))
      .map((index) => circle(index, 'black'))

  switch (regionKey) {
    case 'A':
      return [circle(0), ...blackOthers([0])]
    case 'B':
      return [circle(1), ...blackOthers([1])]
    case 'C':
      return [circle(2), ...blackOthers([2])]
    case 'AB':
      return [circle(0, 'white', [1]), ...(setCount > 2 ? [circle(2, 'black')] : [])]
    case 'AC':
      return [circle(0, 'white', [2]), ...(setCount > 2 ? [circle(1, 'black')] : [])]
    case 'BC':
      return [circle(1, 'white', [2]), ...(setCount > 2 ? [circle(0, 'black')] : [])]
    case 'ABC':
      return [circle(0, 'white', [1, 2])]
    case 'outside':
      return [rect(), ...Array.from({ length: setCount }, (_, index) => circle(index, 'black'))]
    default:
      return []
  }
}

function regionLabel(elements: string[]): string {
  if (elements.length === 0) return ''
  const joined = elements.join(', ')
  return joined.length <= 14 ? joined : String(elements.length)
}

function operationExpression(
  operation: VennVisualization['operation'],
  labels: string[],
  operandLabels: string[],
): string {
  const symbol =
    operation === 'union'
      ? ' ∪ '
      : operation === 'intersection'
        ? ' ∩ '
        : operation === 'difference'
          ? ' \\ '
          : operation === 'symmetric_difference'
            ? ' △ '
            : ''
  if (operation === 'complement') return `U \\ (${operandLabels.join(' ∪ ')})`
  if (operation === 'display') return labels.join(', ')
  const operands = operandLabels.length > 0 ? operandLabels : labels
  return operands.join(symbol)
}

export interface TutorVennSvgProps {
  visualization: VennVisualization
  layout: PlotLayout
  idBase: string
  t: UseTranslationResult['t']
}

export function TutorVennSvg({
  visualization,
  layout,
  idBase,
  t,
}: TutorVennSvgProps): JSX.Element {
  const width = layout.width
  const height = layout.height
  const sets = visualization.sets
  const regions = computeVennRegions(sets, visualization.universe)
  const { result, highlight } = applyVennOperation(
    visualization.operation,
    sets,
    regions,
    visualization.operands,
  )
  const geometry = sets.length === 2 ? twoSetGeometry(width, height) : threeSetGeometry(width, height)
  const setIndexById = new Map(sets.map((set, index) => [set.id, index]))
  const operandLabels = visualization.operands
    .map((id) => sets[setIndexById.get(id) ?? -1]?.label)
    .filter((label): label is string => Boolean(label))
  const expression = operationExpression(
    visualization.operation,
    sets.map((set) => set.label),
    operandLabels,
  )
  const label = t('viz.vennAria', { count: sets.length })

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
        className="block h-auto w-full max-w-full"
      >
        <title>{label}</title>
        <defs>
          {geometry.circles.map((circle, index) => (
            <clipPath key={`clip-${index}`} id={`venn-clip-${index}-${idBase}`}>
              <circle cx={circle.cx} cy={circle.cy} r={circle.r} />
            </clipPath>
          ))}
          {highlight.map((regionKey) => (
            <mask
              key={`mask-${regionKey}`}
              id={`venn-region-${regionKey}-${idBase}`}
              maskUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={width}
              height={height}
            >
              {regionShapes(regionKey, sets.length).map((shape, shapeIndex) => {
                if (shape.kind === 'rect') {
                  return <rect key={shapeIndex} x={0} y={0} width={width} height={height} fill="white" />
                }
                const circle = geometry.circles[shape.setIndex]
                if (!circle) return null
                let element: JSX.Element = (
                  <circle
                    cx={circle.cx}
                    cy={circle.cy}
                    r={circle.r}
                    fill={shape.fill}
                  />
                )
                for (const clipIndex of shape.clipBy) {
                  element = (
                    <g clipPath={`url(#venn-clip-${clipIndex}-${idBase})`}>{element}</g>
                  )
                }
                return <g key={shapeIndex}>{element}</g>
              })}
            </mask>
          ))}
        </defs>

        {visualization.universe && (
          <rect
            x={6}
            y={6}
            width={width - 12}
            height={height - 12}
            rx={8}
            fill="none"
            stroke={STROKE}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}

        {/* Base circles. */}
        <g aria-hidden="true">
          {geometry.circles.map((circle, index) => (
            <circle
              key={`base-${index}`}
              cx={circle.cx}
              cy={circle.cy}
              r={circle.r}
              fill={BASE_FILL}
              stroke={STROKE}
              strokeWidth={1.5}
            />
          ))}
        </g>

        {/* Highlighted regions (one masked rect per region, so overlaps never
            double-fill). */}
        <g aria-hidden="true">
          {highlight.map((regionKey) => (
            <rect
              key={`hl-${regionKey}`}
              x={0}
              y={0}
              width={width}
              height={height}
              fill={HIGHLIGHT}
              opacity={0.2}
              mask={`url(#venn-region-${regionKey}-${idBase})`}
            />
          ))}
        </g>

        {/* Region element labels. */}
        <g aria-hidden="true">
          {Object.entries(regions).map(([regionKey, elements]) => {
            const text = regionLabel(elements)
            if (!text) return null
            const anchor = geometry.anchors[regionKey as VennRegionKey]
            if (!anchor) return null
            return (
              <text
                key={`region-${regionKey}`}
                x={anchor.x}
                y={anchor.y}
                textAnchor="middle"
                fontSize={12}
                fill={LABEL_FILL}
              >
                {text}
              </text>
            )
          })}
        </g>

        {/* Set labels. */}
        <g aria-hidden="true">
          {sets.map((set, index) => {
            const position = geometry.setLabels[index]
            if (!position) return null
            return (
              <text
                key={`set-${set.id}`}
                x={position.x}
                y={position.y}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                fill={SET_TEXT}
                stroke={BASE_FILL}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {set.label}
              </text>
            )
          })}
        </g>
      </svg>

      <div className="sr-only">
        <p>{label}</p>
        <p>{expression}</p>
        {sets.map((set) => (
          <p key={set.id}>
            {t('viz.vennSetLabel', { label: set.label, elements: set.elements.join(', ') || '∅' })}
          </p>
        ))}
        <p>{t('viz.vennResultLabel', { result: result.join(', ') || '∅' })}</p>
      </div>
    </>
  )
}
