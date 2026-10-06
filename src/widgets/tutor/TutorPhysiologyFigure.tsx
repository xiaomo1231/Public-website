import { useState, type ReactNode } from 'react'
import { formatNumber } from '@/entities/tutorVisualization/distribution'
import {
  analyzeAcidBase,
  cardiacFacts,
  clearance,
  goldman,
  lungCapacities,
  nernst,
  netFiltrationPressure,
  oxygenContent,
  pvLoop,
  saturation,
  spirogram,
  type AcidBaseDisorder,
} from '@/entities/tutorVisualization/medicine'
import type {
  AcidBaseVisualization,
  ActionPotentialVisualization,
  CardiacVisualization,
  LungVolumesVisualization,
  MembranePotentialVisualization,
  OxygenVisualization,
  RenalVisualization,
} from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { PlotLayout } from './plotLayout'
import { ParamSlider, PlotFrame } from './PlotFrame'
import { AXIS, FOREGROUND, LABEL, SERIES, SERIES_SOFT, linePath } from './plotUtils'

type T = UseTranslationResult['t']
const f = formatNumber

function Facts({ children }: { children: ReactNode }): JSX.Element {
  return <div className="data-num flex flex-wrap justify-center gap-x-4 gap-y-1 text-center text-[13px] text-muted-foreground">{children}</div>
}

function Teaching({ t }: { t: T }): JSX.Element {
  return <p className="text-center text-[11px] text-muted-foreground">{t('viz.medicalTeachingOnly')}</p>
}

function plotHeight(layout: PlotLayout, ratio = 0.62): number {
  return Math.round(layout.compact ? layout.width * 0.78 : layout.height * ratio)
}

// --- membrane potential -----------------------------------------------------------

export function TutorMembraneFigure({ visualization, layout, t }: { visualization: MembranePotentialVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const potassium = visualization.ions.find((ion) => ion.ion === 'K+')
  const [kOut, setKOut] = useState(potassium?.outside ?? 4)
  const ions = visualization.ions.map((ion) => (ion.ion === 'K+' ? { ...ion, outside: kOut } : ion))
  const potentials = ions.map((ion) => ({ ion: ion.ion, value: nernst(ion.ion, ion.inside, ion.outside, visualization.celsius) }))
  const vm = goldman(ions, visualization.celsius)
  const values = [...potentials.map((p) => p.value), ...(vm !== null ? [vm] : []), 0]
  const lo = Math.min(-120, Math.floor(Math.min(...values) / 20) * 20 - 10)
  const hi = Math.max(80, Math.ceil(Math.max(...values) / 20) * 20 + 10)
  const width = layout.width
  const height = 120 + potentials.length * 0
  const sx = (v: number) => 30 + ((v - lo) / (hi - lo)) * (width - 60)
  const label = t('viz.membraneAria', { vm: vm === null ? '—' : f(vm, 3) })
  return (
    <div className="space-y-2 px-1 py-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
        <title>{label}</title>
        <g aria-hidden="true">
          <line x1={30} x2={width - 30} y1={70} y2={70} stroke={AXIS} strokeWidth="1.4" />
          {Array.from({ length: Math.floor((hi - lo) / 20) + 1 }, (_, i) => lo + i * 20).map((v) => (
            <g key={v}>
              <line x1={sx(v)} x2={sx(v)} y1={66} y2={74} stroke={AXIS} />
              <text x={sx(v)} y={90} textAnchor="middle" fontSize="10" fill={LABEL}>{v}</text>
            </g>
          ))}
          <text x={width - 30} y={108} textAnchor="end" fontSize="11" fill={LABEL}>mV</text>
          {potentials.map((p, i) => (
            <g key={p.ion}>
              <line x1={sx(p.value)} x2={sx(p.value)} y1={44 - (i % 2) * 16} y2={70} stroke={SERIES[i % 4]} strokeWidth="2" />
              <text x={sx(p.value)} y={38 - (i % 2) * 16} textAnchor="middle" fontSize="11" fill={SERIES[i % 4]}>
                E{p.ion} {f(p.value, 3)}
              </text>
            </g>
          ))}
          {vm !== null && (
            <g>
              <path d={`M ${sx(vm) - 6} 82 L ${sx(vm)} 72 L ${sx(vm) + 6} 82 Z`} fill={FOREGROUND} />
              <text x={sx(vm)} y={104} textAnchor="middle" fontSize="12" fontWeight="600" fill={FOREGROUND}>Vm {f(vm, 3)}</text>
            </g>
          )}
        </g>
      </svg>
      {potassium && (
        <div className="rounded-md border border-border/70 px-3 py-2">
          <ParamSlider label="[K⁺]ₒ" value={kOut} min={1} max={Math.max(12, potassium.outside * 2)} step={0.1} unit="mmol/L" onChange={setKOut} />
        </div>
      )}
      <div className="overflow-x-auto overflow-y-hidden">
        <table className="mx-auto border-collapse text-center text-[13px]">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-2 py-1 font-normal" />
              <th className="px-2 py-1 font-normal">{t('viz.membraneInside')}</th>
              <th className="px-2 py-1 font-normal">{t('viz.membraneOutside')}</th>
              <th className="px-2 py-1 font-normal">E (mV)</th>
            </tr>
          </thead>
          <tbody>
            {ions.map((ion, i) => (
              <tr key={ion.ion} className="data-num border-t border-border/70">
                <th className="px-2 py-1 font-medium">{ion.ion}</th>
                <td className="px-2 py-1">{f(ion.inside, 4)}</td>
                <td className="px-2 py-1">{f(ion.outside, 4)}</td>
                <td className="px-2 py-1">{f(potentials[i]!.value, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Facts>
        <span>{t('viz.membraneNernst', { celsius: visualization.celsius })}</span>
        {vm !== null ? <span className="font-medium text-foreground">{t('viz.membraneGhk', { vm: f(vm, 3) })}</span> : <span>{t('viz.membraneNoGhk')}</span>}
      </Facts>
    </div>
  )
}

// --- action potential -----------------------------------------------------------------

function actionPotentialCurve(v: ActionPotentialVisualization): { points: Array<{ x: number; y: number }>; phases: Array<{ x: number; label: string }>; unit: number } {
  const { resting: r, threshold: th, peak: p } = v
  const pts: Array<{ x: number; y: number }> = []
  const seg = (x0: number, x1: number, y: (s: number) => number, n = 30) => {
    for (let i = 0; i <= n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, y: y(i / n) })
  }
  if (v.cell === 'neuron') {
    seg(0, 1, () => r, 4)
    seg(1, 1.4, (s) => r + (th - r) * s * s)
    seg(1.4, 1.6, (s) => th + (p - th) * Math.sin((s * Math.PI) / 2))
    seg(1.6, 2.5, (s) => p - (p - (r - 10)) * Math.sin((s * Math.PI) / 2))
    seg(2.5, 4, (s) => r - 10 + 10 * (1 - Math.exp(-4 * s)) / (1 - Math.exp(-4)))
    return { points: pts, phases: [{ x: 1.2, label: '①' }, { x: 1.5, label: '②' }, { x: 2.1, label: '③' }, { x: 3.2, label: '④' }], unit: 1 }
  }
  if (v.cell === 'ventricular') {
    seg(0, 20, () => r, 4)
    seg(20, 22, (s) => r + (p - r) * s)
    seg(22, 30, (s) => p - (p - 5) * s)
    seg(30, 220, (s) => 5 - 15 * s)
    seg(220, 300, (s) => -10 - (-10 - r) * Math.sin((s * Math.PI) / 2))
    seg(300, 380, () => r, 4)
    return { points: pts, phases: [{ x: 21, label: '0' }, { x: 26, label: '1' }, { x: 125, label: '2' }, { x: 260, label: '3' }, { x: 340, label: '4' }], unit: 1 }
  }
  // Pacemaker (sinoatrial node): slow diastolic depolarisation, slow upstroke.
  for (let cycle = 0; cycle < 2; cycle++) {
    const o = cycle * 400
    seg(o, o + 250, (s) => r + (th - r) * s)
    seg(o + 250, o + 300, (s) => th + (p - th) * Math.sin((s * Math.PI) / 2))
    seg(o + 300, o + 400, (s) => p - (p - r) * Math.sin((s * Math.PI) / 2))
  }
  return { points: pts, phases: [{ x: 125, label: '4' }, { x: 275, label: '0' }, { x: 350, label: '3' }], unit: 1 }
}

export function TutorActionPotentialFigure({ visualization, layout, t }: { visualization: ActionPotentialVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { points, phases } = actionPotentialCurve(visualization)
  const xMax = points[points.length - 1]!.x
  const yRange: [number, number] = [Math.min(visualization.resting - 20, -100), Math.max(visualization.peak + 15, 40)]
  const cellKey = visualization.cell === 'neuron' ? 'viz.apNeuron' : visualization.cell === 'ventricular' ? 'viz.apVentricular' : 'viz.apPacemaker'
  const notesKey = visualization.cell === 'neuron' ? 'viz.apNeuronPhases' : visualization.cell === 'ventricular' ? 'viz.apVentricularPhases' : 'viz.apPacemakerPhases'
  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame width={layout.width} height={plotHeight(layout)} xRange={[0, xMax]} yRange={yRange} xLabel={visualization.cell === 'neuron' ? 't (ms)' : 't (ms)'} yLabel="mV" label={t('viz.apAria', { cell: t(cellKey) })} compact={layout.compact}>
        {(scale) => (
          <>
            <line x1={scale.left} x2={scale.right} y1={scale.sy(visualization.threshold)} y2={scale.sy(visualization.threshold)} stroke={LABEL} strokeDasharray="5 4" />
            <path d={linePath(points, scale, yRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.4" />
            {phases.map((phase) => (
              <text key={phase.label + phase.x} x={scale.sx(phase.x)} y={scale.top + 14} textAnchor="middle" fontSize="12" fill={SERIES[1]}>
                {phase.label}
              </text>
            ))}
          </>
        )}
      </PlotFrame>
      <Facts>
        <span className="font-medium text-foreground">{t(cellKey)}</span>
        <span>{t('viz.apValues', { resting: visualization.resting, threshold: visualization.threshold, peak: visualization.peak })}</span>
      </Facts>
      <p className="text-center text-xs text-muted-foreground">{t(notesKey)}</p>
      <p className="text-center text-[11px] text-muted-foreground">{t('viz.apSchematic')}</p>
    </div>
  )
}

// --- oxygen ----------------------------------------------------------------------------

export function TutorOxygenFigure({ visualization, layout, t }: { visualization: OxygenVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const xMax = Math.max(120, ...visualization.markers) * 1.05
  const xs = Array.from({ length: 241 }, (_, i) => (xMax * i) / 240)
  const first = visualization.curves[0]!
  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame width={layout.width} height={plotHeight(layout)} xRange={[0, xMax]} yRange={[0, 105]} xLabel="PO₂ (mmHg)" yLabel="SO₂ (%)" label={t('viz.oxygenAria', { p50: f(first.p50, 3) })} compact={layout.compact}>
        {(scale) => (
          <>
            {visualization.markers.map((m) => (
              <line key={m} x1={scale.sx(m)} x2={scale.sx(m)} y1={scale.top} y2={scale.bottom} stroke={LABEL} strokeDasharray="3 4" />
            ))}
            <line x1={scale.left} x2={scale.right} y1={scale.sy(50)} y2={scale.sy(50)} stroke={LABEL} strokeDasharray="2 5" />
            {visualization.curves.map((curve, i) => (
              <g key={curve.label}>
                <path d={linePath(xs.map((x) => ({ x, y: 100 * saturation(x, curve.p50, curve.n) })), scale, [0, 105])} fill="none" stroke={SERIES[i % 4]} strokeWidth="2.4" strokeDasharray={i ? '7 4' : undefined} />
                <circle cx={scale.sx(curve.p50)} cy={scale.sy(50)} r="4" fill={SERIES[i % 4]} />
              </g>
            ))}
          </>
        )}
      </PlotFrame>
      <ul className="flex flex-wrap justify-center gap-x-4 text-[13px]">
        {visualization.curves.map((curve, i) => (
          <li key={curve.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: SERIES[i % 4] }} />
            {curve.label}: P₅₀ = {f(curve.p50, 3)} mmHg
          </li>
        ))}
      </ul>
      <Facts>
        {visualization.markers.map((m) => (
          <span key={m}>
            {t('viz.oxygenAt', { po2: f(m, 3), so2: f(100 * saturation(m, first.p50, first.n), 3), content: f(oxygenContent(visualization.hb, m, first.p50, first.n), 3) })}
          </span>
        ))}
        {visualization.markers.length >= 2 && (
          <span className="font-medium text-foreground">
            {t('viz.oxygenExtraction', {
              value: f(
                oxygenContent(visualization.hb, Math.max(...visualization.markers), first.p50, first.n) -
                  oxygenContent(visualization.hb, Math.min(...visualization.markers), first.p50, first.n),
                3,
              ),
            })}
          </span>
        )}
      </Facts>
      <p className="text-center text-xs text-muted-foreground">{t('viz.oxygenShift')}</p>
    </div>
  )
}

// --- cardiac pressure–volume loop ----------------------------------------------------------

export function TutorCardiacFigure({ visualization, layout, t }: { visualization: CardiacVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const loop = pvLoop(visualization)
  const facts = cardiacFacts(visualization)
  const xRange: [number, number] = [Math.max(0, visualization.esv - 30), visualization.edv + 30]
  const yRange: [number, number] = [0, visualization.peak * 1.15]
  const phaseKeys = ['viz.cardiacFilling', 'viz.cardiacIsoContraction', 'viz.cardiacEjection', 'viz.cardiacIsoRelaxation'] as const
  const events = [
    { v: visualization.edv, p: visualization.edp, key: 'viz.cardiacMitralCloses' as const },
    { v: visualization.edv, p: visualization.aorticOpen, key: 'viz.cardiacAorticOpens' as const },
    { v: visualization.esv, p: visualization.endSystolic, key: 'viz.cardiacAorticCloses' as const },
    { v: visualization.esv, p: visualization.minimum, key: 'viz.cardiacMitralOpens' as const },
  ]
  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame width={layout.width} height={plotHeight(layout, 0.7)} xRange={xRange} yRange={yRange} xLabel={t('viz.cardiacVolume')} yLabel={t('viz.cardiacPressure')} label={t('viz.cardiacAria', { sv: facts.strokeVolume, ef: f(facts.ejectionFraction * 100, 3) })} compact={layout.compact}>
        {(scale) => (
          <>
            <path d={`${linePath(loop.map((p) => ({ x: p.v, y: p.p })), scale, yRange)} Z`} fill={SERIES_SOFT[0]} stroke="none" />
            {[0, 1, 2, 3].map((phase) => (
              <path key={phase} d={linePath(loop.filter((p) => p.phase === phase).map((p) => ({ x: p.v, y: p.p })), scale, yRange)} fill="none" stroke={SERIES[phase]} strokeWidth="2.6" />
            ))}
          </>
        )}
      </PlotFrame>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        {phaseKeys.map((key, i) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-1 w-4 rounded" style={{ background: SERIES[i] }} />
            {t(key)}
          </li>
        ))}
      </ul>
      <p className="text-center text-xs text-muted-foreground">
        {events.map((e) => `${t(e.key)} (${f(e.v, 3)} mL, ${f(e.p, 3)} mmHg)`).join(' · ')}
      </p>
      <Facts>
        <span className="font-medium text-foreground">SV = {f(facts.strokeVolume, 4)} mL</span>
        <span>EF = {f(facts.ejectionFraction * 100, 3)}%</span>
        {facts.cardiacOutput !== undefined && <span>CO = {f(facts.cardiacOutput, 3)} L/min</span>}
        <span>{t('viz.cardiacWork', { value: f(facts.strokeWorkJoules, 3) })}</span>
      </Facts>
    </div>
  )
}

// --- lung volumes ---------------------------------------------------------------------------

export function TutorLungFigure({ visualization, layout, t }: { visualization: LungVolumesVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const curve = spirogram(visualization).map((p) => ({ x: p.t, y: p.volume }))
  const caps = lungCapacities(visualization)
  const yRange: [number, number] = [0, caps.tlc * 1.08]
  const width = layout.width
  const plotW = Math.round(width * 0.72)
  const levels = { rv: visualization.rv, frc: caps.frc, tidalTop: caps.frc + visualization.tv, tlc: caps.tlc }
  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame
        width={width}
        height={plotHeight(layout, 0.7)}
        xRange={[0, 10]}
        yRange={yRange}
        yLabel="mL"
        label={t('viz.lungAria', { vc: caps.vc, tlc: caps.tlc })}
        compact={layout.compact}
        pad={{ left: 50, right: width - plotW, top: 14, bottom: 20 }}
        overlay={(scale) => {
          const bracket = (x: number, from: number, to: number, label: string, color: string) => (
            <g key={label}>
              <line x1={x} x2={x} y1={scale.sy(from)} y2={scale.sy(to)} stroke={color} strokeWidth="2" />
              <line x1={x - 4} x2={x + 4} y1={scale.sy(from)} y2={scale.sy(from)} stroke={color} />
              <line x1={x - 4} x2={x + 4} y1={scale.sy(to)} y2={scale.sy(to)} stroke={color} />
              <text x={x + 6} y={(scale.sy(from) + scale.sy(to)) / 2 + 4} fontSize="11" fill={color}>{label}</text>
            </g>
          )
          const x = scale.right + 10
          return (
            <>
              {bracket(x, levels.tidalTop, levels.tlc, `IRV ${visualization.irv}`, SERIES[0]!)}
              {bracket(x, levels.frc, levels.tidalTop, `TV ${visualization.tv}`, SERIES[1]!)}
              {bracket(x, levels.rv, levels.frc, `ERV ${visualization.erv}`, SERIES[2]!)}
              {bracket(x, 0, levels.rv, `RV ${visualization.rv}`, SERIES[3]!)}
              {bracket(x + 70, levels.rv, levels.tlc, `VC ${caps.vc}`, FOREGROUND)}
            </>
          )
        }}
      >
        {(scale) => (
          <>
            {[levels.rv, levels.frc, levels.tidalTop, levels.tlc].map((v) => (
              <line key={v} x1={scale.left} x2={scale.right} y1={scale.sy(v)} y2={scale.sy(v)} stroke={LABEL} strokeDasharray="3 4" />
            ))}
            <path d={linePath(curve, scale, yRange)} fill="none" stroke={SERIES[0]} strokeWidth="2.2" />
          </>
        )}
      </PlotFrame>
      <Facts>
        <span>IC = TV + IRV = {caps.ic} mL</span>
        <span>FRC = ERV + RV = {caps.frc} mL</span>
        <span className="font-medium text-foreground">VC = {caps.vc} mL</span>
        <span>TLC = {caps.tlc} mL</span>
      </Facts>
      <p className="text-center text-[11px] text-muted-foreground">{t('viz.lungRvNote')}</p>
    </div>
  )
}

// --- renal ------------------------------------------------------------------------------------

export function TutorRenalFigure({ visualization, layout, t }: { visualization: RenalVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { forces, substances, urineFlow } = visualization
  const nfp = forces ? netFiltrationPressure(forces) : null
  const clearances = substances && urineFlow ? substances.map((s) => ({ ...s, value: clearance(s.urine, s.plasma, urineFlow) })) : []
  const inulin = clearances.find((c) => /inulin|菊粉|肌酐|creatinine/i.test(c.name))
  const pah = clearances.find((c) => /PAH|对氨基马尿酸|aminohippur/i.test(c.name))
  const width = layout.width
  const bars = forces
    ? [
        { key: 'P_GC', value: forces.pgc, sign: 1 },
        { key: 'P_BS', value: forces.pbs, sign: -1 },
        { key: 'π_GC', value: forces.pigc, sign: -1 },
        { key: 'π_BS', value: forces.pibs, sign: 1 },
      ]
    : []
  const maxForce = Math.max(1, ...bars.map((b) => b.value))
  const barScale = (width - 160) / maxForce
  return (
    <div className="space-y-2 px-1 py-2">
      {forces && (
        <svg viewBox={`0 0 ${width} ${bars.length * 30 + 20}`} role="img" aria-label={t('viz.renalAria', { nfp: f(nfp!, 3) })} className="block h-auto w-full max-w-full">
          <title>{t('viz.renalAria', { nfp: f(nfp!, 3) })}</title>
          <g aria-hidden="true">
            {bars.map((bar, i) => (
              <g key={bar.key}>
                <text x={10} y={i * 30 + 24} fontSize="12" fill={FOREGROUND}>{bar.key}</text>
                <rect x={60} y={i * 30 + 12} width={Math.max(1, bar.value * barScale)} height={16} rx="3" fill={bar.sign > 0 ? SERIES[0] : SERIES[1]} />
                <text x={66 + bar.value * barScale} y={i * 30 + 24} fontSize="11" fill={LABEL}>
                  {bar.sign > 0 ? '+' : '−'}{f(bar.value, 3)} mmHg
                </text>
              </g>
            ))}
          </g>
        </svg>
      )}
      {forces && (
        <Facts>
          <span>{t('viz.renalFavoring')}</span>
          <span className="font-medium text-foreground">
            NFP = ({f(forces.pgc, 3)} − {f(forces.pbs, 3)}) − ({f(forces.pigc, 3)} − {f(forces.pibs, 3)}) = {f(nfp!, 3)} mmHg
          </span>
        </Facts>
      )}
      {clearances.length > 0 && (
        <div className="overflow-x-auto overflow-y-hidden">
          <table className="mx-auto border-collapse text-center text-[13px]" aria-label={t('viz.renalClearanceTable')}>
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="px-2 py-1 font-normal" />
                <th className="px-2 py-1 font-normal">U</th>
                <th className="px-2 py-1 font-normal">P</th>
                <th className="px-2 py-1 font-normal">C = U·V/P (mL/min)</th>
              </tr>
            </thead>
            <tbody>
              {clearances.map((c) => (
                <tr key={c.name} className="data-num border-t border-border/70">
                  <th className="px-2 py-1 font-medium">{c.name}</th>
                  <td className="px-2 py-1">{f(c.urine, 4)}</td>
                  <td className="px-2 py-1">{f(c.plasma, 4)}</td>
                  <td className="px-2 py-1">{f(c.value, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-1 text-center text-xs text-muted-foreground">
            V = {f(urineFlow!, 3)} mL/min
            {inulin && pah && <span className="ml-3 font-medium text-foreground">{t('viz.renalFiltrationFraction', { gfr: f(inulin.value, 4), rpf: f(pah.value, 4), ff: f(inulin.value / pah.value, 3) })}</span>}
          </p>
        </div>
      )}
    </div>
  )
}

// --- acid–base --------------------------------------------------------------------------------

const DISORDER_KEYS = {
  normal: 'viz.acidBase_normal',
  metabolic_acidosis: 'viz.acidBase_metabolic_acidosis',
  metabolic_alkalosis: 'viz.acidBase_metabolic_alkalosis',
  respiratory_acidosis: 'viz.acidBase_respiratory_acidosis',
  respiratory_alkalosis: 'viz.acidBase_respiratory_alkalosis',
  mixed_acidosis: 'viz.acidBase_mixed_acidosis',
  mixed_alkalosis: 'viz.acidBase_mixed_alkalosis',
} as const satisfies Record<AcidBaseDisorder, string>

export function TutorAcidBaseFigure({ visualization, layout, t }: { visualization: AcidBaseVisualization; layout: PlotLayout; t: T }): JSX.Element {
  const { ph, paco2, hco3, chronicity } = visualization
  const analysis = analyzeAcidBase(ph, paco2, hco3, chronicity)
  const xRange: [number, number] = [6.9, 7.7]
  const yRange: [number, number] = [0, 50]
  const isobars = [20, 40, 60, 80]
  const xs = Array.from({ length: 81 }, (_, i) => 6.9 + i * 0.01)
  return (
    <div className="space-y-2 px-1 py-2">
      <PlotFrame width={layout.width} height={plotHeight(layout, 0.7)} xRange={xRange} yRange={yRange} xLabel="pH" yLabel="HCO₃⁻ (mmol/L)" label={t('viz.acidBaseAria', { disorder: t(DISORDER_KEYS[analysis.primary]) })} compact={layout.compact}>
        {(scale) => (
          <>
            <rect x={scale.sx(7.35)} y={scale.sy(27)} width={scale.sx(7.45) - scale.sx(7.35)} height={scale.sy(22) - scale.sy(27)} fill={SERIES_SOFT[2]} />
            {isobars.map((pco2) => {
              const pts = xs.map((x) => ({ x, y: 0.03 * pco2 * 10 ** (x - 6.1) }))
              const end = pts.filter((p) => p.y <= 50).at(-1)!
              return (
                <g key={pco2}>
                  <path d={linePath(pts, scale, yRange)} fill="none" stroke={LABEL} strokeWidth="1.2" strokeDasharray={pco2 === 40 ? undefined : '4 4'} />
                  <text x={scale.sx(end.x) - 4} y={scale.sy(end.y) + 12} textAnchor="end" fontSize="10" fill={LABEL}>{pco2} mmHg</text>
                </g>
              )
            })}
            <circle cx={scale.sx(ph)} cy={scale.sy(hco3)} r="6" fill={SERIES[1]} stroke="hsl(var(--card))" strokeWidth="2" />
          </>
        )}
      </PlotFrame>
      <Facts>
        <span>pH {ph} · PaCO₂ {paco2} mmHg · HCO₃⁻ {hco3} mmol/L</span>
        <span className="font-medium text-foreground">{t(DISORDER_KEYS[analysis.primary])}</span>
      </Facts>
      <div className="space-y-0.5 text-center text-xs text-muted-foreground">
        {analysis.compensation.map((c, i) => (
          <p key={i}>
            {t(c.variable === 'paco2' ? 'viz.acidBaseExpectedPaco2' : 'viz.acidBaseExpectedHco3', {
              low: f(c.low, 3),
              high: f(c.high, 3),
              chronicity: c.chronicity ? t(c.chronicity === 'acute' ? 'viz.acidBaseAcute' : 'viz.acidBaseChronic') : '',
            })}
          </p>
        ))}
        {analysis.additionalDisorder && (
          <p className="font-medium text-foreground">
            {t(
              analysis.compensation[0]!.variable === 'paco2'
                ? analysis.additionalDisorder === 'too_high'
                  ? 'viz.acidBaseExtraRespAcidosis'
                  : 'viz.acidBaseExtraRespAlkalosis'
                : analysis.additionalDisorder === 'too_high'
                  ? 'viz.acidBaseExtraMetAlkalosis'
                  : 'viz.acidBaseExtraMetAcidosis',
            )}
          </p>
        )}
        {!analysis.consistent && <p className="text-amber-700 dark:text-amber-400">{t('viz.acidBaseInconsistent', { ph: f(analysis.computedPH, 3) })}</p>}
      </div>
      <Teaching t={t} />
    </div>
  )
}
