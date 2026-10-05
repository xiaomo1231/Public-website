import { describe, expect, it } from 'vitest'
import {
  energyProfileFacts,
  equivalenceVolume,
  sameFormula,
  smilesFormula,
  titrationCurve,
  titrationPH,
} from '@/entities/tutorVisualization/chemistry'
import {
  gametes,
  genotypePairs,
  pedigreeGenerations,
  punnettSquare,
  ratioText,
  translateDna,
} from '@/entities/tutorVisualization/biology'

const close = (a: number, b: number, eps = 0.02) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('molecules', () => {
  it('computes the formula of a SMILES string, including implicit hydrogens', () => {
    expect(smilesFormula('CCO')).toBe('C2H6O')
    expect(smilesFormula('CC(=O)Oc1ccccc1C(=O)O')).toBe('C9H8O4')
    expect(smilesFormula('not smiles!')).toBeNull()
    expect(smilesFormula('X')).toBeNull()
  })

  it('compares formulas regardless of order and notation', () => {
    expect(sameFormula('C2H6O', 'C2H5OH')).toBe(true)
    expect(sameFormula('C₉H₈O₄', 'C9H8O4')).toBe(true)
    expect(sameFormula('C2H6O', 'C2H4O2')).toBe(false)
  })
})

describe('energy profiles', () => {
  it('derives ΔH and the activation energy from the states', () => {
    expect(
      energyProfileFacts([
        { label: 'R', energy: 0 },
        { label: 'TS', energy: 120, transition: true },
        { label: 'P', energy: -80 },
      ]),
    ).toEqual({ deltaH: -80, activationEnergy: 120, exothermic: true })
  })
})

describe('titration', () => {
  const strong = { acidConcentration: 0.1, acidVolume: 25, baseConcentration: 0.1 }
  const weak = { ...strong, ka: 1.8e-5 }

  it('matches textbook pH values for a strong acid', () => {
    close(titrationPH(strong, 0), 1)
    close(titrationPH(strong, 25), 7)
    close(titrationPH(strong, 50), 12.52)
    expect(equivalenceVolume(strong)).toBe(25)
  })

  it('gives pH = pKa at half equivalence and a basic equivalence point for a weak acid', () => {
    close(titrationPH(weak, 0), 2.87)
    close(titrationPH(weak, 12.5), 4.74)
    close(titrationPH(weak, 25), 8.72)
  })

  it('rises monotonically', () => {
    const curve = titrationCurve(weak, 60)
    for (let i = 1; i < curve.length; i++) expect(curve[i]!.pH).toBeGreaterThanOrEqual(curve[i - 1]!.pH - 1e-9)
  })
})

describe('Punnett squares', () => {
  it('reads genotypes and forms gametes by independent assortment', () => {
    expect(genotypePairs('aA')).toEqual([['A', 'a']])
    expect(gametes(genotypePairs('AaBb')!)).toEqual(['AB', 'Ab', 'aB', 'ab'])
    expect(genotypePairs('AbBa')).toBeNull()
    expect(genotypePairs('AaBbCc')).toBeNull()
  })

  it('gives the classic 3:1 and 9:3:3:1 ratios', () => {
    const mono = punnettSquare(genotypePairs('Aa')!, genotypePairs('Aa')!, 'complete')
    expect(ratioText(mono.phenotypes.map((p) => p.count))).toBe('3 : 1')
    expect(ratioText(mono.genotypes.map((g) => g.count))).toBe('2 : 1 : 1')
    const di = punnettSquare(genotypePairs('AaBb')!, genotypePairs('AaBb')!, 'complete')
    expect(ratioText(di.phenotypes.map((p) => p.count))).toBe('9 : 3 : 3 : 1')
    const incomplete = punnettSquare(genotypePairs('Rr')!, genotypePairs('Rr')!, 'incomplete')
    expect(incomplete.phenotypes).toHaveLength(3)
  })
})

describe('pedigrees', () => {
  it('places founders, spouses and children in generations', () => {
    const generations = pedigreeGenerations([
      { id: 'gf', sex: 'male', affected: false },
      { id: 'gm', sex: 'female', affected: true },
      { id: 'dad', sex: 'male', affected: false, father: 'gf', mother: 'gm' },
      { id: 'mum', sex: 'female', affected: false },
      { id: 'kid', sex: 'female', affected: true, father: 'dad', mother: 'mum' },
    ])!
    expect(generations.get('gf')).toBe(0)
    expect(generations.get('dad')).toBe(1)
    expect(generations.get('mum')).toBe(1)
    expect(generations.get('kid')).toBe(2)
  })

  it('rejects impossible families', () => {
    expect(pedigreeGenerations([{ id: 'a', sex: 'female', affected: false }, { id: 'b', sex: 'male', affected: false, father: 'a' }])).toBeNull()
    expect(pedigreeGenerations([{ id: 'a', sex: 'male', affected: false, father: 'x' }])).toBeNull()
    expect(
      pedigreeGenerations([
        { id: 'a', sex: 'male', affected: false, father: 'b' },
        { id: 'b', sex: 'male', affected: false, father: 'a' },
      ]),
    ).toBeNull()
  })
})

describe('transcription and translation', () => {
  it('reads a coding strand and stops at a stop codon', () => {
    const result = translateDna('ATGTTTGGCTAAGGG', 'coding')!
    expect(result.mrna).toBe('AUGUUUGGCUAAGGG')
    expect(result.codons.map((c) => c.aminoAcid)).toEqual(['Met', 'Phe', 'Gly', 'Stop'])
    expect(result.stopped).toBe(true)
  })

  it('complements a template strand', () => {
    expect(translateDna('TACAAA', 'template')!.mrna).toBe('AUGUUU')
    expect(translateDna('ATGXYZ', 'coding')).toBeNull()
  })
})
