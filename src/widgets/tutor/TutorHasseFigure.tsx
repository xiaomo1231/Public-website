import type { HasseVisualization } from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'

const EDGE = 'hsl(var(--viz-axis))'
const NODE_FILL = 'hsl(var(--card))'
const NODE_STROKE = 'hsl(var(--viz-series-2))'
const TEXT = 'hsl(var(--foreground))'

/** Deterministic layered SVG for a locally validated finite poset. */
export function TutorHasseSvg({
  visualization,
  layout,
  t,
}: {
  visualization: HasseVisualization
  layout: PlotLayout
  t: UseTranslationResult['t']
}): JSX.Element {
  const rank = new Map(visualization.elements.map(({ id }) => [id, 0]))
  const ordered = [...visualization.elements]
  // Covers are acyclic; repeated relaxation computes longest-path ranks and
  // keeps every cover pointing upward, including non-graded posets.
  for (let pass = 0; pass < ordered.length; pass++) {
    let changed = false
    for (const { lower, upper } of visualization.relations) {
      const next = (rank.get(lower) ?? 0) + 1
      if ((rank.get(upper) ?? 0) < next) {
        rank.set(upper, next)
        changed = true
      }
    }
    if (!changed) break
  }
  const levels = new Map<number, typeof ordered>()
  for (const element of ordered) {
    const level = rank.get(element.id) ?? 0
    const items = levels.get(level) ?? []
    items.push(element)
    levels.set(level, items)
  }
  const maxRank = Math.max(0, ...levels.keys())
  const padX = Math.max(layout.pad.left, 36)
  const padY = Math.max(layout.pad.top, 30)
  const radius = Math.min(19, Math.max(13, Math.floor(220 / ordered.length)))
  const positions = new Map<string, { x: number; y: number }>()
  for (const [level, items] of levels) {
    const y = layout.height - padY - (maxRank === 0 ? 0 : (level / maxRank) * (layout.height - 2 * padY))
    items.forEach((item, index) => {
      positions.set(item.id, {
        x: padX + ((index + 1) / (items.length + 1)) * (layout.width - 2 * padX),
        y,
      })
    })
  }
  const label = t('viz.hasseAria', { count: ordered.length, covers: visualization.relations.length })
  const names = new Map(ordered.map(({ id, label: name }) => [id, name]))
  const edgeSummary = visualization.relations
    .map(({ lower, upper }) => `${names.get(lower)} < ${names.get(upper)}`)
    .join('; ')

  return (
    <>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
        <title>{label}</title>
        <g aria-hidden="true">
          {visualization.relations.map(({ lower, upper }, index) => {
            const from = positions.get(lower)!
            const to = positions.get(upper)!
            return <line key={`cover-${index}`} x1={from.x} y1={from.y - radius} x2={to.x} y2={to.y + radius} stroke={EDGE} strokeWidth="1.6" />
          })}
          {ordered.map(({ id, label: name }) => {
            const point = positions.get(id)!
            const text = name.length > 14 ? `${name.slice(0, 13)}…` : name
            return (
              <g key={id}>
                <circle cx={point.x} cy={point.y} r={radius} fill={NODE_FILL} stroke={NODE_STROKE} strokeWidth="1.7" />
                <text x={point.x} y={point.y + 4} textAnchor="middle" fontSize="11" fill={TEXT}>{text}</text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="sr-only"><p>{label}</p><p>{edgeSummary}</p></div>
    </>
  )
}
