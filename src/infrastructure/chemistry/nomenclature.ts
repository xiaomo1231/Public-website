/**
 * Chemical nomenclature answers (name ↔ formula), graded locally where it can
 * be done reliably:
 *
 *   name → formula   the formula is parsed (`parseSpecies`) and compared by
 *                    composition and charge: CuSO4·5H2O = CuSO4(H2O)5, NaOH =
 *                    HONa are the same; Fe2O3 ≠ FeO, SO4^2- ≠ SO4^-. A nuclide
 *                    keeps its mass number (⁵⁴Cr⁶⁺, ^{54}Cr^{6+}, 54Cr6+). For an
 *                    organic structure with two or more carbons written
 *                    differently, the two may be isomers — not decided here.
 *   formula → name   the name is compared with the accepted names after
 *                    normalising case, spaces, hyphens, brackets and British /
 *                    American spellings; an unmatched name may still be an exact
 *                    equivalent (the caller can ask the AI, as for fill-blanks).
 */
import { parseSpecies, type Species } from './equation'

export type NomenclatureDirection = 'name_to_formula' | 'formula_to_name'

export interface NomenclatureSpec {
  direction: NomenclatureDirection
  /** The compound / ion / nuclide in plain mhchem syntax (no `\ce{}`): `Fe2(SO4)3`, `^{54}Cr^{6+}`. */
  formula: string
  /** Accepted names, the standard (IUPAC) name first. */
  names: string[]
}

export type FormulaOutcome =
  | 'correct'
  /** Same atoms, different charge (SO4^- for SO4^2-). */
  | 'charge'
  /** Same element and charge, different mass number. */
  | 'mass-number'
  /** Different atoms or counts. */
  | 'composition'
  /** Same molecular formula, organic structure written differently. */
  | 'isomers'
  | 'unreadable'

function cleanFormula(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\\ce\{([^}]*)\}/g, '$1')
    .replace(/\$/g, '')
    .trim()
}

/**
 * `54Cr6+` written without carets, when a nuclide is expected: the leading
 * number is the mass number and the trailing number the charge.
 */
function bareNuclide(text: string): string | null {
  const match = /^(\d+)\s*([A-Z][a-z]?)\s*(\d*)\s*([+-])?$/.exec(text)
  if (!match) return null
  const charge = match[4] ? `^{${match[3] || ''}${match[4]}}` : match[3] ? null : ''
  if (charge === null) return null
  return `^{${match[1]}}${match[2]}${charge}`
}

export function parseFormulaAnswer(answer: string, expectNuclide = false): Species | null {
  const text = cleanFormula(answer)
  if (!text) return null
  if (expectNuclide) {
    const nuclide = bareNuclide(text)
    if (nuclide) return parseSpecies(nuclide)
  }
  return parseSpecies(text)
}

function atomsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false
  return true
}

export function compareFormula(answer: string, referenceFormula: string): FormulaOutcome {
  const reference = parseSpecies(cleanFormula(referenceFormula))
  if (!reference) return 'unreadable'
  const given = parseFormulaAnswer(
    answer,
    reference.nucleus !== undefined && reference.nuclear === true,
  )
  if (!given) return 'unreadable'
  if (given.key === reference.key) {
    if (
      reference.structure &&
      (reference.atoms.C ?? 0) >= 2 &&
      given.structure !== undefined &&
      given.structure !== reference.structure
    )
      return 'isomers'
    return 'correct'
  }
  if (atomsEqual(given.atoms, reference.atoms)) {
    if ((given.nucleus?.A ?? null) !== (reference.nucleus?.A ?? null)) return 'mass-number'
    if (given.charge !== reference.charge) return 'charge'
  }
  return 'composition'
}

/** British → American spellings used in inorganic names. */
const SPELLINGS: Array<[RegExp, string]> = [
  [/sulph/g, 'sulf'],
  [/aluminium/g, 'aluminum'],
  [/caesium/g, 'cesium'],
]

/** A name reduced for comparison: case, spaces, hyphens, bracket styles and spellings ignored. */
export function normalizeChemicalName(name: string): string {
  let text = name.normalize('NFKC').toLowerCase().trim()
  for (const [pattern, replacement] of SPELLINGS) text = text.replace(pattern, replacement)
  return text
    .replace(/[[{]/g, '(')
    .replace(/[\]}]/g, ')')
    .replace(/[\s\-‐‑–—_]+/g, '')
    .replace(/[.。]$/, '')
}

export function nameAccepted(answer: string, names: readonly string[]): boolean {
  const given = normalizeChemicalName(answer)
  if (!given) return false
  return names.some((name) => normalizeChemicalName(name) === given)
}
