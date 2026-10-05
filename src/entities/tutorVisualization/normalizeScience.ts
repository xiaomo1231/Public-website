/**
 * Normalizers for the chemistry and biology figures.
 *
 * Same contract as `normalize.ts`: the draft is untrusted, every field is
 * checked, and anything the local maths cannot confirm is rejected. The model
 * supplies only lesson facts (SMILES + the formula the lesson names, state
 * energies, concentrations, genotypes, family members, a DNA strand).
 */
import type {
  EnergyVisualization,
  MoleculeEntry,
  MoleculeVisualization,
  PedigreeVisualization,
  PunnettTrait,
  PunnettVisualization,
  TitrationVisualization,
  TranslationVisualization,
  TutorVisualization,
  VisualizationDraft,
  VisualizationPlacement,
} from './types'
import { VISUALIZATION_LIMITS } from './limits'
import { asRecord, readNumber, sanitizeText } from './sanitize'
import { MAX_SMILES_LENGTH, sameFormula, smilesFormula, type EnergyState } from './chemistry'
import {
  MAX_DNA_LENGTH,
  genotypePairs,
  pedigreeGenerations,
  translateDna,
  type PedigreeMember,
} from './biology'

type Normalized = { ok: true; value: TutorVisualization } | { ok: false; reason: string }

interface CommonBase {
  id: string
  schemaVersion: number
  placement: VisualizationPlacement
  caption?: string
}

const {
  maxMolecules: MAX_MOLECULES,
  maxEnergyStates: MAX_ENERGY_STATES,
  maxPedigreeMembers: MAX_PEDIGREE_MEMBERS,
  maxLabelLength: MAX_LABEL_LENGTH,
  maxIdLength: MAX_ID_LENGTH,
} = VISUALIZATION_LIMITS

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function normalizeMolecule(draft: VisualizationDraft, base: CommonBase): Normalized {
  const list = Array.isArray(draft.molecules) ? draft.molecules : []
  if (list.length === 0 || list.length > MAX_MOLECULES) return { ok: false, reason: 'invalid-molecule-count' }
  const molecules: MoleculeEntry[] = []
  for (const raw of list) {
    const item = asRecord(raw)
    const smiles = typeof item?.smiles === 'string' ? item.smiles.trim() : ''
    const stated = sanitizeText(item?.formula, 60)
    if (!smiles || smiles.length > MAX_SMILES_LENGTH || !stated) {
      return { ok: false, reason: 'missing-molecule-data' }
    }
    const formula = smilesFormula(smiles)
    if (!formula) return { ok: false, reason: 'invalid-smiles' }
    // The structure must be the molecule the lesson names.
    if (!sameFormula(formula, stated)) return { ok: false, reason: 'molecule-formula-mismatch' }
    const name = sanitizeText(item?.name, MAX_LABEL_LENGTH)
    molecules.push({ smiles, formula, ...(name ? { name } : {}) })
  }
  const value: MoleculeVisualization = { ...base, type: 'molecule_2d', molecules }
  return { ok: true, value }
}

function normalizeEnergy(draft: VisualizationDraft, base: CommonBase): Normalized {
  const list = Array.isArray(draft.states) ? draft.states : []
  if (list.length < 2 || list.length > MAX_ENERGY_STATES) return { ok: false, reason: 'invalid-energy-state-count' }
  const states: EnergyState[] = []
  for (const raw of list) {
    const item = asRecord(raw)
    const label = sanitizeText(item?.label, MAX_LABEL_LENGTH)
    const energy = readNumber(item?.energy)
    if (!label || energy === null) return { ok: false, reason: 'invalid-energy-state' }
    states.push({ label, energy, ...(item?.transition === true ? { transition: true } : {}) })
  }
  // Reactants and products are species, never transition states.
  if (states[0]!.transition || states[states.length - 1]!.transition) {
    return { ok: false, reason: 'energy-endpoint-transition' }
  }
  // A transition state is a peak: higher than both neighbours.
  for (let i = 1; i < states.length - 1; i++) {
    const state = states[i]!
    if (state.transition && (state.energy <= states[i - 1]!.energy || state.energy <= states[i + 1]!.energy)) {
      return { ok: false, reason: 'energy-transition-not-peak' }
    }
  }
  const energies = states.map((state) => state.energy)
  if (Math.max(...energies) === Math.min(...energies)) return { ok: false, reason: 'flat-energy-profile' }
  const unit = sanitizeText(draft.unit, 16) ?? 'kJ/mol'
  const value: EnergyVisualization = { ...base, type: 'energy_2d', states, unit }
  return { ok: true, value }
}

function normalizeTitration(draft: VisualizationDraft, base: CommonBase): Normalized {
  const acidConcentration = readNumber(draft.acidConcentration)
  const acidVolume = readNumber(draft.acidVolume)
  const baseConcentration = readNumber(draft.baseConcentration)
  const inRange = (v: number | null, min: number, max: number): v is number => v !== null && v >= min && v <= max
  if (
    !inRange(acidConcentration, 1e-4, 10) ||
    !inRange(acidVolume, 1, 500) ||
    !inRange(baseConcentration, 1e-4, 10)
  ) {
    return { ok: false, reason: 'invalid-titration-setup' }
  }
  // Ka is optional (strong acid); a weak acid's Ka must be a real constant.
  let ka: number | undefined
  if (draft.ka !== undefined && draft.ka !== null) {
    const raw = typeof draft.ka === 'number' ? draft.ka : Number(draft.ka)
    if (!Number.isFinite(raw) || raw < 1e-14 || raw > 10) return { ok: false, reason: 'invalid-titration-ka' }
    ka = raw
  }
  const acidLabel = sanitizeText(draft.acidLabel, MAX_LABEL_LENGTH)
  const baseLabel = sanitizeText(draft.baseLabel, MAX_LABEL_LENGTH)
  const value: TitrationVisualization = {
    ...base,
    type: 'titration_2d',
    setup: { acidConcentration, acidVolume, baseConcentration, ...(ka !== undefined ? { ka } : {}) },
    ...(acidLabel ? { acidLabel } : {}),
    ...(baseLabel ? { baseLabel } : {}),
  }
  return { ok: true, value }
}

function normalizePunnett(draft: VisualizationDraft, base: CommonBase): Normalized {
  const motherText = typeof draft.mother === 'string' ? draft.mother.replace(/\s+/g, '') : ''
  const fatherText = typeof draft.father === 'string' ? draft.father.replace(/\s+/g, '') : ''
  const mother = genotypePairs(motherText)
  const father = genotypePairs(fatherText)
  if (!mother || !father) return { ok: false, reason: 'invalid-genotype' }
  // Both parents must carry the same genes in the same order.
  const genes = (pairs: Array<[string, string]>) => pairs.map(([a]) => a.toLowerCase()).join('')
  if (genes(mother) !== genes(father)) return { ok: false, reason: 'genotype-genes-differ' }
  const dominance = draft.dominance === 'incomplete' ? 'incomplete' : 'complete'
  const geneSet = new Set(genes(mother))
  const traits: PunnettTrait[] = []
  for (const raw of Array.isArray(draft.traits) ? draft.traits : []) {
    const item = asRecord(raw)
    const gene = typeof item?.gene === 'string' ? item.gene.trim().toLowerCase() : ''
    const dominant = sanitizeText(item?.dominant, MAX_LABEL_LENGTH)
    const recessive = sanitizeText(item?.recessive, MAX_LABEL_LENGTH)
    const intermediate = sanitizeText(item?.intermediate, MAX_LABEL_LENGTH)
    // Trait names are optional decoration; a bad one is dropped, not the figure.
    if (!geneSet.has(gene) || !dominant || !recessive || traits.some((trait) => trait.gene === gene)) continue
    traits.push({ gene, dominant, recessive, ...(intermediate ? { intermediate } : {}) })
  }
  const canonical = (pairs: Array<[string, string]>) => pairs.map(([a, b]) => `${a}${b}`).join('')
  const value: PunnettVisualization = {
    ...base,
    type: 'punnett_2d',
    mother: canonical(mother),
    father: canonical(father),
    dominance,
    traits,
  }
  return { ok: true, value }
}

function normalizePedigree(draft: VisualizationDraft, base: CommonBase): Normalized {
  const list = Array.isArray(draft.members) ? draft.members : []
  if (list.length < 2 || list.length > MAX_PEDIGREE_MEMBERS) return { ok: false, reason: 'invalid-pedigree-size' }
  const members: PedigreeMember[] = []
  const ids = new Set<string>()
  for (const raw of list) {
    const item = asRecord(raw)
    const id = sanitizeText(item?.id, MAX_ID_LENGTH)
    if (!id || ids.has(id) || DANGEROUS_KEYS.has(id)) return { ok: false, reason: 'invalid-pedigree-member' }
    ids.add(id)
    const sex = item?.sex === 'male' || item?.sex === 'female' ? item.sex : 'unknown'
    const label = sanitizeText(item?.label, MAX_LABEL_LENGTH)
    const father = sanitizeText(item?.father, MAX_ID_LENGTH)
    const mother = sanitizeText(item?.mother, MAX_ID_LENGTH)
    members.push({
      id,
      sex,
      affected: item?.affected === true,
      ...(item?.carrier === true && item?.affected !== true ? { carrier: true } : {}),
      ...(label ? { label } : {}),
      ...(father ? { father } : {}),
      ...(mother ? { mother } : {}),
    })
  }
  if (!pedigreeGenerations(members)) return { ok: false, reason: 'invalid-pedigree-structure' }
  // A pedigree needs at least one parent–child link to be a family.
  if (!members.some((member) => member.father || member.mother)) return { ok: false, reason: 'pedigree-without-children' }
  const value: PedigreeVisualization = { ...base, type: 'pedigree_2d', members }
  return { ok: true, value }
}

function normalizeTranslation(draft: VisualizationDraft, base: CommonBase): Normalized {
  const dna = typeof draft.dna === 'string' ? draft.dna.toUpperCase().replace(/[\s-]/g, '') : ''
  const strand = draft.strand === 'template' ? 'template' : 'coding'
  if (!dna || dna.length > MAX_DNA_LENGTH) return { ok: false, reason: 'invalid-dna' }
  if (!translateDna(dna, strand)) return { ok: false, reason: 'invalid-dna' }
  const value: TranslationVisualization = { ...base, type: 'translation_2d', dna, strand }
  return { ok: true, value }
}

export const SCIENCE_NORMALIZERS: Record<
  string,
  (draft: VisualizationDraft, base: CommonBase) => Normalized
> = {
  molecule_2d: normalizeMolecule,
  energy_2d: normalizeEnergy,
  titration_2d: normalizeTitration,
  punnett_2d: normalizePunnett,
  pedigree_2d: normalizePedigree,
  translation_2d: normalizeTranslation,
}
