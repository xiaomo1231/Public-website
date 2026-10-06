/**
 * Basic medical sciences: membrane potentials, oxygen binding, the cardiac
 * pressure–volume loop, lung volumes, glomerular filtration and clearance,
 * acid–base analysis, amino-acid charge, metabolic energy yield and
 * one-compartment pharmacokinetics.
 *
 * The model supplies the lesson's values; every derived number (equilibrium
 * potentials, saturation, stroke volume, capacities, net filtration pressure,
 * compensation ranges, pI, ATP yield, concentrations) is computed here.
 * These are teaching models: textbook formulas, not clinical tools.
 */

const R = 8.314462618
const F = 96485.33212

// --- membrane potentials ---------------------------------------------------

export type IonName = 'K+' | 'Na+' | 'Cl-' | 'Ca2+'

export const ION_VALENCE: Record<IonName, number> = { 'K+': 1, 'Na+': 1, 'Cl-': -1, 'Ca2+': 2 }

export interface IonConcentration {
  ion: IonName
  /** mmol/L inside the cell. */
  inside: number
  /** mmol/L outside the cell. */
  outside: number
  /** Relative permeability (GHK); K⁺ is conventionally 1. */
  permeability?: number
}

/** Nernst equilibrium potential in mV at a temperature in °C. */
export function nernst(ion: IonName, inside: number, outside: number, celsius = 37): number {
  const t = celsius + 273.15
  return ((R * t) / (ION_VALENCE[ion] * F)) * Math.log(outside / inside) * 1000
}

/** Goldman–Hodgkin–Katz membrane potential (mV) from the monovalent ions with permeabilities. */
export function goldman(ions: IonConcentration[], celsius = 37): number | null {
  const t = celsius + 273.15
  let numerator = 0
  let denominator = 0
  for (const ion of ions) {
    const p = ion.permeability
    if (p === undefined || p <= 0 || ion.ion === 'Ca2+') continue
    if (ion.ion === 'Cl-') {
      numerator += p * ion.inside
      denominator += p * ion.outside
    } else {
      numerator += p * ion.outside
      denominator += p * ion.inside
    }
  }
  if (numerator <= 0 || denominator <= 0) return null
  return ((R * t) / F) * Math.log(numerator / denominator) * 1000
}

// --- oxygen binding --------------------------------------------------------

/** Haemoglobin saturation (0–1) by the Hill equation. */
export function saturation(po2: number, p50: number, n: number): number {
  if (po2 <= 0) return 0
  const x = (po2 / p50) ** n
  return x / (1 + x)
}

/** O₂ content in mL O₂ / dL blood: 1.34 × Hb × SO₂ + 0.003 × PO₂. */
export function oxygenContent(hb: number, po2: number, p50: number, n: number): number {
  return 1.34 * hb * saturation(po2, p50, n) + 0.003 * po2
}

// --- cardiac pressure–volume loop -------------------------------------------

export interface CardiacInput {
  /** mL */
  edv: number
  esv: number
  /** mmHg: end-diastolic pressure, aortic pressure when the aortic valve opens, peak systolic, end-systolic (valve closes), minimum diastolic. */
  edp: number
  aorticOpen: number
  peak: number
  endSystolic: number
  minimum: number
  /** beats / min, optional. */
  hr?: number
}

export interface CardiacFacts {
  strokeVolume: number
  ejectionFraction: number
  cardiacOutput?: number
  /** Area of the loop in mmHg·mL and in joules. */
  strokeWork: number
  strokeWorkJoules: number
}

/** The loop as points: filling, isovolumic contraction, ejection, isovolumic relaxation. */
export function pvLoop(input: CardiacInput, perPhase = 40): Array<{ v: number; p: number; phase: 0 | 1 | 2 | 3 }> {
  const { edv, esv, edp, aorticOpen, peak, endSystolic, minimum } = input
  const out: Array<{ v: number; p: number; phase: 0 | 1 | 2 | 3 }> = []
  // Filling (mitral open): ESV → EDV along a rising compliance curve.
  for (let i = 0; i <= perPhase; i++) {
    const s = i / perPhase
    out.push({ v: esv + (edv - esv) * s, p: minimum + (edp - minimum) * s * s, phase: 0 })
  }
  // Isovolumic contraction: pressure rises at EDV.
  for (let i = 1; i <= perPhase / 4; i++) out.push({ v: edv, p: edp + ((aorticOpen - edp) * i) / (perPhase / 4), phase: 1 })
  // Ejection: EDV → ESV, through the peak (quadratic through three points).
  const mid = (edv + esv) / 2
  for (let i = 1; i <= perPhase; i++) {
    const v = edv - ((edv - esv) * i) / perPhase
    const a = ((v - mid) * (v - esv)) / ((edv - mid) * (edv - esv))
    const b = ((v - edv) * (v - esv)) / ((mid - edv) * (mid - esv))
    const c = ((v - edv) * (v - mid)) / ((esv - edv) * (esv - mid))
    out.push({ v, p: aorticOpen * a + peak * b + endSystolic * c, phase: 2 })
  }
  // Isovolumic relaxation: pressure falls at ESV.
  for (let i = 1; i <= perPhase / 4; i++) out.push({ v: esv, p: endSystolic - ((endSystolic - minimum) * i) / (perPhase / 4), phase: 3 })
  return out
}

export function cardiacFacts(input: CardiacInput): CardiacFacts {
  const loop = pvLoop(input)
  let area = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!
    const b = loop[(i + 1) % loop.length]!
    area += a.v * b.p - b.v * a.p
  }
  const strokeVolume = input.edv - input.esv
  const strokeWork = Math.abs(area) / 2
  return {
    strokeVolume,
    ejectionFraction: strokeVolume / input.edv,
    ...(input.hr ? { cardiacOutput: (strokeVolume * input.hr) / 1000 } : {}),
    strokeWork,
    // 1 mmHg·mL = 133.322 Pa × 1e-6 m³.
    strokeWorkJoules: strokeWork * 133.322e-6,
  }
}

// --- lung volumes --------------------------------------------------------------

export interface LungVolumes {
  tv: number
  irv: number
  erv: number
  rv: number
}

export function lungCapacities(v: LungVolumes): { ic: number; frc: number; vc: number; tlc: number } {
  return { ic: v.tv + v.irv, frc: v.erv + v.rv, vc: v.irv + v.tv + v.erv, tlc: v.irv + v.tv + v.erv + v.rv }
}

/** A spirogram: quiet breaths, a maximal inspiration and a maximal expiration. */
export function spirogram(v: LungVolumes, samples = 400): Array<{ t: number; volume: number }> {
  const { frc, tlc } = { ...lungCapacities(v) }
  const out: Array<{ t: number; volume: number }> = []
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * 10
    let volume: number
    if (t < 4) volume = frc + (v.tv * (1 - Math.cos((t / 2) * 2 * Math.PI))) / 2
    else if (t < 5.5) volume = frc + (tlc - frc) * Math.sin(((t - 4) / 1.5) * (Math.PI / 2))
    else if (t < 7.5) volume = tlc - (tlc - v.rv) * Math.sin(((t - 5.5) / 2) * (Math.PI / 2))
    else if (t < 8.5) volume = v.rv + (frc - v.rv) * ((t - 7.5) / 1)
    else volume = frc + (v.tv * (1 - Math.cos(((t - 8.5) / 2) * 2 * Math.PI))) / 2
    out.push({ t, volume })
  }
  return out
}

// --- glomerular filtration -------------------------------------------------------

export interface StarlingForces {
  /** Glomerular capillary hydrostatic pressure, mmHg. */
  pgc: number
  /** Bowman's space hydrostatic pressure. */
  pbs: number
  /** Glomerular capillary oncotic pressure. */
  pigc: number
  /** Bowman's space oncotic pressure (usually ~0). */
  pibs: number
}

export function netFiltrationPressure(f: StarlingForces): number {
  return f.pgc - f.pbs - (f.pigc - f.pibs)
}

/** Clearance C = U × V / P (mL/min). */
export function clearance(urine: number, plasma: number, urineFlow: number): number {
  return (urine * urineFlow) / plasma
}

// --- acid–base -------------------------------------------------------------------

export type AcidBaseDisorder =
  | 'normal'
  | 'metabolic_acidosis'
  | 'metabolic_alkalosis'
  | 'respiratory_acidosis'
  | 'respiratory_alkalosis'
  | 'mixed_acidosis'
  | 'mixed_alkalosis'

export interface Compensation {
  /** What the compensating variable should be: PaCO₂ for metabolic, HCO₃⁻ for respiratory. */
  variable: 'paco2' | 'hco3'
  low: number
  high: number
  chronicity?: 'acute' | 'chronic'
}

export interface AcidBaseAnalysis {
  /** pH from Henderson–Hasselbalch with the given PaCO₂ and HCO₃⁻. */
  computedPH: number
  /** The given values agree with Henderson–Hasselbalch (within 0.03). */
  consistent: boolean
  primary: AcidBaseDisorder
  compensation: Compensation[]
  /** The compensating variable lies outside the expected range. */
  additionalDisorder?: 'too_low' | 'too_high'
}

/** pH = 6.1 + log₁₀(HCO₃⁻ / (0.03 × PaCO₂)). */
export function hendersonPH(paco2: number, hco3: number): number {
  return 6.1 + Math.log10(hco3 / (0.03 * paco2))
}

/**
 * Primary disorder and expected compensation, with the formulas of the
 * standard Chinese pathophysiology textbook (PaCO₂ in mmHg, HCO₃⁻ in mmol/L).
 */
export function analyzeAcidBase(ph: number, paco2: number, hco3: number, chronicity?: 'acute' | 'chronic'): AcidBaseAnalysis {
  const computedPH = hendersonPH(paco2, hco3)
  const consistent = Math.abs(computedPH - ph) <= 0.03
  const respAcid = paco2 > 45
  const respAlk = paco2 < 35
  const metAcid = hco3 < 22
  const metAlk = hco3 > 27
  let primary: AcidBaseDisorder = 'normal'
  if (ph < 7.35) primary = respAcid && metAcid ? 'mixed_acidosis' : metAcid ? 'metabolic_acidosis' : respAcid ? 'respiratory_acidosis' : 'metabolic_acidosis'
  else if (ph > 7.45) primary = respAlk && metAlk ? 'mixed_alkalosis' : metAlk ? 'metabolic_alkalosis' : respAlk ? 'respiratory_alkalosis' : 'metabolic_alkalosis'
  else if (metAcid && respAlk) primary = ph <= 7.4 ? 'metabolic_acidosis' : 'respiratory_alkalosis'
  else if (metAlk && respAcid) primary = ph >= 7.4 ? 'metabolic_alkalosis' : 'respiratory_acidosis'

  const compensation: Compensation[] = []
  const dCO2 = paco2 - 40
  const dHCO3 = hco3 - 24
  const band = (variable: Compensation['variable'], centre: number, spread: number, c?: 'acute' | 'chronic'): Compensation => ({
    variable,
    low: centre - spread,
    high: centre + spread,
    ...(c ? { chronicity: c } : {}),
  })
  if (primary === 'metabolic_acidosis') compensation.push(band('paco2', 1.5 * hco3 + 8, 2))
  if (primary === 'metabolic_alkalosis') compensation.push(band('paco2', 40 + 0.7 * dHCO3, 5))
  if (primary === 'respiratory_acidosis') {
    if (chronicity !== 'chronic') compensation.push(band('hco3', 24 + 0.1 * dCO2, 1.5, 'acute'))
    if (chronicity !== 'acute') compensation.push(band('hco3', 24 + 0.35 * dCO2, 3, 'chronic'))
  }
  if (primary === 'respiratory_alkalosis') {
    if (chronicity !== 'chronic') compensation.push(band('hco3', 24 + 0.2 * dCO2, 2.5, 'acute'))
    if (chronicity !== 'acute') compensation.push(band('hco3', 24 + 0.5 * dCO2, 2.5, 'chronic'))
  }
  let additionalDisorder: AcidBaseAnalysis['additionalDisorder']
  if (compensation.length > 0) {
    const value = compensation[0]!.variable === 'paco2' ? paco2 : hco3
    const low = Math.min(...compensation.map((c) => c.low))
    const high = Math.max(...compensation.map((c) => c.high))
    if (value < low) additionalDisorder = 'too_low'
    else if (value > high) additionalDisorder = 'too_high'
  }
  return { computedPH, consistent, primary, compensation, ...(additionalDisorder ? { additionalDisorder } : {}) }
}

// --- amino acids -------------------------------------------------------------------

export interface IonizableGroup {
  pka: number
  /** "acid": neutral → −1 when it loses H⁺ (COOH); "base": +1 → neutral (NH₃⁺). */
  kind: 'acid' | 'base'
  label?: string
}

/** Net charge at a pH (Henderson–Hasselbalch for every group). */
export function netCharge(groups: IonizableGroup[], ph: number): number {
  return groups.reduce(
    (sum, g) => sum + (g.kind === 'base' ? 1 / (1 + 10 ** (ph - g.pka)) : -1 / (1 + 10 ** (g.pka - ph))),
    0,
  )
}

/** Isoelectric point: the mean of the two pKₐ values around the neutral species. */
export function isoelectricPoint(groups: IonizableGroup[]): number {
  const sorted = [...groups].sort((a, b) => a.pka - b.pka)
  const fullyProtonatedCharge = groups.filter((g) => g.kind === 'base').length
  // After k deprotonations the charge is (bases − k); neutral at k = bases.
  const k = fullyProtonatedCharge
  const below = sorted[k - 1]
  const above = sorted[k]
  if (!below || !above) return sorted.length ? sorted[sorted.length - 1]!.pka : 7
  return (below.pka + above.pka) / 2
}

// --- metabolic energy yield --------------------------------------------------------

export interface MetabolicStep {
  label: string
  enzyme?: string
  /** Net ATP (substrate level; negative when consumed), GTP, NADH, FADH₂, CO₂ per occurrence. */
  atp?: number
  gtp?: number
  nadh?: number
  fadh2?: number
  co2?: number
  /** Where NADH is formed (cytosolic NADH needs a shuttle). */
  compartment?: 'cytosol' | 'mitochondria'
  /** Occurrences per starting molecule (e.g. 2 after the glucose split). */
  times?: number
}

export type PoConvention = 'modern' | 'classic'
export type Shuttle = 'malate_aspartate' | 'glycerol_phosphate'

export interface EnergyYield {
  substrateLevel: number
  nadhCytosol: number
  nadhMitochondria: number
  fadh2: number
  co2: number
  oxidative: number
  total: number
  poNadh: number
  poFadh2: number
}

export function energyYield(steps: MetabolicStep[], convention: PoConvention = 'modern', shuttle: Shuttle = 'malate_aspartate'): EnergyYield {
  const poNadh = convention === 'modern' ? 2.5 : 3
  const poFadh2 = convention === 'modern' ? 1.5 : 2
  let substrateLevel = 0
  let nadhCytosol = 0
  let nadhMitochondria = 0
  let fadh2 = 0
  let co2 = 0
  for (const step of steps) {
    const n = step.times ?? 1
    substrateLevel += ((step.atp ?? 0) + (step.gtp ?? 0)) * n
    if (step.compartment === 'cytosol') nadhCytosol += (step.nadh ?? 0) * n
    else nadhMitochondria += (step.nadh ?? 0) * n
    fadh2 += (step.fadh2 ?? 0) * n
    co2 += (step.co2 ?? 0) * n
  }
  // The glycerol-phosphate shuttle delivers cytosolic NADH electrons as FADH₂.
  const cytosolYield = shuttle === 'malate_aspartate' ? poNadh : poFadh2
  const oxidative = nadhMitochondria * poNadh + nadhCytosol * cytosolYield + fadh2 * poFadh2
  return { substrateLevel, nadhCytosol, nadhMitochondria, fadh2, co2, oxidative, total: substrateLevel + oxidative, poNadh, poFadh2 }
}

// --- pharmacokinetics -----------------------------------------------------------------

export interface DosingRegimen {
  route: 'iv_bolus' | 'oral'
  /** mg per dose. */
  dose: number
  /** L */
  vd: number
  /** h */
  halfLife: number
  /** Oral: bioavailability (0–1) and absorption rate constant (1/h). */
  bioavailability?: number
  ka?: number
  /** h between doses, and the number of doses (1 = single dose). */
  interval?: number
  doses?: number
}

export interface PkFacts {
  ke: number
  clearance: number
  /** mg·h/L for one dose. */
  auc: number
  /** Multiple dosing. */
  accumulation?: number
  averageSteadyState?: number
  /** IV bolus only. */
  peakSteadyState?: number
  troughSteadyState?: number
  /** ≈ 4–5 half-lives to reach ~94–97 % of steady state. */
  timeToSteadyState: number
}

export function concentrationAtTime(regimen: DosingRegimen, t: number): number {
  const ke = Math.LN2 / regimen.halfLife
  const f = regimen.route === 'oral' ? (regimen.bioavailability ?? 1) : 1
  const ka = regimen.ka ?? 1
  const doses = Math.max(1, regimen.doses ?? 1)
  const tau = regimen.interval ?? 0
  let c = 0
  for (let i = 0; i < doses; i++) {
    const elapsed = t - i * tau
    if (elapsed < 0) break
    if (regimen.route === 'iv_bolus') c += (regimen.dose / regimen.vd) * Math.exp(-ke * elapsed)
    else if (Math.abs(ka - ke) < 1e-9) c += ((f * regimen.dose) / regimen.vd) * ke * elapsed * Math.exp(-ke * elapsed)
    else c += ((f * regimen.dose * ka) / (regimen.vd * (ka - ke))) * (Math.exp(-ke * elapsed) - Math.exp(-ka * elapsed))
  }
  return c
}

export function pkFacts(regimen: DosingRegimen): PkFacts {
  const ke = Math.LN2 / regimen.halfLife
  const cl = ke * regimen.vd
  const f = regimen.route === 'oral' ? (regimen.bioavailability ?? 1) : 1
  const facts: PkFacts = { ke, clearance: cl, auc: (f * regimen.dose) / cl, timeToSteadyState: 4.32 * regimen.halfLife }
  if ((regimen.doses ?? 1) > 1 && regimen.interval) {
    const tau = regimen.interval
    facts.accumulation = 1 / (1 - Math.exp(-ke * tau))
    facts.averageSteadyState = (f * regimen.dose) / (cl * tau)
    if (regimen.route === 'iv_bolus') {
      facts.peakSteadyState = (regimen.dose / regimen.vd) * facts.accumulation
      facts.troughSteadyState = facts.peakSteadyState * Math.exp(-ke * tau)
    }
  }
  return facts
}

// --- dental notation ---------------------------------------------------------------

export type Dentition = 'permanent' | 'primary'

/** FDI two-digit code → its parts, or null for an invalid code. */
export function parseFdi(code: number): { quadrant: number; tooth: number; dentition: Dentition } | null {
  const quadrant = Math.floor(code / 10)
  const tooth = code % 10
  if (quadrant >= 1 && quadrant <= 4 && tooth >= 1 && tooth <= 8) return { quadrant, tooth, dentition: 'permanent' }
  if (quadrant >= 5 && quadrant <= 8 && tooth >= 1 && tooth <= 5) return { quadrant, tooth, dentition: 'primary' }
  return null
}

/** Universal (ADA) notation: 1–32 for permanent teeth, A–T for primary teeth. */
export function universalOf(code: number): string | null {
  const p = parseFdi(code)
  if (!p) return null
  if (p.dentition === 'permanent') {
    const n = p.quadrant === 1 ? 9 - p.tooth : p.quadrant === 2 ? 8 + p.tooth : p.quadrant === 3 ? 25 - p.tooth : 24 + p.tooth
    return String(n)
  }
  const index = p.quadrant === 5 ? 5 - p.tooth : p.quadrant === 6 ? 4 + p.tooth : p.quadrant === 7 ? 15 - p.tooth : 14 + p.tooth
  return String.fromCharCode(65 + index)
}

/** Palmer notation: the tooth with its quadrant bracket (┘ └ ┐ ┌). */
export function palmerOf(code: number): string | null {
  const p = parseFdi(code)
  if (!p) return null
  const mark = p.dentition === 'permanent' ? String(p.tooth) : String.fromCharCode(64 + p.tooth)
  const q = ((p.quadrant - 1) % 4) + 1
  return q === 1 ? `${mark}┘` : q === 2 ? `└${mark}` : q === 3 ? `┌${mark}` : `${mark}┐`
}

const PERMANENT_NAMES = ['中切牙', '侧切牙', '尖牙', '第一前磨牙', '第二前磨牙', '第一磨牙', '第二磨牙', '第三磨牙']
const PERMANENT_NAMES_EN = ['central incisor', 'lateral incisor', 'canine', 'first premolar', 'second premolar', 'first molar', 'second molar', 'third molar']
const PRIMARY_NAMES = ['乳中切牙', '乳侧切牙', '乳尖牙', '第一乳磨牙', '第二乳磨牙']
const PRIMARY_NAMES_EN = ['primary central incisor', 'primary lateral incisor', 'primary canine', 'primary first molar', 'primary second molar']

export function toothName(code: number, language: 'zh' | 'en'): string | null {
  const p = parseFdi(code)
  if (!p) return null
  const q = ((p.quadrant - 1) % 4) + 1
  const side = language === 'zh' ? ['右上', '左上', '左下', '右下'][q - 1]! : ['upper right', 'upper left', 'lower left', 'lower right'][q - 1]!
  const names = p.dentition === 'permanent' ? (language === 'zh' ? PERMANENT_NAMES : PERMANENT_NAMES_EN) : language === 'zh' ? PRIMARY_NAMES : PRIMARY_NAMES_EN
  return language === 'zh' ? `${side}${names[p.tooth - 1]}` : `${side} ${names[p.tooth - 1]}`
}

/** The chart as the dentist sees it: patient's right on the left. */
export function chartRows(dentition: Dentition): { upper: number[]; lower: number[] } {
  const n = dentition === 'permanent' ? 8 : 5
  const [ur, ul, ll, lr] = dentition === 'permanent' ? [1, 2, 3, 4] : [5, 6, 7, 8]
  const range = (q: number, reverse: boolean) => {
    const teeth = Array.from({ length: n }, (_, i) => q * 10 + i + 1)
    return reverse ? teeth.reverse() : teeth
  }
  return { upper: [...range(ur!, true), ...range(ul!, false)], lower: [...range(lr!, true), ...range(ll!, false)] }
}
