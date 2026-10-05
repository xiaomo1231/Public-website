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

// --- titration (monoprotic acid with a strong base) -------------------------

export interface TitrationSetup {
  /** Acid concentration, mol/L. */
  acidConcentration: number
  /** Acid volume, mL. */
  acidVolume: number
  /** Base (titrant) concentration, mol/L. */
  baseConcentration: number
  /** Acid dissociation constant; absent for a strong acid. */
  ka?: number
}

const KW = 1e-14

/**
 * pH after `added` mL of base, from the exact charge balance
 * [H⁺] + [Na⁺] = [OH⁻] + [A⁻], solved by bisection on pH. Works for strong
 * (Ka → ∞) and weak monoprotic acids alike, before and after equivalence.
 */
export function titrationPH(setup: TitrationSetup, added: number): number {
  const totalVolume = setup.acidVolume + added
  const acid = (setup.acidConcentration * setup.acidVolume) / totalVolume
  const sodium = (setup.baseConcentration * added) / totalVolume
  const ka = setup.ka ?? 1e10
  const balance = (pH: number): number => {
    const h = 10 ** -pH
    const anion = (acid * ka) / (ka + h)
    return h + sodium - KW / h - anion
  }
  let lo = 0
  let hi = 14
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    // The balance falls as pH rises; keep the root bracketed.
    if (balance(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function equivalenceVolume(setup: TitrationSetup): number {
  return (setup.acidConcentration * setup.acidVolume) / setup.baseConcentration
}

export function titrationCurve(setup: TitrationSetup, samples = 160): Array<{ volume: number; pH: number }> {
  const end = equivalenceVolume(setup) * 2
  return Array.from({ length: samples + 1 }, (_, i) => {
    const volume = (end * i) / samples
    return { volume, pH: titrationPH(setup, volume) }
  })
}
