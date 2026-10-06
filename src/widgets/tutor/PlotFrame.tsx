import { useId, type ReactNode } from 'react'
import { formatNumber } from '@/entities/tutorVisualization/distribution'
import { AXIS, GRID, LABEL, ticks, type PlotScale } from './plotUtils'

export interface PlotFrameProps {
  width: number
  height: number
  xRange: [number, number]
  yRange: [number, number]
  xLabel?: string
  yLabel?: string
  label: string
  compact?: boolean
  pad?: { left: number; right: number; top: number; bottom: number }
  /** Data drawn inside the plot area (clipped). */
  children: (scale: PlotScale) => ReactNode
  /** Labels and markers drawn on top, unclipped. */
  overlay?: (scale: PlotScale) => ReactNode
}

/** Axes, grid, ticks and clipping shared by the subject figures. */
export function PlotFrame({
  width,
  height,
  xRange,
  yRange,
  xLabel,
  yLabel,
  label,
  compact,
  pad = { left: 50, right: 14, top: 14, bottom: 34 },
  children,
  overlay,
}: PlotFrameProps): JSX.Element {
  const clip = `plot-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const scale: PlotScale = {
    left: pad.left,
    right: width - pad.right,
    top: pad.top,
    bottom: height - pad.bottom,
    sx: (x) => pad.left + ((x - xRange[0]) / (xRange[1] - xRange[0])) * (width - pad.left - pad.right),
    sy: (y) => pad.top + (1 - (y - yRange[0]) / (yRange[1] - yRange[0])) * (height - pad.top - pad.bottom),
  }
  const xTicks = ticks(xRange[0], xRange[1], compact ? 4 : 7)
  const yTicks = ticks(yRange[0], yRange[1], compact ? 4 : 5)
  const axisY = yRange[0] <= 0 && yRange[1] >= 0 ? scale.sy(0) : scale.bottom
  const axisX = xRange[0] <= 0 && xRange[1] >= 0 ? scale.sx(0) : scale.left
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
      <title>{label}</title>
      <defs>
        <clipPath id={clip}>
          <rect x={scale.left} y={scale.top} width={scale.right - scale.left} height={scale.bottom - scale.top} />
        </clipPath>
      </defs>
      <g aria-hidden="true">
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={scale.left} x2={scale.right} y1={scale.sy(v)} y2={scale.sy(v)} stroke={GRID} strokeWidth="1" />
            <text x={scale.left - 6} y={scale.sy(v) + 4} textAnchor="end" fontSize="11" fill={LABEL}>
              {formatNumber(v, 3)}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line x1={scale.sx(v)} x2={scale.sx(v)} y1={scale.top} y2={scale.bottom} stroke={GRID} strokeWidth="1" />
            <text x={scale.sx(v)} y={scale.bottom + 15} textAnchor="middle" fontSize="11" fill={LABEL}>
              {formatNumber(v, 3)}
            </text>
          </g>
        ))}
        <line x1={scale.left} x2={scale.right} y1={axisY} y2={axisY} stroke={AXIS} strokeWidth="1.2" />
        <line x1={axisX} x2={axisX} y1={scale.top} y2={scale.bottom} stroke={AXIS} strokeWidth="1.2" />
        {xLabel && (
          <text x={scale.right} y={height - 4} textAnchor="end" fontSize="11" fill={LABEL}>
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text x={scale.left + 4} y={scale.top + 10} fontSize="11" fill={LABEL}>
            {yLabel}
          </text>
        )}
        <g clipPath={`url(#${clip})`}>{children(scale)}</g>
        {overlay?.(scale)}
      </g>
    </svg>
  )
}

/** A labelled range slider for an interactive figure. */
export function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <label className="flex min-w-0 items-center gap-2 text-[13px]">
      <span className="w-24 shrink-0 truncate text-muted-foreground" title={label}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="focus-ring h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
      />
      <span className="data-num w-20 shrink-0 text-right text-foreground">
        {formatNumber(value, 4)}
        {unit ? ` ${unit}` : ''}
      </span>
    </label>
  )
}
