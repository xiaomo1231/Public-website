import { useState } from 'react'
import { Layers, Loader2 } from 'lucide-react'
import { formatNumber } from '@/entities/tutorVisualization/distribution'
import { chartRows, palmerOf, parseFdi, toothName, universalOf } from '@/entities/tutorVisualization/medicine'
import type {
  AnatomyTableVisualization,
  DentalChartVisualization,
  NervousLevel,
  NeuralPathwayVisualization,
  TimelineVisualization,
} from '@/entities/tutorVisualization/types'
import { useLessonFigureContext } from '@/features/tutor/lessonFigureContext'
import { ReviewCardService } from '@/services/reviewCardService'
import { toast } from '@/features/toast/toastStore'
import type { UseTranslationResult } from '@/i18n'
import type { UILanguage } from '@/i18n/types'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/Button'
import type { PlotLayout } from './plotLayout'
import { ParamSlider } from './PlotFrame'
import { AXIS, FOREGROUND, LABEL, SERIES, SERIES_SOFT } from './plotUtils'

type T = UseTranslationResult['t']

// --- dental chart ---------------------------------------------------------------

type Notation = 'fdi' | 'universal' | 'palmer'

export function TutorDentalChartFigure({ visualization, t, language }: { visualization: DentalChartVisualization; t: T; language: UILanguage }): JSX.Element {
  const [notation, setNotation] = useState<Notation>('fdi')
  const [selected, setSelected] = useState<number | null>(visualization.teeth[0]?.code ?? null)
  const rows = chartRows(visualization.dentition)
  const highlighted = new Map(visualization.teeth.map((tooth) => [tooth.code, tooth.label]))
  const lang = language === 'zh-CN' ? 'zh' : 'en'
  const show = (code: number) => (notation === 'fdi' ? String(code) : notation === 'universal' ? universalOf(code)! : palmerOf(code)!)
  const tooth = (code: number) => (
    <button
      key={code}
      type="button"
      onClick={() => setSelected(code)}
      aria-pressed={selected === code}
      aria-label={`${code} ${toothName(code, lang)}`}
      className={cn(
        'focus-ring data-num grid h-9 min-w-0 flex-1 place-items-center rounded-md border text-[11px] transition-colors sm:text-xs',
        highlighted.has(code) ? 'border-transparent text-white' : 'border-border/80 bg-card hover:bg-accent',
        selected === code && 'ring-2 ring-foreground/60',
      )}
      style={highlighted.has(code) ? { background: SERIES[0] } : undefined}
    >
      {show(code)}
    </button>
  )
  const half = rows.upper.length / 2
  const row = (codes: number[]) => (
    <div className="flex gap-1">
      <div className="flex flex-1 gap-0.5">{codes.slice(0, half).map(tooth)}</div>
      <div className="w-px bg-foreground/40" aria-hidden />
      <div className="flex flex-1 gap-0.5">{codes.slice(half).map(tooth)}</div>
    </div>
  )
  const info = selected !== null ? parseFdi(selected) : null
  return (
    <div className="space-y-3 px-1 py-2">
      <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label={t('viz.dentalNotation')}>
        {(['fdi', 'universal', 'palmer'] as const).map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={notation === n}
            onClick={() => setNotation(n)}
            className={cn('focus-ring rounded-md border px-2 py-1 text-xs', notation === n ? 'border-primary bg-primary/10' : 'border-border/80 text-muted-foreground hover:bg-accent')}
          >
            {n === 'fdi' ? 'FDI' : n === 'universal' ? 'Universal' : 'Palmer'}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between px-1 text-[11px] text-muted-foreground">
          <span>{t('viz.dentalPatientRight')}</span>
          <span>{t('viz.dentalPatientLeft')}</span>
        </div>
        {row(rows.upper)}
        <div className="h-px bg-foreground/40" aria-hidden />
        {row(rows.lower)}
      </div>
      {info && selected !== null && (
        <p className="data-num text-center text-[13px]">
          <span className="font-medium">{toothName(selected, lang)}</span>
          <span className="ml-2 text-muted-foreground">
            FDI {selected} · Universal {universalOf(selected)} · Palmer {palmerOf(selected)}
          </span>
          {highlighted.get(selected) && <span className="ml-2">— {highlighted.get(selected)}</span>}
        </p>
      )}
      {visualization.teeth.some((tooth) => tooth.label) && (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {visualization.teeth.filter((tooth) => tooth.label).map((tooth) => (
            <li key={tooth.code}>
              <span className="data-num font-medium text-foreground">{show(tooth.code)}</span> {tooth.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --- timeline -------------------------------------------------------------------

const UNIT_KEYS = { day: 'viz.timelineDay', week: 'viz.timelineWeek', month: 'viz.timelineMonth', year: 'viz.timelineYear' } as const

export function TutorTimelineFigure({ visualization, layout, t }: { visualization: TimelineVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { events, unit } = visualization
  const groups = [...new Set(events.map((e) => e.group ?? ''))]
  const lo = Math.min(...events.map((e) => e.start))
  const hi = Math.max(...events.map((e) => e.end ?? e.start))
  const pad = Math.max((hi - lo) * 0.05, 0.5)
  const width = layout.width
  const left = groups.some(Boolean) ? 90 : 20
  const sx = (v: number) => left + ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (width - left - 20)
  const laneHeight = 26
  const rowsPerGroup = groups.map((group) => events.filter((e) => (e.group ?? '') === group))
  const height = 40 + rowsPerGroup.reduce((sum, list) => sum + list.length * laneHeight + 10, 0)
  const step = Math.max(1, Number(((hi - lo) / 8).toPrecision(1)))
  const ticks: number[] = []
  for (let v = Math.ceil((lo - pad) / step) * step; v <= hi + pad; v += step) ticks.push(Number(v.toPrecision(10)))
  let y = 14
  return (
    <div className="space-y-2 px-1 py-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('viz.timelineAria', { count: events.length })} className="block h-auto w-full max-w-full">
        <title>{t('viz.timelineAria', { count: events.length })}</title>
        <g aria-hidden="true">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={sx(v)} x2={sx(v)} y1={10} y2={height - 26} stroke="hsl(var(--viz-grid))" />
              <text x={sx(v)} y={height - 10} textAnchor="middle" fontSize="10" fill={LABEL}>{formatNumber(v, 4)}</text>
            </g>
          ))}
          <text x={width - 20} y={height - 10} textAnchor="end" fontSize="10" fill={LABEL}>{t(UNIT_KEYS[unit])}</text>
          {rowsPerGroup.map((list, g) => {
            const top = y
            const block = (
              <g key={g}>
                {groups[g] && (
                  <text x={8} y={top + 16} fontSize="11" fontWeight="600" fill={SERIES[g % 4]}>{groups[g]}</text>
                )}
                {list.map((event, i) => {
                  const cy = top + i * laneHeight + 12
                  const color = SERIES[g % 4]!
                  return (
                    <g key={event.label + i}>
                      {event.end !== undefined ? (
                        <rect x={sx(event.start)} y={cy - 6} width={Math.max(3, sx(event.end) - sx(event.start))} height={12} rx="3" fill={SERIES_SOFT[g % 4]} stroke={color} />
                      ) : (
                        <circle cx={sx(event.start)} cy={cy} r="5" fill={color} />
                      )}
                      <text x={sx(event.end ?? event.start) + 8} y={cy + 4} fontSize="11" fill={FOREGROUND}>
                        {event.label}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
            y += list.length * laneHeight + 10
            return block
          })}
        </g>
      </svg>
    </div>
  )
}

// --- neural pathway -----------------------------------------------------------------

const LEVEL_ORDER: NervousLevel[] = ['cortex', 'thalamus', 'midbrain', 'pons', 'medulla', 'spinal_cord', 'periphery']
const LEVEL_KEYS = {
  cortex: 'viz.levelCortex',
  thalamus: 'viz.levelThalamus',
  midbrain: 'viz.levelMidbrain',
  pons: 'viz.levelPons',
  medulla: 'viz.levelMedulla',
  spinal_cord: 'viz.levelSpinalCord',
  periphery: 'viz.levelPeriphery',
} as const

export function TutorNeuralPathwayFigure({ visualization, layout, t }: { visualization: NeuralPathwayVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { neurons, side } = visualization
  const [shown, setShown] = useState(neurons.length)
  const width = layout.width
  const rowH = 44
  const height = LEVEL_ORDER.length * rowH + 20
  const labelW = 86
  const mid = labelW + (width - labelW) / 2
  const sideX = (s: 'left' | 'right') => (s === 'left' ? mid + (width - labelW) * 0.22 : mid - (width - labelW) * 0.22)
  const levelY = (level: NervousLevel) => 20 + LEVEL_ORDER.indexOf(level) * rowH
  // The side of each neuron's cell body: it switches after a decussating axon.
  // The viewer looks at the patient, so the patient's right is on the left.
  const sides: Array<'left' | 'right'> = []
  let current: 'left' | 'right' = side
  neurons.forEach((n, i) => {
    sides.push(current)
    if (n.decussates && i < neurons.length - 1) current = current === 'left' ? 'right' : 'left'
  })
  const crossing = neurons.find((n) => n.decussates)
  return (
    <div className="space-y-2 px-1 py-2">
      <p className="text-center text-sm font-medium">{visualization.name}</p>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('viz.pathwayAria', { name: visualization.name, count: neurons.length })} className="block h-auto w-full max-w-full">
        <title>{t('viz.pathwayAria', { name: visualization.name, count: neurons.length })}</title>
        <g aria-hidden="true">
          {LEVEL_ORDER.map((level) => (
            <g key={level}>
              <line x1={labelW} x2={width - 8} y1={levelY(level)} y2={levelY(level)} stroke="hsl(var(--viz-grid))" />
              <text x={4} y={levelY(level) + 4} fontSize="11" fill={LABEL}>{t(LEVEL_KEYS[level])}</text>
            </g>
          ))}
          <line x1={mid} x2={mid} y1={10} y2={height - 6} stroke={AXIS} strokeDasharray="4 4" />
          <text x={mid - 6} y={14} textAnchor="end" fontSize="10" fill={LABEL}>{t('viz.pathwayRight')}</text>
          <text x={mid + 6} y={14} fontSize="10" fill={LABEL}>{t('viz.pathwayLeft')}</text>
          {neurons.slice(0, shown).map((neuron, i) => {
            const x = sideX(sides[i]!)
            const y = levelY(neuron.level)
            const next = neurons[i + 1]
            const nx = next ? sideX(neuron.decussates ? (sides[i] === 'left' ? 'right' : 'left') : sides[i]!) : x
            const ny = next ? levelY(next.level) : y
            const color = SERIES[i % 4]!
            // A crossing away from the cell body runs down its own side first.
            const cy = neuron.crossesAt && next ? levelY(neuron.crossesAt) : null
            const span = Math.abs(ny - y) / 4 || rowH / 2
            const axon =
              cy !== null
                ? `M ${x} ${y} L ${x} ${cy - Math.sign(ny - y) * span / 2} C ${x} ${cy}, ${nx} ${cy}, ${nx} ${cy + Math.sign(ny - y) * span / 2} L ${nx} ${ny}`
                : `M ${x} ${y} C ${x} ${(y + ny) / 2}, ${nx} ${(y + ny) / 2}, ${nx} ${ny}`
            return (
              <g key={i}>
                {next && <path d={axon} fill="none" stroke={color} strokeWidth="2.4" />}
                <circle cx={x} cy={y} r="7" fill={color} />
                <text x={x + (sides[i] === 'left' ? 12 : -12)} y={y - 6} textAnchor={sides[i] === 'left' ? 'start' : 'end'} fontSize="11" fill={FOREGROUND}>
                  {i + 1}. {neuron.cellBody}
                </text>
                {neuron.tract && (
                  <text x={(x + nx) / 2 + (sides[i] === 'left' ? 10 : -10)} y={(y + ny) / 2} textAnchor={sides[i] === 'left' ? 'start' : 'end'} fontSize="10" fill={LABEL}>
                    {neuron.tract}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="rounded-md border border-border/70 px-3 py-2">
        <ParamSlider label={t('viz.pathwayNeurons')} value={shown} min={1} max={neurons.length} step={1} onChange={(v) => setShown(Math.round(v))} />
      </div>
      <p className="text-center text-[13px] text-muted-foreground">
        {crossing ? t('viz.pathwayCrosses', { level: t(LEVEL_KEYS[crossing.crossesAt ?? crossing.level]), neuron: neurons.indexOf(crossing) + 1 }) : t('viz.pathwayNoCrossing')}
      </p>
    </div>
  )
}

// --- anatomy relation table -----------------------------------------------------------

export function TutorAnatomyTableFigure({ visualization, t }: { visualization: AnatomyTableVisualization; t: T }): JSX.Element {
  const lesson = useLessonFigureContext()
  const [busy, setBusy] = useState(false)
  async function addCards() {
    if (!lesson) return
    setBusy(true)
    try {
      const added = await new ReviewCardService().addFromTable(lesson.projectId, { ...visualization, topicId: lesson.topicId })
      toast({ variant: 'success', title: t('cards.addedFromTable', { count: added }) })
    } catch (err) {
      toast({ variant: 'error', title: t('cards.addFailed'), description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 px-1 py-2">
      {visualization.title && <p className="text-center text-sm font-medium">{visualization.title}</p>}
      <div className="overflow-x-auto overflow-y-hidden">
        <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-2 py-1.5 font-normal" />
              {visualization.columns.map((column) => (
                <th key={column} scope="col" className="px-2 py-1.5 font-medium">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visualization.rows.map((row) => (
              <tr key={row.name} className="border-b border-border/60 align-top">
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 font-semibold">{row.name}</th>
                {row.cells.map((cell, i) => (
                  <td key={i} className="px-2 py-1.5">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lesson && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void addCards()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Layers />}
            {t('cards.addFromTable', { count: visualization.rows.length * visualization.columns.length })}
          </Button>
        </div>
      )}
    </div>
  )
}
