import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { bstLayout, buildBst, sortFrames } from '@/entities/tutorVisualization/algorithms'
import type { BstVisualization, SortingVisualization } from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'
import { ParamSlider } from './PlotFrame'
import { FOREGROUND, LABEL, SERIES } from './plotUtils'

type T = UseTranslationResult['t']

const ALGORITHM_KEYS = {
  bubble: 'viz.sortBubble',
  insertion: 'viz.sortInsertion',
  selection: 'viz.sortSelection',
  merge: 'viz.sortMerge',
  quick: 'viz.sortQuick',
} as const

const COMPLEXITY = {
  bubble: 'O(n²)',
  insertion: 'O(n²)',
  selection: 'O(n²)',
  merge: 'O(n log n)',
  quick: 'O(n log n) — O(n²)',
} as const

const ACTION_KEYS = {
  start: 'viz.sortActionStart',
  compare: 'viz.sortActionCompare',
  swap: 'viz.sortActionSwap',
  write: 'viz.sortActionWrite',
  pivot: 'viz.sortActionPivot',
  done: 'viz.sortActionDone',
} as const

function StepButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }): JSX.Element {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="focus-ring grid h-8 w-8 place-items-center rounded-md border border-border/80 hover:bg-accent disabled:opacity-40">
      {children}
    </button>
  )
}

// --- sorting --------------------------------------------------------------------------

export function TutorSortingFigure({ visualization, layout, t }: { visualization: SortingVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const frames = useMemo(() => sortFrames(visualization.algorithm, visualization.values), [visualization.algorithm, visualization.values])
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    if (step >= frames.length - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => setStep((s) => Math.min(frames.length - 1, s + 1)), 650)
    return () => window.clearTimeout(timer)
  }, [playing, step, frames.length])
  const frame = frames[step]!
  const width = layout.width
  const height = 190
  const n = frame.values.length
  const max = Math.max(...frame.values.map(Math.abs), 1)
  const slot = (width - 24) / n
  const barW = Math.min(44, slot * 0.72)
  const baseline = height - 28
  const label = t('viz.sortAria', { algorithm: t(ALGORITHM_KEYS[visualization.algorithm]), n })

  return (
    <div className="space-y-2 px-1 py-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
        <title>{label}</title>
        <g aria-hidden="true">
          {frame.values.map((value, i) => {
            const h = (Math.abs(value) / max) * (baseline - 24)
            const active = frame.active.includes(i)
            const done = frame.sorted.includes(i)
            const fill = active ? (frame.action === 'swap' || frame.action === 'write' ? SERIES[1] : SERIES[2]) : done ? SERIES[0] : 'hsl(var(--muted-foreground) / 0.35)'
            const x = 12 + slot * i + (slot - barW) / 2
            return (
              <g key={i}>
                <rect x={x} y={baseline - h} width={barW} height={h} rx="3" fill={fill} />
                <text x={x + barW / 2} y={baseline - h - 6} textAnchor="middle" fontSize="12" fill={FOREGROUND}>
                  {value}
                </text>
                <text x={x + barW / 2} y={baseline + 16} textAnchor="middle" fontSize="10" fill={LABEL}>
                  {i}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <StepButton label={t('viz.stepReset')} onClick={() => { setPlaying(false); setStep(0) }}><RotateCcw className="h-4 w-4" /></StepButton>
        <StepButton label={t('viz.stepPrevious')} onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ChevronLeft className="h-4 w-4" /></StepButton>
        <StepButton label={playing ? t('viz.stepPause') : t('viz.stepPlay')} onClick={() => setPlaying((p) => !p)} disabled={step >= frames.length - 1 && !playing}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </StepButton>
        <StepButton label={t('viz.stepNext')} onClick={() => setStep((s) => Math.min(frames.length - 1, s + 1))} disabled={step >= frames.length - 1}><ChevronRight className="h-4 w-4" /></StepButton>
        <span className="data-num text-xs text-muted-foreground">
          {step + 1} / {frames.length}
        </span>
      </div>
      <p className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{t(ACTION_KEYS[frame.action], { i: frame.active[0] ?? '', j: frame.active[1] ?? frame.active.at(-1) ?? '' })}</span>
        <span>{t('viz.sortComparisons', { value: frame.comparisons })}</span>
        <span>{t('viz.sortWrites', { value: frame.writes })}</span>
        <span>
          {t(ALGORITHM_KEYS[visualization.algorithm])} · {COMPLEXITY[visualization.algorithm]}
        </span>
      </p>
    </div>
  )
}

// --- binary search tree -----------------------------------------------------------------

export function TutorBstFigure({ visualization, layout, t }: { visualization: BstVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { keys } = visualization
  const [count, setCount] = useState(keys.length)
  const tree = useMemo(() => buildBst(keys.slice(0, count)), [keys, count])
  const nodes = bstLayout(tree.root)
  const width = layout.width
  const depth = Math.max(0, ...nodes.map((node) => node.depth))
  const height = 40 + (depth + 1) * 62
  const slot = (width - 40) / Math.max(nodes.length, 1)
  const pos = new Map(nodes.map((node) => [node.key, { x: 20 + slot * (node.x + 0.5), y: 28 + node.depth * 62 }]))
  const path = new Set(tree.lastPath)
  const label = t('viz.bstAria', { count: nodes.length, height: tree.height })

  return (
    <div className="space-y-2 px-1 py-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
        <title>{label}</title>
        <g aria-hidden="true">
          {nodes.map((node) =>
            node.parent !== undefined ? (
              <line
                key={`e${node.key}`}
                x1={pos.get(node.parent)!.x}
                y1={pos.get(node.parent)!.y}
                x2={pos.get(node.key)!.x}
                y2={pos.get(node.key)!.y}
                stroke={path.has(node.key) && path.has(node.parent) ? SERIES[1] : LABEL}
                strokeWidth={path.has(node.key) && path.has(node.parent) ? 2.4 : 1.4}
              />
            ) : null,
          )}
          {nodes.map((node) => {
            const p = pos.get(node.key)!
            const last = node.key === tree.lastPath.at(-1)
            return (
              <g key={node.key}>
                <circle cx={p.x} cy={p.y} r="16" fill={last ? SERIES[1] : 'hsl(var(--card))'} stroke={path.has(node.key) ? SERIES[1] : FOREGROUND} strokeWidth="1.8" />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="12" fill={last ? 'hsl(var(--card))' : FOREGROUND}>
                  {node.key}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <div className="rounded-md border border-border/70 px-3 py-2">
        <ParamSlider label={t('viz.bstInserted')} value={count} min={1} max={keys.length} step={1} onChange={(value) => setCount(Math.round(value))} />
        <p className="data-num pt-1 text-center text-xs text-muted-foreground">
          {t('viz.bstOrder')} {keys.map((key, i) => (i < count ? key : <span key={i} className="opacity-40">{key}</span>)).reduce<ReactNode[]>((acc, item, i) => (i ? [...acc, ', ', item] : [item]), [])}
        </p>
      </div>
      <dl className="data-num grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
        <dt className="text-muted-foreground">{t('viz.bstInorder')}</dt>
        <dd>{tree.inorder.join(', ')}</dd>
        <dt className="text-muted-foreground">{t('viz.bstPreorder')}</dt>
        <dd>{tree.preorder.join(', ')}</dd>
        <dt className="text-muted-foreground">{t('viz.bstPostorder')}</dt>
        <dd>{tree.postorder.join(', ')}</dd>
        <dt className="text-muted-foreground">{t('viz.bstLevelOrder')}</dt>
        <dd>{tree.levelOrder.join(', ')}</dd>
        <dt className="text-muted-foreground">{t('viz.bstHeight')}</dt>
        <dd>
          {tree.height}
          {tree.duplicates.length > 0 && <span className="ml-2 text-muted-foreground">{t('viz.bstDuplicates', { keys: tree.duplicates.join(', ') })}</span>}
        </dd>
      </dl>
    </div>
  )
}
