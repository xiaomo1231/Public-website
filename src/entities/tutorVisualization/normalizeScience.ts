/**
 * Normalizers for the chemistry and biology figures.
 *
 * Same contract as `normalize.ts`: the draft is untrusted, every field is
 * checked, and anything the local maths cannot confirm is rejected. The model
 * supplies only lesson facts (SMILES + the formula the lesson names, state
 * energies, concentrations, genotypes, family members, a DNA strand).
 */
import type {
  ChiSquareTestVisualization,
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
  alleleTokens,
  crossProblem,
  geneOf,
  genotypePairs,
  pedigreeGenerations,
  translateDna,
  type PedigreeMember,
} from './biology'
import { MAX_CHI_SQUARE_CATEGORIES, expectedFromRatio } from './chiSquare'

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
  // v8 fields, with the v7 monoprotic names still accepted.
  const analyte = draft.analyte === 'base' ? 'base' : 'acid'
  const concentration = readNumber(draft.concentration ?? draft.acidConcentration)
  const volume = readNumber(draft.volume ?? draft.acidVolume)
  const titrantConcentration = readNumber(draft.titrantConcentration ?? draft.baseConcentration)
  const inRange = (v: number | null, min: number, max: number): v is number => v !== null && v >= min && v <= max
  if (!inRange(concentration, 1e-4, 10) || !inRange(volume, 1, 500) || !inRange(titrantConcentration, 1e-4, 10)) {
    return { ok: false, reason: 'invalid-titration-setup' }
  }
  const constant = (value: unknown): number | null => {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isFinite(n) && n >= 1e-14 && n <= 10 ? n : null
  }
  let ka: number[] | undefined
  let kb: number | undefined
  if (analyte === 'acid' && draft.ka !== undefined && draft.ka !== null) {
    const list = Array.isArray(draft.ka) ? draft.ka : [draft.ka]
    const values = list.map(constant)
    // Up to three successive constants, each smaller than the one before.
    if (values.length === 0 || values.length > 3 || values.some((v) => v === null)) {
      return { ok: false, reason: 'invalid-titration-ka' }
    }
    if (values.some((v, i) => i > 0 && v! >= values[i - 1]!)) return { ok: false, reason: 'invalid-titration-ka' }
    ka = values as number[]
  }
  if (analyte === 'base' && draft.kb !== undefined && draft.kb !== null) {
    const value = constant(draft.kb)
    if (value === null) return { ok: false, reason: 'invalid-titration-kb' }
    kb = value
  }
  const analyteLabel = sanitizeText(draft.analyteLabel ?? draft.acidLabel, MAX_LABEL_LENGTH)
  const titrantLabel = sanitizeText(draft.titrantLabel ?? draft.baseLabel, MAX_LABEL_LENGTH)
  const value: TitrationVisualization = {
    ...base,
    type: 'titration_2d',
    setup: {
      analyte,
      concentration,
      volume,
      titrantConcentration,
      ...(ka ? { ka } : {}),
      ...(kb !== undefined ? { kb } : {}),
    },
    ...(analyteLabel ? { analyteLabel } : {}),
    ...(titrantLabel ? { titrantLabel } : {}),
  }
  return { ok: true, value }
}

function normalizePunnett(draft: VisualizationDraft, base: CommonBase): Normalized {
  const motherText = typeof draft.mother === 'string' ? draft.mother.replace(/\s+/g, '') : ''
  const fatherText = typeof draft.father === 'string' ? draft.father.replace(/\s+/g, '') : ''
  const mother = genotypePairs(motherText)
  const father = genotypePairs(fatherText)
  if (!mother || !father) return { ok: false, reason: 'invalid-genotype' }
  const problem = crossProblem(mother, father)
  if (problem === 'genes-differ') return { ok: false, reason: 'genotype-genes-differ' }
  if (problem === 'sex-mismatch') return { ok: false, reason: 'genotype-sex-mismatch' }
  const dominance = draft.dominance === 'incomplete' || draft.dominance === 'codominant' ? draft.dominance : 'complete'
  // Trait names attach to a gene by its letter (A/a → a, I^A/i → i, X^B/X^b → b).
  const letters = new Set(mother.map((pair) => geneOf(pair).replace(/^X:/, '')))
  const alleleSet = new Set([...mother, ...father].flat())
  const traits: PunnettTrait[] = []
  for (const raw of Array.isArray(draft.traits) ? draft.traits : []) {
    const item = asRecord(raw)
    const gene = typeof item?.gene === 'string' ? item.gene.trim().toLowerCase().replace(/^x[:^](?=.)/, '')[0] ?? '' : ''
    if (!letters.has(gene) || traits.some((trait) => trait.gene === gene)) continue
    const dominant = sanitizeText(item?.dominant, MAX_LABEL_LENGTH)
    const recessive = sanitizeText(item?.recessive, MAX_LABEL_LENGTH)
    const intermediate = sanitizeText(item?.intermediate, MAX_LABEL_LENGTH)
    const alleles: NonNullable<PunnettTrait['alleles']> = []
    for (const entry of Array.isArray(item?.alleles) ? item.alleles.slice(0, 6) : []) {
      const record = asRecord(entry)
      const tokens = typeof record?.allele === 'string' ? alleleTokens(record.allele) : null
      const name = sanitizeText(record?.name, MAX_LABEL_LENGTH)
      // Names only for alleles that are actually in the cross.
      if (tokens?.length === 1 && name && alleleSet.has(tokens[0]!)) alleles.push({ allele: tokens[0]!, name })
    }
    // Trait names are optional decoration; an unusable entry is dropped, not the figure.
    if (!(dominant && recessive) && alleles.length === 0) continue
    traits.push({
      gene,
      ...(dominant && recessive ? { dominant, recessive } : {}),
      ...(intermediate ? { intermediate } : {}),
      ...(alleles.length ? { alleles } : {}),
    })
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
  const written = typeof draft.dna === 'string' ? draft.dna.replace(/[′’]/g, "'").replace(/\s+/g, '') : ''
  // End labels written with the sequence ("3'-TAC…-5'") are the most
  // reliable statement of its direction; otherwise the stated direction, and
  // otherwise the university convention of writing every strand 5′→3′.
  const marked = /^3'/.test(written) ? '3to5' : /^5'/.test(written) ? '5to3' : null
  const stated = draft.direction === '3to5' || draft.direction === '5to3' ? draft.direction : null
  const direction = marked ?? stated ?? '5to3'
  const dna = written.toUpperCase().replace(/^[35]'-?|-?[35]'$/g, '').replace(/-/g, '')
  const strand = draft.strand === 'template' ? 'template' : 'coding'
  const start = draft.start === 'first' ? 'first' : 'aug'
  if (!dna || dna.length > MAX_DNA_LENGTH) return { ok: false, reason: 'invalid-dna' }
  if (!translateDna(dna, strand, { direction, start })) return { ok: false, reason: 'invalid-dna' }
  const value: TranslationVisualization = { ...base, type: 'translation_2d', dna, strand, direction, start }
  return { ok: true, value }
}

function normalizeChiSquare(draft: VisualizationDraft, base: CommonBase): Normalized {
  const list = Array.isArray(draft.categories) ? draft.categories : []
  if (list.length < 2 || list.length > MAX_CHI_SQUARE_CATEGORIES) return { ok: false, reason: 'invalid-chisquare-categories' }
  const labels: string[] = []
  const observed: number[] = []
  const expected: Array<number | null> = []
  const ratio: Array<number | null> = []
  for (const raw of list) {
    const item = asRecord(raw)
    const label = sanitizeText(item?.label, MAX_LABEL_LENGTH)
    const count = readNumber(item?.observed)
    if (!label || count === null || count < 0) return { ok: false, reason: 'invalid-chisquare-category' }
    labels.push(label)
    observed.push(count)
    const e = readNumber(item?.expected)
    const r = readNumber(item?.ratio)
    expected.push(e !== null && e > 0 ? e : null)
    ratio.push(r !== null && r > 0 ? r : null)
  }
  const total = observed.reduce((a, b) => a + b, 0)
  if (total <= 0) return { ok: false, reason: 'invalid-chisquare-category' }
  let expectedCounts: number[]
  if (expected.every((e) => e !== null)) {
    expectedCounts = expected as number[]
    // Expected counts must describe the same sample as the observed ones.
    const sum = expectedCounts.reduce((a, b) => a + b, 0)
    if (Math.abs(sum - total) > Math.max(0.5, total * 0.01)) return { ok: false, reason: 'chisquare-expected-total' }
  } else if (ratio.every((r) => r !== null)) {
    expectedCounts = expectedFromRatio(observed, ratio as number[])
  } else {
    return { ok: false, reason: 'chisquare-missing-expected' }
  }
  const categories = labels.map((label, i) => ({ label, observed: observed[i]!, expected: expectedCounts[i]! }))
  const rawDf = readNumber(draft.df)
  const df = rawDf !== null && Number.isInteger(rawDf) && rawDf >= 1 && rawDf <= categories.length - 1 ? rawDf : categories.length - 1
  const rawAlpha = readNumber(draft.alpha)
  const alpha = rawAlpha !== null && rawAlpha > 0 && rawAlpha < 0.5 ? rawAlpha : 0.05
  const value: ChiSquareTestVisualization = { ...base, type: 'chisquare_test_2d', categories, df, alpha }
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
  chisquare_test_2d: normalizeChiSquare,
}
