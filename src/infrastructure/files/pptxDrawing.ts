/**
 * Diagrams drawn with PowerPoint shapes (a supply / demand graph made of
 * connectors, a few short text boxes as axis labels and curve names).
 *
 * Without this, every label of the drawing ("Price", "$5", "Old supply
 * curve", "2000") leaks into the slide text as one-word lines. Here the slide's
 * drawing primitives are clustered by position; the short text boxes that sit
 * inside a cluster (or share its group) become that figure's labels and are
 * removed from the body text. Each figure is described in one structured,
 * deterministic caption — what the file says, nothing inferred:
 *
 *   [图：2 条实线（红 Old supply curve、紫 New supply curve），坐标轴 2，虚线辅助线 5，箭头 1，标签：Price、$5、…]
 *
 * Pure functions on a flat element list (absolute slide coordinates in
 * points), so the rules are testable without a .pptx.
 */

export interface DrawingBox {
  x: number
  y: number
  w: number
  h: number
}

export type DrawingElementKind = 'line' | 'arrow' | 'shape' | 'text'

export interface DrawingElement {
  /** Index in the slide's reading (XML) order. */
  index: number
  kind: DrawingElementKind
  box: DrawingBox
  /** Text of a text box / shape with text. */
  text?: string
  /** A placeholder (title / body) — never a diagram label. */
  placeholder?: boolean
  /** Outline dashed (`a:prstDash` other than solid). */
  dashed?: boolean
  /** Outline colour, `RRGGBB`, when written as an sRGB value. */
  color?: string
  /** Arrow head at either end. */
  arrowHead?: boolean
  /** `flipH` xor `flipV`: the line runs from top-right to bottom-left. */
  flipped?: boolean
  /** Free-form path (a curve) rather than a straight segment. */
  curve?: boolean
  /** Index of the top-level group (`p:grpSp`) the element belongs to. */
  group?: number
}

export interface DrawingFigure {
  /** Indexes of the text elements used as labels (removed from the body). */
  labelIndexes: number[]
  /** Reading-order position: the first element of the figure. */
  index: number
  caption: string
}

/** A label is short: a word, a value, a curve name, an axis title. */
const MAX_LABEL_CHARS = 80
const MAX_LABEL_LINES = 3
/** Lines thinner than this (points) are axis-aligned. */
const AXIS_TOLERANCE = 2

export function isLabelText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_LABEL_CHARS) return false
  if (trimmed.split('\n').length > MAX_LABEL_LINES) return false
  // A sentence (ends with a full stop and has several words) is body text.
  const words = trimmed.split(/\s+/).length
  return !(words >= 8 && /[.!?。！？]$/.test(trimmed))
}

function expand(box: DrawingBox, margin: number): DrawingBox {
  return { x: box.x - margin, y: box.y - margin, w: box.w + 2 * margin, h: box.h + 2 * margin }
}

function intersects(a: DrawingBox, b: DrawingBox): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
}

function union(a: DrawingBox, b: DrawingBox): DrawingBox {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

function center(box: DrawingBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

function contains(box: DrawingBox, point: { x: number; y: number }): boolean {
  return (
    point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h
  )
}

function segment(el: DrawingElement): [number, number, number, number] {
  const { x, y, w, h } = el.box
  return el.flipped ? [x + w, y, x, y + h] : [x, y, x + w, y + h]
}

function distanceToSegment(point: { x: number; y: number }, el: DrawingElement): number {
  if (el.curve) {
    // A curve: distance to its bounding box.
    const { x, y, w, h } = el.box
    const dx = Math.max(x - point.x, 0, point.x - (x + w))
    const dy = Math.max(y - point.y, 0, point.y - (y + h))
    return Math.hypot(dx, dy)
  }
  const [x1, y1, x2, y2] = segment(el)
  const vx = x2 - x1
  const vy = y2 - y1
  const length = vx * vx + vy * vy
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - x1) * vx + (point.y - y1) * vy) / length))
  return Math.hypot(point.x - (x1 + t * vx), point.y - (y1 + t * vy))
}

/** A short Chinese colour name for an sRGB hex value (never guessed for theme colours). */
export function colorName(hex: string | undefined): string | undefined {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const saturation =
    max === min ? 0 : lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
  if (saturation < 0.2 || max - min < 0.12) {
    if (lightness < 0.2) return '黑'
    if (lightness > 0.9) return '白'
    return '灰'
  }
  let hue = 0
  if (max === r) hue = ((g - b) / (max - min)) % 6
  else if (max === g) hue = (b - r) / (max - min) + 2
  else hue = (r - g) / (max - min) + 4
  hue = (hue * 60 + 360) % 360
  if (hue < 15 || hue >= 345) return '红'
  if (hue < 45) return '橙'
  if (hue < 70) return '黄'
  if (hue < 165) return '绿'
  if (hue < 195) return '青'
  if (hue < 255) return '蓝'
  if (hue < 300) return '紫'
  return '粉'
}

function isAxisAligned(el: DrawingElement): boolean {
  return !el.curve && (el.box.w <= AXIS_TOLERANCE || el.box.h <= AXIS_TOLERANCE)
}

/** A label that names something (has letters), not a tick value like `$5` or `2000`. */
function isNameLabel(text: string): boolean {
  return /[A-Za-z一-鿿]{2,}/.test(text) && !/^\$?\s*[\d.,]+\s*%?$/.test(text)
}

function compactLabel(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find the diagrams on a slide and describe each. Elements not used as labels
 * stay body text. A cluster needs at least two drawn lines / curves to count
 * as a diagram (one decorative rule is not a figure).
 */
export function describeDrawings(elements: readonly DrawingElement[]): DrawingFigure[] {
  // Empty shapes count only when small (a dot marking an equilibrium); a large
  // empty rectangle is a background or frame and would swallow the slide.
  const primitives = elements.filter(
    (el) =>
      el.kind === 'line' ||
      el.kind === 'arrow' ||
      (el.kind === 'shape' && !el.text && el.box.w <= 40 && el.box.h <= 40),
  )
  if (primitives.filter((el) => el.kind === 'line').length < 2) return []

  // Union-find over primitives: overlapping (with a small margin) or grouped.
  const parent = primitives.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const join = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < primitives.length; i++) {
    for (let j = i + 1; j < primitives.length; j++) {
      const a = primitives[i]!
      const b = primitives[j]!
      const grouped = a.group !== undefined && a.group === b.group
      if (grouped || intersects(expand(a.box, 12), expand(b.box, 12))) join(i, j)
    }
  }
  const clusters = new Map<number, DrawingElement[]>()
  primitives.forEach((el, i) => {
    const root = find(i)
    clusters.set(root, [...(clusters.get(root) ?? []), el])
  })

  interface Cluster {
    members: DrawingElement[]
    box: DrawingBox
    groups: Set<number>
    labels: DrawingElement[]
  }
  const usable: Cluster[] = []
  for (const members of clusters.values()) {
    if (members.filter((el) => el.kind === 'line').length < 2) continue
    const box = members.map((el) => el.box).reduce(union)
    const groups = new Set(members.flatMap((el) => (el.group !== undefined ? [el.group] : [])))
    usable.push({ members, box, groups, labels: [] })
  }
  if (usable.length === 0) return []

  // Short, non-placeholder text: a label of the cluster it sits in (or whose
  // group it shares); the nearest cluster wins when several are close.
  for (const el of elements) {
    if (el.kind !== 'text' && !(el.kind === 'shape' && el.text)) continue
    if (el.placeholder || !el.text || !isLabelText(el.text)) continue
    const point = center(el.box)
    let best: { cluster: Cluster; distance: number } | undefined
    for (const cluster of usable) {
      const margin = Math.max(24, 0.12 * Math.max(cluster.box.w, cluster.box.h))
      const grouped = el.group !== undefined && cluster.groups.has(el.group)
      if (!grouped && !contains(expand(cluster.box, margin), point)) continue
      const c = center(cluster.box)
      const distance = grouped ? -1 : Math.hypot(point.x - c.x, point.y - c.y)
      if (!best || distance < best.distance) best = { cluster, distance }
    }
    best?.cluster.labels.push(el)
  }

  return usable
    .map((cluster) => ({
      labelIndexes: cluster.labels.map((el) => el.index),
      index: Math.min(...cluster.members.map((el) => el.index)),
      caption: figureCaption(cluster.members, cluster.labels, cluster.box),
    }))
    .sort((a, b) => a.index - b.index)
}

function figureCaption(
  members: readonly DrawingElement[],
  labels: readonly DrawingElement[],
  box: DrawingBox,
): string {
  const lines = members.filter((el) => el.kind === 'line')
  const dashed = lines.filter((el) => el.dashed)
  const solid = lines.filter((el) => !el.dashed)
  // Long axis-aligned solid lines are the axes; short ones are ordinary lines.
  const axes = solid.filter(
    (el) =>
      isAxisAligned(el) &&
      (el.box.w <= AXIS_TOLERANCE ? el.box.h >= 0.3 * box.h : el.box.w >= 0.3 * box.w),
  )
  // A line with an arrow head is an arrow ("demand rises"), not a curve.
  const curves = solid.filter((el) => !axes.includes(el) && !el.arrowHead)
  const arrows =
    members.filter((el) => el.kind === 'arrow').length +
    lines.filter((el) => el.arrowHead && !axes.includes(el)).length

  // A chart has a horizontal and a vertical axis. Anything else (a tree, a
  // flow of boxes and connectors) is described as a diagram: its connectors
  // are counted and its text kept in reading order, without naming lines.
  const isChart =
    axes.some((el) => el.box.h <= AXIS_TOLERANCE) && axes.some((el) => el.box.w <= AXIS_TOLERANCE)
  if (!isChart) {
    const texts: string[] = []
    for (const label of [...labels].sort((a, b) => a.index - b.index)) {
      const text = compactLabel(label.text ?? '')
      if (text && !texts.includes(text)) texts.push(text)
    }
    const parts = [`连接线 ${lines.length}`]
    if (arrows > 0) parts.push(`箭头 ${arrows}`)
    if (texts.length > 0) parts.push(`文字：${texts.join('、')}`)
    return `[示意图：${parts.join('，')}]`
  }

  // Name each curve by the nearest naming label (each label used once).
  const names = labels.filter((el) => isNameLabel(el.text ?? ''))
  const pairs: Array<{ curve: number; label: number; distance: number }> = []
  // The plot area lies between the axes; an axis title ("Price", "Quantity")
  // sits outside it and never names a curve.
  const vertical = axes.filter((el) => el.box.w <= AXIS_TOLERANCE)
  const horizontal = axes.filter((el) => el.box.h <= AXIS_TOLERANCE)
  const plot =
    vertical.length > 0 && horizontal.length > 0
      ? {
          left: Math.min(...vertical.map((el) => el.box.x)) - AXIS_TOLERANCE,
          top: Math.min(...vertical.map((el) => el.box.y)) - AXIS_TOLERANCE,
          right: Math.max(...horizontal.map((el) => el.box.x + el.box.w)) + 40,
          bottom: Math.max(...horizontal.map((el) => el.box.y)) + AXIS_TOLERANCE,
        }
      : undefined
  const insidePlot = (point: { x: number; y: number }) =>
    !plot ||
    (point.x >= plot.left && point.x <= plot.right && point.y >= plot.top && point.y <= plot.bottom)
  curves.forEach((curve, ci) =>
    names.forEach((label, li) => {
      const point = center(label.box)
      const distance = distanceToSegment(point, curve)
      if (distance <= 100 && insidePlot(point)) pairs.push({ curve: ci, label: li, distance })
    }),
  )
  pairs.sort((a, b) => a.distance - b.distance)
  const curveName = new Map<number, string>()
  const usedLabels = new Set<number>()
  for (const pair of pairs) {
    if (curveName.has(pair.curve) || usedLabels.has(pair.label)) continue
    curveName.set(pair.curve, compactLabel(names[pair.label]!.text ?? ''))
    usedLabels.add(pair.label)
  }

  const parts: string[] = []
  if (curves.length > 0) {
    const described = curves
      .map((curve, i) => {
        const colour = colorName(curve.color)
        const name = curveName.get(i)
        return [colour, name].filter(Boolean).join(' ')
      })
      .filter(Boolean)
    const kind = curves.some((curve) => curve.curve) ? '曲线/实线' : '实线'
    parts.push(
      `${curves.length} 条${kind}${described.length > 0 ? `（${described.join('、')}）` : ''}`,
    )
  }
  if (axes.length > 0) parts.push(`坐标轴 ${axes.length}`)
  if (dashed.length > 0) parts.push(`虚线辅助线 ${dashed.length}`)
  if (arrows > 0) parts.push(`箭头 ${arrows}`)
  const labelTexts: string[] = []
  for (const label of [...labels].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const text = compactLabel(label.text ?? '')
    if (text && !labelTexts.includes(text)) labelTexts.push(text)
  }
  if (labelTexts.length > 0) parts.push(`标签：${labelTexts.join('、')}`)
  return `[图：${parts.join('，')}]`
}
