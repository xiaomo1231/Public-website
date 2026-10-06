/**
 * Chemistry figures: molecules, reaction energy profiles and titration curves.
 *
 * The model supplies only what the lesson states (a SMILES string and the
 * formula it names; energies of each state; concentrations and volumes);
 * formulas, ΔH, Eₐ, every pH value and the equivalence point are computed
 * here.
 */
import SmilesDrawer from 'smiles-drawer'
import { parseSpecies } from '@/infrastructure/chemistry/equation'

// --- molecules -----------------------------------------------------------

export const MAX_SMILES_LENGTH = 300

/** Molecular formula of a SMILES string (implicit H included), or null. */
export function smilesFormula(smiles: string): string | null {
  if (!smiles || smiles.length > MAX_SMILES_LENGTH || !/^[A-Za-z0-9@+\-[\]()=#$/\\%.:*]+$/.test(smiles)) {
    return null
  }
  let formula: string | null = null
  try {
    SmilesDrawer.parse(
      smiles,
      (tree) => {
        try {
          // Implicit hydrogens on aromatic atoms are only right once the graph
          // has been processed, so lay it out into a detached SVG first.
          const drawer = new SmilesDrawer.SvgDrawer({})
          drawer.draw(tree, null, 'light')
          formula = drawer.getMolecularFormula() || null
        } catch {
          formula = null
        }
      },
      () => {
        formula = null
      },
    )
  } catch {
    return null
  }
  return formula
}

/** Two formulas name the same atoms (order and notation do not matter). */
export function sameFormula(a: string, b: string): boolean {
  const left = parseSpecies(a)
  const right = parseSpecies(b)
  if (!left || !right) return false
  return left.key === right.key
}

// --- reaction energy profile -----------------------------------------------

export interface EnergyState {
  label: string
  energy: number
  /** A transition state (a peak) rather than a species (a valley). */
  transition?: boolean
}

export interface EnergyProfileFacts {
  /** Products − reactants. */
  deltaH: number
  /** Highest point − reactants. */
  activationEnergy: number
  exothermic: boolean
}

export function energyProfileFacts(states: EnergyState[]): EnergyProfileFacts {
  const first = states[0]!.energy
  const last = states[states.length - 1]!.energy
  const highest = Math.max(...states.map((state) => state.energy))
  return { deltaH: last - first, activationEnergy: highest - first, exothermic: last < first }
}

// --- titration ---------------------------------------------------------------

/**
 * One titration: an acid (strong, or weak with up to three Kₐ values for a
 * polyprotic acid) titrated with a strong base, or a base (strong, or weak
 * with K_b) titrated with a strong acid. Volumes in mL, concentrations in mol/L.
 */
export interface TitrationSetup {
  analyte: 'acid' | 'base'
  concentration: number
  volume: number
  titrantConcentration: number
  /** Acid only: Kₐ₁ ≥ Kₐ₂ ≥ Kₐ₃. Absent for a strong monoprotic acid. */
  ka?: number[]
  /** Base only: K_b. Absent for a strong base. */
  kb?: number
}

/** The v7 shape (monoprotic acid + strong base), still found in stored lessons. */
export interface LegacyTitrationSetup {
  acidConcentration: number
  acidVolume: number
  baseConcentration: number
  ka?: number
}

export function asTitrationSetup(setup: TitrationSetup | LegacyTitrationSetup): TitrationSetup {
  if ('analyte' in setup) return setup
  return {
    analyte: 'acid',
    concentration: setup.acidConcentration,
    volume: setup.acidVolume,
    titrantConcentration: setup.baseConcentration,
    ...(setup.ka !== undefined ? { ka: [setup.ka] } : {}),
  }
}

const KW = 1e-14

/** Average number of protons released per acid molecule at [H⁺] = h. */
function protonsReleased(h: number, ka: number[]): number {
  // Terms h^(n−j)·Ka1…Kaj for j = 0…n give the fractions of each species.
  const n = ka.length
  let total = 0
  let weighted = 0
  let product = 1
  for (let j = 0; j <= n; j++) {
    if (j > 0) product *= ka[j - 1]!
    const term = h ** (n - j) * product
    total += term
    weighted += j * term
  }
  return weighted / total
}

/**
 * pH after `added` mL of titrant, from the exact charge balance solved by
 * bisection on pH (the balance falls as pH rises, so the root is unique).
 */
export function titrationPH(input: TitrationSetup | LegacyTitrationSetup, added: number): number {
  const setup = asTitrationSetup(input)
  const totalVolume = setup.volume + added
  const analyte = (setup.concentration * setup.volume) / totalVolume
  const titrant = (setup.titrantConcentration * added) / totalVolume
  const balance = (pH: number): number => {
    const h = 10 ** -pH
    if (setup.analyte === 'acid') {
      // [H⁺] + [Na⁺] = [OH⁻] + Σ anion charges
      const released = setup.ka?.length ? protonsReleased(h, setup.ka) : 1
      return h + titrant - KW / h - analyte * released
    }
    // [H⁺] + [BH⁺] (or [Na⁺] for a strong base) = [OH⁻] + [Cl⁻]
    const protonated = setup.kb !== undefined ? h / (h + KW / setup.kb) : 1
    return h + analyte * protonated - KW / h - titrant
  }
  let lo = -1
  let hi = 15
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (balance(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Titrant volume at each equivalence point (one per proton for an acid). */
export function equivalenceVolumes(input: TitrationSetup | LegacyTitrationSetup): number[] {
  const setup = asTitrationSetup(input)
  const first = (setup.concentration * setup.volume) / setup.titrantConcentration
  const protons = setup.analyte === 'acid' ? Math.max(1, setup.ka?.length ?? 1) : 1
  return Array.from({ length: protons }, (_, i) => first * (i + 1))
}

/** The first equivalence volume (kept for the monoprotic case). */
export function equivalenceVolume(setup: TitrationSetup | LegacyTitrationSetup): number {
  return equivalenceVolumes(setup)[0]!
}

/** Half-equivalence points of weak species, where pH = pKₐ of that step. */
export function bufferPoints(input: TitrationSetup | LegacyTitrationSetup): Array<{ volume: number; pKa: number }> {
  const setup = asTitrationSetup(input)
  const first = equivalenceVolume(setup)
  if (setup.analyte === 'acid') {
    return (setup.ka ?? []).map((ka, i) => ({ volume: first * (i + 0.5), pKa: -Math.log10(ka) }))
  }
  return setup.kb !== undefined ? [{ volume: first / 2, pKa: 14 + Math.log10(setup.kb) }] : []
}

export function titrationCurve(
  input: TitrationSetup | LegacyTitrationSetup,
  samples = 200,
): Array<{ volume: number; pH: number }> {
  const volumes = equivalenceVolumes(input)
  const end = volumes[volumes.length - 1]! + volumes[0]!
  return Array.from({ length: samples + 1 }, (_, i) => {
    const volume = (end * i) / samples
    return { volume, pH: titrationPH(input, volume) }
  })
}
