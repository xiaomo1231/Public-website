import { useState, type ReactNode } from 'react'
import { formatNumber } from '@/entities/tutorVisualization/distribution'
import {
  concentrationAtTime,
  energyYield,
  isoelectricPoint,
  netCharge,
  pkFacts,
  type PoConvention,
  type Shuttle,
} from '@/entities/tutorVisualization/medicine'
import type {
  AminoAcidVisualization,
  MetabolismVisualization,
  PharmacokineticsVisualization,
} from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import type { PlotLayout } from './plotLayout'
import { ParamSlider, PlotFrame } from './PlotFrame'
import { LABEL, SERIES, SERIES_SOFT, linePath, niceRange } from './plotUtils'

type T = UseTranslationResult['t']
const f = formatNumber

function Facts({ children }: { children: ReactNode }): JSX.Element {
  return <div className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-center text-[13px] text-muted-foreground">{children}</div>
}

function Toggle<V extends string>({ value, options, onChange, label }: { value: V; options: Array<{ value: V; label: string }>; onChange: (v: V) => void; label: string }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn('focus-ring rounded-md border px-2 py-1 text-xs', value === option.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border/80 text-muted-foreground hover:bg-accent')}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// --- amino acid charge ----------------------------------------------------------

export function TutorAminoAcidFigure({ visualization, layout, t }: { visualization: AminoAcidVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { groups } = visualization
  const pi = isoelectricPoint(groups)
  const curve = Array.from({ length: 281 }, (_, i) => ({ x: i * 0.05, y: netCharge(groups, i * 0.05) }))
  const bases = groups.filter((g) => g.kind === 'base').length
  const acids = groups.filter((g) => g.kind === 'acid').length
  const yRange: [number, number] = [-acids - 0.3, bases + 0.3]
  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame width={layout.width} height={Math.round(layout.compact ? layout.width * 0.75 : layout.height * 0.62)} xRange={[0, 14]} yRange={yRange} xLabel="pH" yLabel={t('viz.aminoCharge')} label={t('viz.aminoAria', { name: visualization.name, pi: f(pi, 3) })} compact={layout.compact}>
        {(scale) => (
          <>
            {groups.map((g, i) => (
              <g key={i}>
                <line x1={scale.sx(g.pka)} x2={scale.sx(g.pka)} y1={scale.top} y2={scale.bottom} stroke={LABEL} strokeDasharray="3 4" />
                <text x={scale.sx(g.pka) + 3} y={scale.top + 12 + i * 13} fontSize="10" fill={LABEL}>
                  pKₐ {f(g.pka, 3)}{g.label ? ` (${g.label})` : ''}
                </text>
              </g>
            ))}
            <path d={linePath(curve, scale, yRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.4" />
            <circle cx={scale.sx(pi)} cy={scale.sy(0)} r="5" fill={SERIES[1]} />
          </>
        )}
      </PlotFrame>
      <Facts>
        <span className="font-medium text-foreground">pI = {f(pi, 3)}</span>
        <span>{t('viz.aminoBelow')}</span>
        <span>{t('viz.aminoAbove')}</span>
      </Facts>
    </div>
  )
}

// --- metabolic energy yield --------------------------------------------------------

export function TutorMetabolismFigure({ visualization, t }: { visualization: MetabolismVisualization; t: T }): JSX.Element {
  const [convention, setConvention] = useState<PoConvention>(visualization.convention)
  const [shuttle, setShuttle] = useState<Shuttle>(visualization.shuttle)
  const result = energyYield(visualization.steps, convention, shuttle)
  const chip = (value: number | undefined, name: string, tone: number) =>
    value ? (
      <span className="data-num rounded px-1.5 py-0.5 text-[11px]" style={{ background: SERIES_SOFT[tone], color: SERIES[tone] }}>
        {value > 0 ? '+' : ''}
        {value} {name}
      </span>
    ) : null
  const hasCytosolicNadh = visualization.steps.some((s) => s.compartment === 'cytosol' && s.nadh)
  return (
    <div className="space-y-3 px-1 py-2">
      <p className="text-center text-sm font-medium">{visualization.pathway}</p>
      <ol className="space-y-1" aria-label={t('viz.metabolismSteps')}>
        {visualization.steps.map((step, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/70 px-2 py-1.5 text-[13px]">
            <span className="data-num w-5 text-right text-xs text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1">
              {step.label}
              {step.enzyme && <span className="ml-1.5 text-xs text-muted-foreground">({step.enzyme})</span>}
              {step.compartment === 'cytosol' && <span className="ml-1.5 text-[11px] text-muted-foreground">{t('viz.metabolismCytosol')}</span>}
            </span>
            {chip(step.atp, 'ATP', 0)}
            {chip(step.gtp, 'GTP', 0)}
            {chip(step.nadh, 'NADH', 1)}
            {chip(step.fadh2, 'FADH₂', 2)}
            {chip(step.co2, 'CO₂', 3)}
            {step.times && step.times > 1 && <span className="data-num text-xs font-medium">×{step.times}</span>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap justify-center gap-3">
        <Toggle
          label={t('viz.metabolismConvention')}
          value={convention}
          onChange={setConvention}
          options={[
            { value: 'modern', label: t('viz.metabolismModern') },
            { value: 'classic', label: t('viz.metabolismClassic') },
          ]}
        />
        {hasCytosolicNadh && (
          <Toggle
            label={t('viz.metabolismShuttle')}
            value={shuttle}
            onChange={setShuttle}
            options={[
              { value: 'malate_aspartate', label: t('viz.metabolismMalate') },
              { value: 'glycerol_phosphate', label: t('viz.metabolismGlycerol') },
            ]}
          />
        )}
      </div>
      <div className="overflow-x-auto overflow-y-hidden">
        <table className="mx-auto border-collapse text-[13px]" aria-label={t('viz.metabolismTotals')}>
          <tbody className="data-num">
            <tr className="border-b border-border/70">
              <th className="px-2 py-1 text-left font-normal text-muted-foreground">{t('viz.metabolismSubstrate')}</th>
              <td className="px-2 py-1 text-right">{f(result.substrateLevel, 4)}</td>
            </tr>
            <tr className="border-b border-border/70">
              <th className="px-2 py-1 text-left font-normal text-muted-foreground">NADH × {result.poNadh}</th>
              <td className="px-2 py-1 text-right">{f(result.nadhMitochondria * result.poNadh, 4)}</td>
            </tr>
            {result.nadhCytosol > 0 && (
              <tr className="border-b border-border/70">
                <th className="px-2 py-1 text-left font-normal text-muted-foreground">
                  {t('viz.metabolismCytosolNadh')} × {shuttle === 'malate_aspartate' ? result.poNadh : result.poFadh2}
                </th>
                <td className="px-2 py-1 text-right">{f(result.nadhCytosol * (shuttle === 'malate_aspartate' ? result.poNadh : result.poFadh2), 4)}</td>
              </tr>
            )}
            <tr className="border-b border-border/70">
              <th className="px-2 py-1 text-left font-normal text-muted-foreground">FADH₂ × {result.poFadh2}</th>
              <td className="px-2 py-1 text-right">{f(result.fadh2 * result.poFadh2, 4)}</td>
            </tr>
            <tr>
              <th className="px-2 py-1 text-left font-semibold">{t('viz.metabolismTotal')}</th>
              <td className="px-2 py-1 text-right font-semibold">{f(result.total, 4)} ATP</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Facts>
        <span>NADH {result.nadhMitochondria + result.nadhCytosol}</span>
        <span>FADH₂ {result.fadh2}</span>
        <span>CO₂ {result.co2}</span>
      </Facts>
    </div>
  )
}

// --- pharmacokinetics ----------------------------------------------------------------

export function TutorPharmacokineticsFigure({ visualization, layout, t }: { visualization: PharmacokineticsVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const multiple = (visualization.doses ?? 1) > 1
  const [interval, setDosingInterval] = useState(visualization.interval ?? visualization.halfLife)
  const [dose, setDose] = useState(visualization.dose)
  const regimen = { ...visualization, dose, ...(multiple ? { interval } : {}) }
  const facts = pkFacts(regimen)
  const span = multiple ? interval * (visualization.doses ?? 1) + visualization.halfLife * 2 : visualization.halfLife * 6
  const curve = Array.from({ length: 401 }, (_, i) => {
    const time = (span * i) / 400
    return { x: time, y: concentrationAtTime(regimen, time) }
  })
  const yRange = niceRange([...curve.map((p) => p.y), visualization.mtc ?? 0, visualization.mec ?? 0], [0])
  const routeKey = visualization.route === 'oral' ? 'viz.pkOral' : 'viz.pkIv'
  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame width={layout.width} height={Math.round(layout.compact ? layout.width * 0.75 : layout.height * 0.62)} xRange={[0, span]} yRange={[0, yRange[1]]} xLabel="t (h)" yLabel="C (mg/L)" label={t('viz.pkAria', { drug: visualization.drug ?? '', halfLife: f(visualization.halfLife, 3) })} compact={layout.compact}>
        {(scale) => (
          <>
            {visualization.mec !== undefined && visualization.mtc !== undefined && (
              <rect x={scale.left} y={scale.sy(visualization.mtc)} width={scale.right - scale.left} height={scale.sy(visualization.mec) - scale.sy(visualization.mtc)} fill={SERIES_SOFT[2]} />
            )}
            {visualization.mec !== undefined && <line x1={scale.left} x2={scale.right} y1={scale.sy(visualization.mec)} y2={scale.sy(visualization.mec)} stroke={SERIES[2]} strokeDasharray="5 4" />}
            {visualization.mtc !== undefined && <line x1={scale.left} x2={scale.right} y1={scale.sy(visualization.mtc)} y2={scale.sy(visualization.mtc)} stroke={SERIES[1]} strokeDasharray="5 4" />}
            {facts.averageSteadyState !== undefined && (
              <line x1={scale.left} x2={scale.right} y1={scale.sy(facts.averageSteadyState)} y2={scale.sy(facts.averageSteadyState)} stroke={LABEL} strokeDasharray="2 4" />
            )}
            <path d={linePath(curve, scale, [0, yRange[1]])} fill="none" stroke={SERIES[0]} strokeWidth="2.2" />
          </>
        )}
      </PlotFrame>
      <div className="space-y-1.5 rounded-md border border-border/70 px-3 py-2">
        <ParamSlider label={t('viz.pkDose')} value={dose} min={visualization.dose / 4} max={visualization.dose * 2} step={visualization.dose / 40} unit="mg" onChange={setDose} />
        {multiple && <ParamSlider label={t('viz.pkInterval')} value={interval} min={visualization.halfLife / 4} max={visualization.halfLife * 3} step={visualization.halfLife / 40} unit="h" onChange={setDosingInterval} />}
      </div>
      <Facts>
        <span className="font-medium text-foreground">{visualization.drug ? `${visualization.drug} · ` : ''}{t(routeKey)}</span>
        <span>t½ = {f(visualization.halfLife, 3)} h · k = {f(facts.ke, 3)} h⁻¹</span>
        <span>CL = {f(facts.clearance, 3)} L/h · V = {f(visualization.vd, 3)} L</span>
        <span>AUC = {f(facts.auc, 4)} mg·h/L</span>
        {facts.averageSteadyState !== undefined && <span>C̄ss = {f(facts.averageSteadyState, 3)} mg/L</span>}
        {facts.accumulation !== undefined && <span>R = {f(facts.accumulation, 3)}</span>}
        {facts.peakSteadyState !== undefined && <span>Css,max {f(facts.peakSteadyState, 3)} · Css,min {f(facts.troughSteadyState!, 3)} mg/L</span>}
        <span>{t('viz.pkSteadyState', { value: f(facts.timeToSteadyState, 3) })}</span>
      </Facts>
      <p className="text-center text-[11px] text-muted-foreground">{t('viz.pkDisclaimer')}</p>
    </div>
  )
}
