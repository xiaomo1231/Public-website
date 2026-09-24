import type { GraphVisualization } from '@/entities/tutorVisualization/types'
import { layoutGraph } from '@/entities/tutorVisualization/graph'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'

/**
 * SVG content for `graph_2d`.
 *
 * This is a *content* renderer, not a second plotting engine: it shares the
 * responsive viewBox from `plotLayout`, the `--viz-*` theme tokens and the
 * figure shell owned by `TutorVisualizationFigure`. All coordinates come from
 * the deterministic local `layoutGraph`; the model supplies no geometry.
 */

const NODE_STROKE = 'hsl(var(--viz-axis))'
const NODE_FILL = 'hsl(var(--card))'
const NODE_TEXT = 'hsl(var(--foreground))'
const HIGHLIGHT = 'hsl(var(--viz-series-2))'
const EDGE_STROKE = 'hsl(var(--viz-axis))'
const LABEL_FILL = 'hsl(var(--viz-label))'

function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`
}

export interface TutorGraphSvgProps {
  visualization: GraphVisualization
  layout: PlotLayout
  idBase: string
  t: UseTranslationResult['t']
}

export function TutorGraphSvg({
  visualization,
  layout,
  idBase,
  t,
}: TutorGraphSvgProps): JSX.Element {
  const graph = layoutGraph({
    nodes: visualization.nodes,
    edges: visualization.edges,
    layout: visualization.layout,
    ...(visualization.rootId ? { rootId: visualization.rootId } : {}),
    width: layout.width,
    height: layout.height,
    pad: layout.pad,
  })

  const arrowId = `viz-arrow-${idBase}`
  const arrowHighlightId = `viz-arrow-hi-${idBase}`
  const directed = visualization.graphKind === 'directed'
  const kindLabel = directed ? t('viz.graphDirected') : t('viz.graphUndirected')
  const label = t('viz.graphAria', {
    kind: kindLabel,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  })

  const nodeSummary = graph.nodes.map((node) => node.label).join(', ')
  const edgeSummary = graph.edges
    .map((edge) => {
      const source = graph.nodes.find((node) => node.id === edge.source)?.label ?? edge.source
      const target = graph.nodes.find((node) => node.id === edge.target)?.label ?? edge.target
      const arrow = edge.directed ? '→' : '—'
      const detail = edge.label ?? (edge.weight !== undefined ? String(edge.weight) : '')
      return `${source} ${arrow} ${target}${detail ? ` (${detail})` : ''}`
    })
    .join('; ')

  return (
    <>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
        className="block h-auto w-full max-w-full"
      >
        <title>{label}</title>
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_STROKE} />
          </marker>
          <marker
            id={arrowHighlightId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={HIGHLIGHT} />
          </marker>
        </defs>

        {/* Edges (under the nodes). */}
        <g aria-hidden="true">
          {graph.edges.map((edge, index) => {
            const stroke = edge.highlighted ? HIGHLIGHT : EDGE_STROKE
            const marker = edge.directed
              ? `url(#${edge.highlighted ? arrowHighlightId : arrowId})`
              : undefined
            if (edge.selfLoop) {
              const radius = graph.nodes.find((node) => node.id === edge.source)?.radius ?? 12
              const x = edge.from.x
              const y = edge.from.y
              const path = `M ${x} ${y} C ${x + radius * 2.4} ${y - radius * 3} ${x - radius * 2.4} ${y - radius * 3} ${x} ${y}`
              return (
                <path
                  key={`edge-${index}`}
                  d={path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={edge.highlighted ? 2.5 : 1.6}
                  {...(marker ? { markerEnd: marker } : {})}
                />
              )
            }
            return (
              <line
                key={`edge-${index}`}
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                stroke={stroke}
                strokeWidth={edge.highlighted ? 2.5 : 1.6}
                {...(marker ? { markerEnd: marker } : {})}
              />
            )
          })}
        </g>

        {/* Nodes. */}
        <g aria-hidden="true">
          {graph.nodes.map((node) => {
            const fontSize = Math.max(9, Math.round(node.radius * 0.62))
            const available = node.radius * 1.8
            const maxChars = Math.max(2, Math.floor(available / (fontSize * 0.6)))
            const text = truncateLabel(node.label, maxChars)
            // Any truncated label is compressed to the node's inner width so it
            // can never spill outside the circle.
            const truncated = text !== node.label
            return (
              <g key={node.id}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill={NODE_FILL}
                  stroke={node.highlighted ? HIGHLIGHT : NODE_STROKE}
                  strokeWidth={node.highlighted ? 3 : 1.5}
                />
                <text
                  x={node.x}
                  y={node.y + fontSize * 0.35}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fill={NODE_TEXT}
                  {...(truncated
                    ? { textLength: available, lengthAdjust: 'spacingAndGlyphs' as const }
                    : {})}
                >
                  {text}
                </text>
              </g>
            )
          })}
        </g>

        {/* Edge labels / weights, drawn last with a halo so they stay readable. */}
        <g aria-hidden="true">
          {graph.edges.map((edge, index) => {
            const text = edge.label ?? (edge.weight !== undefined ? String(edge.weight) : '')
            if (!text) return null
            return (
              <text
                key={`edge-label-${index}`}
                x={edge.labelX}
                y={edge.labelY - 4}
                textAnchor="middle"
                fontSize={11}
                fill={LABEL_FILL}
                stroke={NODE_FILL}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {text}
              </text>
            )
          })}
        </g>
      </svg>

      {/* Structured text alternative for screen readers. */}
      <div className="sr-only">
        <p>{label}</p>
        <p>{t('viz.graphNodesLabel', { nodes: nodeSummary })}</p>
        {edgeSummary ? <p>{t('viz.graphEdgesLabel', { edges: edgeSummary })}</p> : null}
      </div>
    </>
  )
}
