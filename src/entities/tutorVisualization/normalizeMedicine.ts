/**
 * Normalizers for the v10 medical figures. Same contract as the others: every
 * value is range-checked against physiology (no negative pressures, ESV < EDV,
 * pKₐ within 0–14, real FDI codes …) and anything implausible is rejected
 * rather than drawn.
 */
import type {
  AcidBaseVisualization,
  ActionPotentialVisualization,
  AminoAcidVisualization,
  AnatomyTableVisualization,
  CardiacVisualization,
  DentalChartVisualization,
  LungVolumesVisualization,
  MembranePotentialVisualization,
  MetabolismVisualization,
  NervousLevel,
  NeuralPathwayVisualization,
  OxygenVisualization,
  PharmacokineticsVisualization,
  RenalVisualization,
  TimelineVisualization,
  TutorVisualization,
  VisualizationDraft,
  VisualizationPlacement,
} from './types'
import { asRecord, readNumber, sanitizeText } from './sanitize'
import { ION_VALENCE, parseFdi, type IonName, type MetabolicStep } from './medicine'

type Normalized = { ok: true; value: TutorVisualization } | { ok: false; reason: string }

interface CommonBase {
  id: string
  schemaVersion: number
  placement: VisualizationPlacement
  caption?: string
}

const LABEL = 60
const fail = (reason: string): Normalized => ({ ok: false, reason })

function num(value: unknown, min: number, max: number): number | null {
  const n = readNumber(value)
  return n !== null && n >= min && n <= max ? n : null
}

function list(value: unknown, min: number, max: number): unknown[] | null {
  return Array.isArray(value) && value.length >= min && value.length <= max ? value : null
}

const IONS = Object.keys(ION_VALENCE) as IonName[]

function normalizeMembrane(draft: VisualizationDraft, base: CommonBase): Normalized {
  const raw = list(draft.ions, 1, 4)
  if (!raw) return fail('invalid-ions')
  const ions: MembranePotentialVisualization['ions'] = []
  for (const item of raw.map(asRecord)) {
    const ion = String(item?.ion ?? '').replace(/\s+/g, '').replace('⁺', '+').replace('⁻', '-').replace('2⁺', '2+')
    const name = IONS.find((candidate) => candidate === ion || candidate.replace(/[+-]/g, '') === ion.replace(/[+-]/g, ''))
    const inside = num(item?.inside, 1e-6, 1000)
    const outside = num(item?.outside, 1e-6, 1000)
    const permeability = num(item?.permeability, 0, 100)
    if (!name || inside === null || outside === null) return fail('invalid-ion')
    if (ions.some((existing) => existing.ion === name)) return fail('duplicate-ion')
    ions.push({ ion: name, inside, outside, ...(permeability !== null && permeability > 0 ? { permeability } : {}) })
  }
  const value: MembranePotentialVisualization = { ...base, type: 'membrane_potential_2d', ions, celsius: num(draft.celsius, 0, 45) ?? 37 }
  return { ok: true, value }
}

const AP_DEFAULTS = {
  neuron: { resting: -70, threshold: -55, peak: 30 },
  ventricular: { resting: -90, threshold: -70, peak: 20 },
  pacemaker: { resting: -60, threshold: -40, peak: 10 },
} as const

function normalizeActionPotential(draft: VisualizationDraft, base: CommonBase): Normalized {
  const cell = draft.cell === 'ventricular' || draft.cell === 'pacemaker' ? draft.cell : 'neuron'
  const d = AP_DEFAULTS[cell]
  const resting = num(draft.resting, -120, -20) ?? d.resting
  const threshold = num(draft.threshold, -100, 0) ?? d.threshold
  const peak = num(draft.peak, -10, 70) ?? d.peak
  if (!(resting < threshold && threshold < peak)) return fail('invalid-action-potential')
  const value: ActionPotentialVisualization = { ...base, type: 'action_potential_2d', cell, resting, threshold, peak }
  return { ok: true, value }
}

function normalizeOxygen(draft: VisualizationDraft, base: CommonBase): Normalized {
  const raw = list(draft.curves, 1, 3) ?? [{ label: 'HbA', p50: 26.8 }]
  const curves = []
  for (const item of raw.map(asRecord)) {
    const p50 = num(item?.p50, 5, 60)
    if (p50 === null) return fail('invalid-oxygen-curve')
    curves.push({ label: sanitizeText(item?.label, LABEL) ?? `P50 ${p50}`, p50, n: num(item?.n, 1, 4) ?? 2.7 })
  }
  const markers = (Array.isArray(draft.markers) ? draft.markers : [100, 40])
    .map((m) => num(m, 1, 600))
    .filter((m): m is number => m !== null)
    .slice(0, 4)
  const value: OxygenVisualization = { ...base, type: 'oxygen_2d', curves, hb: num(draft.hb, 3, 25) ?? 15, markers }
  return { ok: true, value }
}

function normalizeCardiac(draft: VisualizationDraft, base: CommonBase): Normalized {
  const edv = num(draft.edv, 20, 400)
  const esv = num(draft.esv, 5, 350)
  if (edv === null || esv === null || esv >= edv) return fail('invalid-cardiac-volumes')
  const edp = num(draft.edp, 0, 40) ?? 8
  const aorticOpen = num(draft.aorticOpen, 30, 200) ?? 80
  const peak = num(draft.peak, 40, 300) ?? 120
  const endSystolic = num(draft.endSystolic, 30, 250) ?? 100
  const minimum = num(draft.minimum, 0, 30) ?? 4
  if (!(peak >= aorticOpen && peak >= endSystolic && aorticOpen > edp && endSystolic > minimum)) return fail('invalid-cardiac-pressures')
  const hr = num(draft.hr, 20, 250)
  const value: CardiacVisualization = { ...base, type: 'cardiac_2d', edv, esv, edp, aorticOpen, peak, endSystolic, minimum, ...(hr !== null ? { hr } : {}) }
  return { ok: true, value }
}

function normalizeLung(draft: VisualizationDraft, base: CommonBase): Normalized {
  const tv = num(draft.tv, 50, 3000)
  const irv = num(draft.irv, 100, 6000)
  const erv = num(draft.erv, 50, 4000)
  const rv = num(draft.rv, 100, 5000)
  if (tv === null || irv === null || erv === null || rv === null) return fail('invalid-lung-volumes')
  const value: LungVolumesVisualization = { ...base, type: 'lung_volumes_2d', tv, irv, erv, rv }
  return { ok: true, value }
}

function normalizeRenal(draft: VisualizationDraft, base: CommonBase): Normalized {
  const f = asRecord(draft.forces)
  let forces: RenalVisualization['forces']
  if (f) {
    const pgc = num(f.pgc, 0, 200)
    const pbs = num(f.pbs, 0, 100)
    const pigc = num(f.pigc, 0, 100)
    const pibs = num(f.pibs, 0, 50) ?? 0
    if (pgc === null || pbs === null || pigc === null) return fail('invalid-starling-forces')
    forces = { pgc, pbs, pigc, pibs }
  }
  const substances = []
  for (const item of (list(draft.substances, 1, 4) ?? []).map(asRecord)) {
    const name = sanitizeText(item?.name, LABEL)
    const urine = num(item?.urine, 0, 1e6)
    const plasma = num(item?.plasma, 1e-9, 1e6)
    if (!name || urine === null || plasma === null) return fail('invalid-clearance-substance')
    substances.push({ name, urine, plasma })
  }
  const urineFlow = num(draft.urineFlow, 0.01, 50)
  if (substances.length && urineFlow === null) return fail('missing-urine-flow')
  if (!forces && substances.length === 0) return fail('missing-renal-data')
  const value: RenalVisualization = {
    ...base,
    type: 'renal_2d',
    ...(forces ? { forces } : {}),
    ...(substances.length ? { substances, urineFlow: urineFlow! } : {}),
  }
  return { ok: true, value }
}

function normalizeAcidBase(draft: VisualizationDraft, base: CommonBase): Normalized {
  const ph = num(draft.ph, 6.8, 7.8)
  const paco2 = num(draft.paco2, 10, 150)
  const hco3 = num(draft.hco3, 2, 60)
  if (ph === null || paco2 === null || hco3 === null) return fail('invalid-blood-gas')
  const chronicity = draft.chronicity === 'acute' || draft.chronicity === 'chronic' ? draft.chronicity : undefined
  const value: AcidBaseVisualization = { ...base, type: 'acid_base_2d', ph, paco2, hco3, ...(chronicity ? { chronicity } : {}) }
  return { ok: true, value }
}

function normalizeAminoAcid(draft: VisualizationDraft, base: CommonBase): Normalized {
  const name = sanitizeText(draft.name, LABEL)
  const raw = list(draft.groups, 2, 3)
  if (!name || !raw) return fail('invalid-amino-acid')
  const groups: AminoAcidVisualization['groups'] = []
  for (const item of raw.map(asRecord)) {
    const pka = num(item?.pka, 0, 14)
    const kind: 'acid' | 'base' | null = item?.kind === 'base' ? 'base' : item?.kind === 'acid' ? 'acid' : null
    if (pka === null || !kind) return fail('invalid-ionizable-group')
    const label = sanitizeText(item?.label, 24)
    groups.push({ pka, kind, ...(label ? { label } : {}) })
  }
  if (!groups.some((g) => g.kind === 'acid') || !groups.some((g) => g.kind === 'base')) return fail('invalid-amino-acid')
  const value: AminoAcidVisualization = { ...base, type: 'amino_acid_2d', name, groups }
  return { ok: true, value }
}

function normalizeMetabolism(draft: VisualizationDraft, base: CommonBase): Normalized {
  const pathway = sanitizeText(draft.pathway, LABEL)
  const raw = list(draft.steps, 1, 24)
  if (!pathway || !raw) return fail('invalid-pathway')
  const steps: MetabolicStep[] = []
  for (const item of raw.map(asRecord)) {
    const label = sanitizeText(item?.label, 80)
    if (!label) return fail('invalid-pathway-step')
    const count = (key: string) => {
      const n = num(item?.[key], -10, 10)
      return n !== null && n !== 0 ? { [key]: n } : {}
    }
    const enzyme = sanitizeText(item?.enzyme, LABEL)
    const times = num(item?.times, 1, 8)
    steps.push({
      label,
      ...(enzyme ? { enzyme } : {}),
      ...count('atp'),
      ...count('gtp'),
      ...count('nadh'),
      ...count('fadh2'),
      ...count('co2'),
      ...(item?.compartment === 'cytosol' || item?.compartment === 'mitochondria' ? { compartment: item.compartment } : {}),
      ...(times !== null && times > 1 ? { times: Math.round(times) } : {}),
    })
  }
  const value: MetabolismVisualization = {
    ...base,
    type: 'metabolism_2d',
    pathway,
    steps,
    convention: draft.convention === 'classic' ? 'classic' : 'modern',
    shuttle: draft.shuttle === 'glycerol_phosphate' ? 'glycerol_phosphate' : 'malate_aspartate',
  }
  return { ok: true, value }
}

function normalizePharmacokinetics(draft: VisualizationDraft, base: CommonBase): Normalized {
  const route = draft.route === 'oral' ? 'oral' : draft.route === 'iv_bolus' ? 'iv_bolus' : null
  const dose = num(draft.dose, 1e-3, 1e5)
  const vd = num(draft.vd, 0.1, 1e5)
  const halfLife = num(draft.halfLife, 0.01, 2000)
  if (!route || dose === null || vd === null || halfLife === null) return fail('invalid-pk-regimen')
  const bioavailability = num(draft.bioavailability, 0.01, 1)
  const ka = num(draft.ka, 0.01, 50)
  if (route === 'oral' && ka === null) return fail('missing-absorption-rate')
  const doses = num(draft.doses, 1, 30)
  const interval = num(draft.interval, 0.1, 1000)
  if (doses !== null && doses > 1 && interval === null) return fail('missing-dosing-interval')
  const drug = sanitizeText(draft.drug, LABEL)
  const mec = num(draft.mec, 0, 1e5)
  const mtc = num(draft.mtc, 0, 1e5)
  const value: PharmacokineticsVisualization = {
    ...base,
    type: 'pharmacokinetics_2d',
    route,
    dose,
    vd,
    halfLife,
    ...(route === 'oral' ? { bioavailability: bioavailability ?? 1, ka: ka! } : {}),
    ...(doses !== null && doses > 1 ? { doses: Math.round(doses), interval: interval! } : {}),
    ...(drug ? { drug } : {}),
    ...(mec !== null && mec > 0 ? { mec } : {}),
    ...(mtc !== null && mtc > 0 && (mec === null || mtc > mec) ? { mtc } : {}),
  }
  return { ok: true, value }
}

function normalizeDentalChart(draft: VisualizationDraft, base: CommonBase): Normalized {
  const teeth: DentalChartVisualization['teeth'] = []
  for (const item of (list(draft.teeth, 0, 32) ?? []).map(asRecord)) {
    const code = readNumber(item?.code)
    const parsed = code !== null && Number.isInteger(code) ? parseFdi(code) : null
    if (!parsed) return fail('invalid-fdi-code')
    const label = sanitizeText(item?.label, LABEL)
    if (!teeth.some((tooth) => tooth.code === code)) teeth.push({ code: code!, ...(label ? { label } : {}) })
  }
  const dentition =
    draft.dentition === 'primary' || draft.dentition === 'permanent'
      ? draft.dentition
      : teeth.length && teeth.every((tooth) => parseFdi(tooth.code)!.dentition === 'primary')
        ? 'primary'
        : 'permanent'
  if (teeth.some((tooth) => parseFdi(tooth.code)!.dentition !== dentition)) return fail('dentition-mismatch')
  const value: DentalChartVisualization = { ...base, type: 'dental_chart_2d', dentition, teeth }
  return { ok: true, value }
}

function normalizeTimeline(draft: VisualizationDraft, base: CommonBase): Normalized {
  const unit = ['day', 'week', 'month', 'year'].includes(String(draft.unit)) ? (draft.unit as TimelineVisualization['unit']) : 'week'
  const raw = list(draft.events, 2, 24)
  if (!raw) return fail('invalid-timeline')
  const events = []
  for (const item of raw.map(asRecord)) {
    const label = sanitizeText(item?.label, 80)
    const start = num(item?.start, -1e4, 1e4)
    const end = num(item?.end, -1e4, 1e4)
    if (!label || start === null || (end !== null && end < start)) return fail('invalid-timeline-event')
    const group = sanitizeText(item?.group, 30)
    events.push({ label, start, ...(end !== null && end > start ? { end } : {}), ...(group ? { group } : {}) })
  }
  if (new Set(events.map((e) => e.group ?? '')).size > 4) return fail('too-many-timeline-groups')
  const value: TimelineVisualization = { ...base, type: 'timeline_2d', unit, events }
  return { ok: true, value }
}

const LEVELS: NervousLevel[] = ['periphery', 'spinal_cord', 'medulla', 'pons', 'midbrain', 'thalamus', 'cortex']

function normalizeNeuralPathway(draft: VisualizationDraft, base: CommonBase): Normalized {
  const name = sanitizeText(draft.name, LABEL)
  const raw = list(draft.neurons, 2, 4)
  if (!name || !raw) return fail('invalid-pathway')
  const neurons = []
  for (const item of raw.map(asRecord)) {
    const cellBody = sanitizeText(item?.cellBody, LABEL)
    const level = LEVELS.includes(item?.level as NervousLevel) ? (item!.level as NervousLevel) : null
    if (!cellBody || !level) return fail('invalid-pathway-neuron')
    const tract = sanitizeText(item?.tract, LABEL)
    const decussates = item?.decussates === true
    const crossesAt = decussates && LEVELS.includes(item?.crossesAt as NervousLevel) ? (item!.crossesAt as NervousLevel) : null
    neurons.push({
      cellBody,
      level,
      ...(tract ? { tract } : {}),
      ...(decussates ? { decussates: true } : {}),
      ...(crossesAt && crossesAt !== level ? { crossesAt } : {}),
    })
  }
  const kind = draft.kind === 'motor' ? 'motor' : 'sensory'
  // A sensory pathway climbs towards the cortex, a motor one descends from it.
  const ranks = neurons.map((n) => LEVELS.indexOf(n.level))
  const monotone = ranks.every((r, i) => i === 0 || (kind === 'sensory' ? r >= ranks[i - 1]! : r <= ranks[i - 1]!))
  if (!monotone) return fail('pathway-out-of-order')
  if (neurons.filter((n) => n.decussates).length > 1) return fail('pathway-multiple-decussations')
  // An axon can only cross between its own cell body and the next neuron.
  for (const [i, neuron] of neurons.entries()) {
    if (!neuron.crossesAt) continue
    const at = LEVELS.indexOf(neuron.crossesAt)
    const next = neurons[i + 1]
    const end = next ? ranks[i + 1]! : kind === 'sensory' ? LEVELS.length - 1 : 0
    if (at < Math.min(ranks[i]!, end) || at > Math.max(ranks[i]!, end)) return fail('pathway-crossing-out-of-range')
  }
  const value: NeuralPathwayVisualization = {
    ...base,
    type: 'neural_pathway_2d',
    name,
    kind,
    side: draft.side === 'left' ? 'left' : 'right',
    neurons,
  }
  return { ok: true, value }
}

function normalizeAnatomyTable(draft: VisualizationDraft, base: CommonBase): Normalized {
  const columns = (list(draft.columns, 1, 6) ?? []).map((c) => sanitizeText(c, 30)).filter((c): c is string => Boolean(c))
  const raw = list(draft.rows, 1, 12)
  if (columns.length === 0 || !raw) return fail('invalid-anatomy-table')
  const rows = []
  for (const item of raw.map(asRecord)) {
    const name = sanitizeText(item?.name, LABEL)
    const cells = Array.isArray(item?.cells) ? item.cells.map((c) => sanitizeText(c, 160) ?? '') : []
    if (!name || cells.length !== columns.length) return fail('invalid-anatomy-row')
    rows.push({ name, cells })
  }
  const title = sanitizeText(draft.title, LABEL)
  const value: AnatomyTableVisualization = { ...base, type: 'anatomy_table_2d', columns, rows, ...(title ? { title } : {}) }
  return { ok: true, value }
}

export const MEDICAL_NORMALIZERS: Record<string, (draft: VisualizationDraft, base: CommonBase) => Normalized> = {
  membrane_potential_2d: normalizeMembrane,
  action_potential_2d: normalizeActionPotential,
  oxygen_2d: normalizeOxygen,
  cardiac_2d: normalizeCardiac,
  lung_volumes_2d: normalizeLung,
  renal_2d: normalizeRenal,
  acid_base_2d: normalizeAcidBase,
  amino_acid_2d: normalizeAminoAcid,
  metabolism_2d: normalizeMetabolism,
  pharmacokinetics_2d: normalizePharmacokinetics,
  dental_chart_2d: normalizeDentalChart,
  timeline_2d: normalizeTimeline,
  neural_pathway_2d: normalizeNeuralPathway,
  anatomy_table_2d: normalizeAnatomyTable,
}
