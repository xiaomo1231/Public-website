import { useState } from 'react'
import { formatNumber } from '@/entities/tutorVisualization/distribution'
import {
  equivalentResistance,
  forceComponents,
  forceFacts,
  motionFacts,
  motionSamples,
  opticsFacts,
  solveCircuit,
  type CircuitNode,
} from '@/entities/tutorVisualization/physics'
import type {
  CircuitVisualization,
  ForcesVisualization,
  MotionVisualization,
  OpticsVisualization,
} from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'
import { ParamSlider, PlotFrame } from './PlotFrame'
import { AXIS, FOREGROUND, LABEL, SERIES, linePath, niceRange } from './plotUtils'

type T = UseTranslationResult['t']
const f = formatNumber

function Arrowhead({ id, color }: { id: string; color: string }): JSX.Element {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  )
}

// --- free-body diagram --------------------------------------------------------------

export function TutorForcesFigure({ visualization, layout, t }: { visualization: ForcesVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { forces, unit, mass, incline } = visualization
  const facts = forceFacts(forces, mass, incline)
  const width = layout.width
  const height = Math.round(Math.min(layout.height, width * 0.75))
  const cx = width / 2
  const cy = height / 2
  const maxMagnitude = Math.max(...forces.map((force) => force.magnitude), facts.net.magnitude, 1e-9)
  const reach = Math.min(width, height) * 0.36
  const length = (magnitude: number) => 22 + (magnitude / maxMagnitude) * (reach - 22)
  const tip = (magnitude: number, angle: number) => ({
    x: cx + length(magnitude) * Math.cos((angle * Math.PI) / 180),
    y: cy - length(magnitude) * Math.sin((angle * Math.PI) / 180),
  })
  const box = 34
  const tilt = incline ?? 0
  const netTip = tip(facts.net.magnitude, facts.net.angle)
  const label = t('viz.forcesAria', { count: forces.length, net: f(facts.net.magnitude, 4), unit })

  return (
    <div className="space-y-2 px-1 py-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
        <title>{label}</title>
        <defs>
          {SERIES.map((color, i) => (
            <Arrowhead key={i} id={`force-arrow-${i}`} color={color} />
          ))}
          <Arrowhead id="force-arrow-net" color={FOREGROUND} />
        </defs>
        <g aria-hidden="true">
          {incline !== undefined && (
            <path
              d={`M ${cx - reach * 1.4} ${cy + box / 2 + Math.tan((tilt * Math.PI) / 180) * reach * 1.4} L ${cx + reach * 1.4} ${cy + box / 2 - Math.tan((tilt * Math.PI) / 180) * reach * 1.4} L ${cx + reach * 1.4} ${cy + box / 2 + Math.tan((tilt * Math.PI) / 180) * reach * 1.4} Z`}
              fill="hsl(var(--muted))"
              stroke={AXIS}
              strokeWidth="1"
            />
          )}
          <rect x={cx - box / 2} y={cy - box / 2} width={box} height={box} rx="3" fill="hsl(var(--card))" stroke={FOREGROUND} strokeWidth="1.6" transform={`rotate(${-tilt} ${cx} ${cy})`} />
          {visualization.body && (
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fill={FOREGROUND}>
              {visualization.body}
            </text>
          )}
          {forces.map((force, i) => {
            const end = tip(force.magnitude, force.angle)
            const color = SERIES[i % 4]!
            const dx = Math.cos((force.angle * Math.PI) / 180)
            const dy = -Math.sin((force.angle * Math.PI) / 180)
            return (
              <g key={`${force.label}-${i}`}>
                <line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke={color} strokeWidth="2.4" markerEnd={`url(#force-arrow-${i % 4})`} />
                <text x={end.x + dx * 14} y={end.y + dy * 14 + 4} textAnchor="middle" fontSize="12" fill={color}>
                  {force.label} = {f(force.magnitude, 4)} {unit}
                </text>
              </g>
            )
          })}
          {!facts.balanced && (
            <line x1={cx} y1={cy} x2={netTip.x} y2={netTip.y} stroke={FOREGROUND} strokeWidth="1.8" strokeDasharray="6 4" markerEnd="url(#force-arrow-net)" />
          )}
        </g>
      </svg>
      <div className="data-num space-y-0.5 text-center text-[13px] text-muted-foreground">
        <p>
          ΣF<sub>x</sub> = {f(facts.net.x, 4)} {unit}, ΣF<sub>y</sub> = {f(facts.net.y, 4)} {unit}
          {incline !== undefined && (
            <span className="ml-2">
              {t('viz.forcesAlongIncline', { along: f(facts.alongIncline!, 4), perpendicular: f(facts.perpendicularToIncline!, 4), unit })}
            </span>
          )}
        </p>
        <p className="font-medium text-foreground">
          {facts.balanced
            ? t('viz.forcesBalanced')
            : t('viz.forcesNet', { magnitude: f(facts.net.magnitude, 4), unit, angle: f(facts.net.angle, 3) })}
          {facts.acceleration !== undefined && !facts.balanced && <span className="ml-2">{t('viz.forcesAcceleration', { value: f(facts.acceleration, 4) })}</span>}
        </p>
        <ul className="flex flex-wrap justify-center gap-x-4 text-xs">
          {forces.map((force, i) => {
            const c = forceComponents(force)
            return (
              <li key={`${force.label}-c${i}`}>
                {force.label}: ({f(c.x, 3)}, {f(c.y, 3)}) {unit}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// --- motion graphs ----------------------------------------------------------------

export function TutorMotionFigure({ visualization, layout, t }: { visualization: MotionVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { x0, v0, segments } = visualization
  const samples = motionSamples(x0, v0, segments)
  const facts = motionFacts(x0, v0, segments)
  const [time, setTime] = useState(0)
  const at = samples.reduce((best, s) => (Math.abs(s.t - time) < Math.abs(best.t - time) ? s : best), samples[0]!)
  const height = Math.round(layout.height * 0.42)
  const plots = [
    { key: 'x', label: 'x (m)', points: samples.map((s) => ({ x: s.t, y: s.x })), value: at.x },
    { key: 'v', label: 'v (m/s)', points: samples.map((s) => ({ x: s.t, y: s.v })), value: at.v },
    { key: 'a', label: 'a (m/s²)', points: samples.map((s) => ({ x: s.t, y: s.a })), value: at.a },
  ]
  return (
    <div className="space-y-1 px-1 py-2">
      {plots.map((plot, i) => {
        const yRange = niceRange(plot.points.map((p) => p.y), [0])
        return (
          <PlotFrame
            key={plot.key}
            width={layout.width}
            height={height}
            xRange={[0, facts.duration]}
            yRange={yRange}
            xLabel={i === 2 ? 't (s)' : ''}
            yLabel={plot.label}
            label={t('viz.motionAria', { quantity: plot.label })}
            compact
            pad={{ left: 50, right: 14, top: 12, bottom: 24 }}
          >
            {(scale) => (
              <>
                {facts.boundaries.slice(1, -1).map((b) => (
                  <line key={b} x1={scale.sx(b)} x2={scale.sx(b)} y1={scale.top} y2={scale.bottom} stroke={LABEL} strokeDasharray="3 4" />
                ))}
                <path d={linePath(plot.points, scale, yRange)} fill="none" stroke={SERIES[i]} strokeWidth="2.2" />
                {plot.key === 'v' && (
                  // Area under v–t is the displacement.
                  <path
                    d={`${linePath(plot.points, scale, yRange)} L ${scale.sx(facts.duration)} ${scale.sy(0)} L ${scale.sx(0)} ${scale.sy(0)} Z`}
                    fill="hsl(var(--viz-series-2) / 0.12)"
                    stroke="none"
                  />
                )}
                <line x1={scale.sx(at.t)} x2={scale.sx(at.t)} y1={scale.top} y2={scale.bottom} stroke={FOREGROUND} strokeWidth="1" />
                <circle cx={scale.sx(at.t)} cy={scale.sy(plot.value)} r="4" fill={SERIES[i]} />
              </>
            )}
          </PlotFrame>
        )
      })}
      <div className="rounded-md border border-border/70 px-3 py-2">
        <ParamSlider label="t" value={time} min={0} max={facts.duration} step={facts.duration / 200} unit="s" onChange={setTime} />
        <p className="data-num pt-1 text-center text-xs text-muted-foreground">
          x = {f(at.x, 4)} m · v = {f(at.v, 4)} m/s · a = {f(at.a, 4)} m/s²
        </p>
      </div>
      <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{t('viz.motionDisplacement', { value: f(facts.displacement, 4) })}</span>
        <span>{t('viz.motionDistance', { value: f(facts.distance, 4) })}</span>
        <span>{t('viz.motionFinal', { value: f(facts.finalVelocity, 4) })}</span>
        <span>{t('viz.motionAverage', { value: f(facts.averageVelocity, 4) })}</span>
      </p>
    </div>
  )
}

const ELEMENT_KEYS = {
  converging_lens: 'viz.opticsConvergingLens',
  diverging_lens: 'viz.opticsDivergingLens',
  concave_mirror: 'viz.opticsConcaveMirror',
  convex_mirror: 'viz.opticsConvexMirror',
} as const

// --- optics --------------------------------------------------------------------------

export function TutorOpticsFigure({ visualization, layout, t }: { visualization: OpticsVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { element, focalLength, objectHeight } = visualization
  const [objectDistance, setObjectDistance] = useState(visualization.objectDistance)
  const facts = opticsFacts(element, focalLength, objectDistance, objectHeight)
  const mirror = element.endsWith('mirror')
  const fAbs = Math.abs(facts.focalLength)
  // Screen x of the image: lenses form real images on the far side, mirrors in front.
  const imageX = facts.atInfinity ? NaN : mirror ? -facts.imageDistance : facts.imageDistance
  const shownImageX = Number.isFinite(imageX) && Math.abs(imageX) < 6 * Math.max(objectDistance, fAbs) ? imageX : NaN
  const xs = [-objectDistance, -2 * fAbs, 2 * fAbs, ...(Number.isFinite(shownImageX) ? [shownImageX] : [])]
  const xMin = Math.min(...xs) * 1.15
  const xMax = Math.max(...xs, fAbs) * 1.15
  const imageHeight = Number.isFinite(facts.imageHeight) ? facts.imageHeight : 0
  const yMax = Math.max(objectHeight, Math.min(Math.abs(imageHeight), objectHeight * 4)) * 1.6
  const width = layout.width
  const height = Math.round(layout.compact ? width * 0.75 : layout.height * 0.75)
  const sx = (x: number) => 16 + ((x - xMin) / (xMax - xMin)) * (width - 32)
  const sy = (y: number) => height / 2 - (y / yMax) * (height / 2 - 18)
  const edgeX = mirror ? xMin : xMax

  // Each principal ray meets the element at height yl and then passes through
  // (or, for a virtual image, appears to come from) the image point.
  const rayHeights = facts.atInfinity ? [objectHeight, 0] : [objectHeight, 0, imageHeight]
  const rays = rayHeights.map((yl) => {
    let dx: number
    let dy: number
    if (facts.atInfinity) {
      dx = mirror ? -1 : 1
      dy = mirror ? -objectHeight / objectDistance : -objectHeight / objectDistance
    } else if (facts.real) {
      dx = imageX - 0
      dy = imageHeight - yl
    } else {
      dx = 0 - imageX
      dy = yl - imageHeight
    }
    const s = (edgeX - 0) / dx
    return { yl, end: { x: edgeX, y: yl + dy * s }, virtual: !facts.real && !facts.atInfinity }
  })
  const label = t('viz.opticsAria', { element: t(ELEMENT_KEYS[element]), distance: f(objectDistance, 3) })
  const focalMarks = mirror ? [element === 'concave_mirror' ? -fAbs : fAbs] : [-fAbs, fAbs]

  return (
    <div className="space-y-2 px-1 py-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
        <title>{label}</title>
        <defs>
          <Arrowhead id="optics-object" color={SERIES[0]!} />
          <Arrowhead id="optics-image" color={SERIES[1]!} />
        </defs>
        <g aria-hidden="true">
          <line x1={16} x2={width - 16} y1={sy(0)} y2={sy(0)} stroke={AXIS} strokeWidth="1" />
          {mirror ? (
            <path
              d={`M ${sx(0) + (element === 'concave_mirror' ? -10 : 10)} ${sy(yMax * 0.85)} Q ${sx(0) + (element === 'concave_mirror' ? 10 : -10)} ${sy(0)} ${sx(0) + (element === 'concave_mirror' ? -10 : 10)} ${sy(-yMax * 0.85)}`}
              fill="none"
              stroke={FOREGROUND}
              strokeWidth="2.4"
            />
          ) : (
            <g stroke={FOREGROUND} strokeWidth="2" fill="none">
              <line x1={sx(0)} x2={sx(0)} y1={sy(yMax * 0.85)} y2={sy(-yMax * 0.85)} />
              {/* Arrowheads pointing out for a converging lens, in for a diverging one. */}
              {element === 'converging_lens' ? (
                <>
                  <path d={`M ${sx(0) - 7} ${sy(yMax * 0.85) + 8} L ${sx(0)} ${sy(yMax * 0.85)} L ${sx(0) + 7} ${sy(yMax * 0.85) + 8}`} />
                  <path d={`M ${sx(0) - 7} ${sy(-yMax * 0.85) - 8} L ${sx(0)} ${sy(-yMax * 0.85)} L ${sx(0) + 7} ${sy(-yMax * 0.85) - 8}`} />
                </>
              ) : (
                <>
                  <path d={`M ${sx(0) - 7} ${sy(yMax * 0.85) - 8} L ${sx(0)} ${sy(yMax * 0.85)} L ${sx(0) + 7} ${sy(yMax * 0.85) - 8}`} />
                  <path d={`M ${sx(0) - 7} ${sy(-yMax * 0.85) + 8} L ${sx(0)} ${sy(-yMax * 0.85)} L ${sx(0) + 7} ${sy(-yMax * 0.85) + 8}`} />
                </>
              )}
            </g>
          )}
          {focalMarks.map((x) => (
            <g key={x}>
              <circle cx={sx(x)} cy={sy(0)} r="3" fill={FOREGROUND} />
              <text x={sx(x)} y={sy(0) + 16} textAnchor="middle" fontSize="11" fill={LABEL}>
                F
              </text>
            </g>
          ))}
          {rays.map((ray, i) => (
            <g key={i} stroke={SERIES[2]} strokeWidth="1.4" fill="none">
              <line x1={sx(-objectDistance)} y1={sy(objectHeight)} x2={sx(0)} y2={sy(ray.yl)} />
              <line x1={sx(0)} y1={sy(ray.yl)} x2={sx(ray.end.x)} y2={sy(ray.end.y)} />
              {ray.virtual && Number.isFinite(shownImageX) && (
                <line x1={sx(0)} y1={sy(ray.yl)} x2={sx(shownImageX)} y2={sy(imageHeight)} strokeDasharray="4 4" stroke={LABEL} />
              )}
            </g>
          ))}
          <line x1={sx(-objectDistance)} y1={sy(0)} x2={sx(-objectDistance)} y2={sy(objectHeight)} stroke={SERIES[0]} strokeWidth="2.6" markerEnd="url(#optics-object)" />
          {Number.isFinite(shownImageX) && (
            <line
              x1={sx(shownImageX)}
              y1={sy(0)}
              x2={sx(shownImageX)}
              y2={sy(imageHeight)}
              stroke={SERIES[1]}
              strokeWidth="2.6"
              strokeDasharray={facts.real ? undefined : '5 3'}
              markerEnd="url(#optics-image)"
            />
          )}
        </g>
      </svg>
      <div className="rounded-md border border-border/70 px-3 py-2">
        <ParamSlider
          label={t('viz.opticsObjectDistance')}
          value={objectDistance}
          min={fAbs * 0.2}
          max={Math.max(fAbs * 4, visualization.objectDistance)}
          step={fAbs / 50}
          onChange={setObjectDistance}
        />
      </div>
      <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        <span>
          d<sub>o</sub> = {f(objectDistance, 4)}, f = {f(facts.focalLength, 4)}
        </span>
        {facts.atInfinity ? (
          <span className="font-medium text-foreground">{t('viz.opticsAtInfinity')}</span>
        ) : (
          <>
            <span className="font-medium text-foreground">
              d<sub>i</sub> = {f(facts.imageDistance, 4)}, m = {f(facts.magnification, 4)}
            </span>
            <span>
              {[
                facts.real ? t('viz.opticsReal') : t('viz.opticsVirtual'),
                facts.upright ? t('viz.opticsUpright') : t('viz.opticsInverted'),
                facts.enlarged ? t('viz.opticsEnlarged') : t('viz.opticsReduced'),
              ].join(t('viz.listSeparator'))}
            </span>
            {!Number.isFinite(shownImageX) && <span>{t('viz.opticsFarImage')}</span>}
          </>
        )}
      </p>
    </div>
  )
}

// --- circuits ------------------------------------------------------------------------

const RESISTOR_W = 76
const ROW_H = 54
const RAIL = 18

function size(node: CircuitNode): { w: number; h: number } {
  if (node.kind === 'resistor') return { w: RESISTOR_W, h: ROW_H }
  const sizes = node.items.map(size)
  if (node.kind === 'series') return { w: sizes.reduce((s, x) => s + x.w, 0), h: Math.max(...sizes.map((x) => x.h)) }
  return { w: Math.max(...sizes.map((x) => x.w)) + 2 * RAIL, h: sizes.reduce((s, x) => s + x.h, 0) }
}

function drawNetwork(node: CircuitNode, x: number, y: number, out: JSX.Element[], key: string): void {
  const { w } = size(node)
  if (node.kind === 'resistor') {
    out.push(
      <g key={key}>
        <line x1={x} x2={x + (w - 40) / 2} y1={y} y2={y} stroke={FOREGROUND} strokeWidth="1.6" />
        <rect x={x + (w - 40) / 2} y={y - 8} width={40} height={16} fill="hsl(var(--card))" stroke={FOREGROUND} strokeWidth="1.6" />
        <line x1={x + (w + 40) / 2} x2={x + w} y1={y} y2={y} stroke={FOREGROUND} strokeWidth="1.6" />
        <text x={x + w / 2} y={y - 13} textAnchor="middle" fontSize="11" fill={FOREGROUND}>
          {node.label} {formatNumber(node.resistance, 4)} Ω
        </text>
      </g>,
    )
    return
  }
  if (node.kind === 'series') {
    let cursor = x
    node.items.forEach((item, i) => {
      drawNetwork(item, cursor, y, out, `${key}s${i}`)
      cursor += size(item).w
    })
    return
  }
  const sizes = node.items.map(size)
  const total = sizes.reduce((s, item) => s + item.h, 0)
  let top = y - total / 2
  const centres: number[] = []
  node.items.forEach((item, i) => {
    const centre = top + sizes[i]!.h / 2
    centres.push(centre)
    drawNetwork(item, x + RAIL, centre, out, `${key}p${i}`)
    // Pad a narrower branch to the right rail.
    if (sizes[i]!.w < w - 2 * RAIL) {
      out.push(<line key={`${key}pad${i}`} x1={x + RAIL + sizes[i]!.w} x2={x + w - RAIL} y1={centre} y2={centre} stroke={FOREGROUND} strokeWidth="1.6" />)
    }
    out.push(<line key={`${key}l${i}`} x1={x} x2={x + RAIL} y1={centre} y2={centre} stroke={FOREGROUND} strokeWidth="1.6" />)
    out.push(<line key={`${key}r${i}`} x1={x + w - RAIL} x2={x + w} y1={centre} y2={centre} stroke={FOREGROUND} strokeWidth="1.6" />)
    top += sizes[i]!.h
  })
  out.push(<line key={`${key}lr`} x1={x} x2={x} y1={centres[0]!} y2={centres[centres.length - 1]!} stroke={FOREGROUND} strokeWidth="1.6" />)
  out.push(<line key={`${key}rr`} x1={x + w} x2={x + w} y1={centres[0]!} y2={centres[centres.length - 1]!} stroke={FOREGROUND} strokeWidth="1.6" />)
}

export function TutorCircuitFigure({ visualization, t }: { visualization: CircuitVisualization; t: T }): JSX.Element {
  const { network, voltage } = visualization
  const rEq = equivalentResistance(network)
  const current = voltage / rEq
  const readings = solveCircuit(network, voltage)
  const { w, h } = size(network)
  const margin = 40
  const width = w + margin * 2
  const y = margin + h / 2
  const bottom = margin + h + 26
  // Room below the source for its voltage label.
  const height = bottom + 40
  const elements: JSX.Element[] = []
  drawNetwork(network, margin, y, elements, 'n')
  const midX = width / 2
  const label = t('viz.circuitAria', { count: readings.length, resistance: formatNumber(rEq, 4) })

  return (
    <div className="space-y-2 px-1 py-2">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="mx-auto block h-auto w-full" style={{ maxWidth: Math.min(640, Math.max(width * 1.5, 300)) }}>
          <title>{label}</title>
          <g aria-hidden="true">
            {elements}
            <line x1={margin} x2={margin - 16} y1={y} y2={y} stroke={FOREGROUND} strokeWidth="1.6" />
            <line x1={margin - 16} x2={margin - 16} y1={y} y2={bottom} stroke={FOREGROUND} strokeWidth="1.6" />
            <line x1={margin + w} x2={margin + w + 16} y1={y} y2={y} stroke={FOREGROUND} strokeWidth="1.6" />
            <line x1={margin + w + 16} x2={margin + w + 16} y1={y} y2={bottom} stroke={FOREGROUND} strokeWidth="1.6" />
            <line x1={margin - 16} x2={midX - 6} y1={bottom} y2={bottom} stroke={FOREGROUND} strokeWidth="1.6" />
            <line x1={midX + 6} x2={margin + w + 16} y1={bottom} y2={bottom} stroke={FOREGROUND} strokeWidth="1.6" />
            {/* Source: long plate (+) and short plate (−). */}
            <line x1={midX - 6} x2={midX - 6} y1={bottom - 14} y2={bottom + 14} stroke={FOREGROUND} strokeWidth="2" />
            <line x1={midX + 6} x2={midX + 6} y1={bottom - 8} y2={bottom + 8} stroke={FOREGROUND} strokeWidth="3" />
            <text x={midX} y={bottom + 28} textAnchor="middle" fontSize="11" fill={FOREGROUND}>
              {formatNumber(voltage, 4)} V
            </text>
          </g>
        </svg>
      </div>
      <p className="data-num flex flex-wrap justify-center gap-x-4 text-[13px]">
        <span className="font-medium text-foreground">R<sub>eq</sub> = {formatNumber(rEq, 4)} Ω</span>
        <span className="text-muted-foreground">I = {formatNumber(current, 4)} A</span>
        <span className="text-muted-foreground">P = {formatNumber(voltage * current, 4)} W</span>
      </p>
      <div className="overflow-x-auto">
        <table className="mx-auto border-collapse text-center text-[13px]" aria-label={t('viz.circuitTable')}>
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-1 font-normal" />
              <th scope="col" className="px-2 py-1 font-normal">R (Ω)</th>
              <th scope="col" className="px-2 py-1 font-normal">U (V)</th>
              <th scope="col" className="px-2 py-1 font-normal">I (A)</th>
              <th scope="col" className="px-2 py-1 font-normal">P (W)</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((r) => (
              <tr key={r.label} className="data-num border-t border-border/70">
                <th scope="row" className="px-2 py-1 font-medium">{r.label}</th>
                <td className="px-2 py-1">{formatNumber(r.resistance, 4)}</td>
                <td className="px-2 py-1">{formatNumber(r.voltage, 4)}</td>
                <td className="px-2 py-1">{formatNumber(r.current, 4)}</td>
                <td className="px-2 py-1">{formatNumber(r.power, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
