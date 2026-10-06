import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { compareQuantity, isValidUnit } from '@/infrastructure/math/quantityAnswer'
import { compareEquations, parseEquation, previewEquation } from '@/infrastructure/chemistry/equation'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import { cdf, moments, quantile } from '@/entities/tutorVisualization/distribution'
import { chiSquareTest, expectedFromRatio } from '@/entities/tutorVisualization/chiSquare'
import {
  crossProblem,
  genotypePairs,
  inheritanceAnalysis,
  punnettSquare,
  ratioText,
  translateDna,
  type PedigreeMember,
} from '@/entities/tutorVisualization/biology'
import { bufferPoints, equivalenceVolumes, titrationPH } from '@/entities/tutorVisualization/chemistry'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import { hasGraphableMath, looksLikeBiologyFigureText } from '@/entities/tutorVisualization/graphable'
import { TUTOR_VISUALIZATION_SCHEMA_VERSION, type TutorVisualization } from '@/entities/tutorVisualization/types'
import type { Question } from '@/entities/question/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'

const near = (a: number, b: number, eps: number) => expect(Math.abs(a - b)).toBeLessThan(eps)

function one(draft: Record<string, unknown>): TutorVisualization | string {
  const result = normalizeVisualizations({ visualizations: [draft] })
  return result.visualizations[0] ?? result.rejected[0]!.reason
}

const base = { schemaVersion: TUTOR_VISUALIZATION_SCHEMA_VERSION, placement: { scope: 'lesson' as const } }

describe('university units', () => {
  it('reads molarity, daltons, calories and ppm', () => {
    for (const unit of ['M', 'mM', 'uM', 'µM', 'kDa', 'kcal/mol', 'ppm', 'Å']) expect(isValidUnit(unit)).toBe(true)
    expect(compareQuantity('100 mM', '0.1', 'mol/L').isCorrect).toBe(true)
    expect(compareQuantity('0.1 M', '100', 'mM').isCorrect).toBe(true)
    expect(compareQuantity('10 kcal/mol', '41.84', 'kJ/mol').isCorrect).toBe(true)
    expect(compareQuantity('1 Å', '0.1', 'nm').isCorrect).toBe(true)
    expect(compareQuantity('0.1 M', '0.1', 'kJ/mol').outcome).toBe('wrong-dimension')
  })
})

describe('organic and redox equations', () => {
  it('reads double and triple bonds and finds the real arrow', () => {
    for (const eq of ['CH2=CH2 + H2 -> CH3CH3', 'CH2=CH2 + H2 = CH3CH3', 'CH2=CH2+H2=CH3CH3', 'HC≡CH + 2H2 -> CH3-CH3']) {
      const parsed = parseEquation(eq)
      expect(parsed.ok, eq).toBe(true)
    }
    expect(previewEquation('CH2=CH2 + H2 = CH3CH3')).toEqual({ status: 'ok', latex: '\\ce{CH2=CH2 + H2 -> CH3CH3}' })
    expect(parseEquation('MnO4- + 8H+ + 5e- -> Mn^2+ + 4H2O').ok).toBe(true)
  })

  it('does not confirm a different structure with the same formula', () => {
    const reference = parseEquation('CH3CH2OH -> CH2=CH2 + H2O')
    if (!reference.ok) throw new Error('reference')
    expect(compareEquations('CH3CH2OH -> CH2=CH2 + H2O', reference.equation)).toEqual({ verdict: 'correct' })
    expect(compareEquations('CH3-CH2-OH -> CH2=CH2 + H2O', reference.equation)).toEqual({ verdict: 'correct' })
    expect(compareEquations('CH3OCH3 -> CH2=CH2 + H2O', reference.equation)).toMatchObject({ verdict: 'isomers', species: ['CH3OCH3'] })
    const plain = parseEquation('C2H6O -> C2H4 + H2O')
    if (!plain.ok) throw new Error('plain')
    expect(compareEquations('CH3CH2OH -> CH2=CH2 + H2O', plain.equation)).toEqual({ verdict: 'correct' })
  })

  it('leaves a possible isomer ungraded with an explanation', () => {
    const q = { id: 'q', projectId: 'p', knowledgePoint: 'K', type: 'chem_equation', difficulty: 'basic', prompt: '', correctAnswer: 'CH3CH2OH -> CH2=CH2 + H2O', hints: [], sourceRefs: [], promptVersion: 'v4', createdAt: 1 } as Question
    expect(evaluateDeterministic(q, 'CH3OCH3 -> CH2=CH2 + H2O')).toMatchObject({ isCorrect: null, method: 'unverified' })
    expect(evaluateDeterministic(q, 'CH3CH2OH -> CH2=CH2 + H2O').isCorrect).toBe(true)
  })
})

describe('t, χ² and F distributions', () => {
  it('match standard table values', () => {
    near(cdf({ family: 't', df: 10 }, 2.228), 0.975, 1e-3)
    near(cdf({ family: 't', df: 1 }, 1), 0.75, 1e-6)
    near(cdf({ family: 'chisquare', df: 3 }, 7.815), 0.95, 1e-3)
    near(cdf({ family: 'f', df1: 3, df2: 10 }, 3.708), 0.95, 1e-3)
    near(quantile({ family: 't', df: 5 }, 0.975), 2.571, 2e-3)
    near(quantile({ family: 'chisquare', df: 1 }, 0.95), 3.841, 2e-3)
  })

  it('reports moments that do not exist', () => {
    expect(Number.isNaN(moments({ family: 't', df: 1 }).mean)).toBe(true)
    expect(moments({ family: 't', df: 2 }).variance).toBe(Infinity)
    expect(moments({ family: 'chisquare', df: 4 })).toEqual({ mean: 4, variance: 8 })
  })

  it('normalises the new families', () => {
    expect(one({ type: 'distribution_2d', family: 't', params: { df: 8 }, interval: { from: 2 } })).toMatchObject({ params: { family: 't', df: 8 } })
    expect(one({ type: 'distribution_2d', family: 'f', params: { df1: 3, df2: 0 } })).toBe('invalid-distribution-params')
  })
})

describe('chi-square goodness of fit', () => {
  it("reproduces Mendel's dihybrid test", () => {
    const observed = [315, 108, 101, 32]
    const expected = expectedFromRatio(observed, [9, 3, 3, 1])
    const result = chiSquareTest(
      observed.map((o, i) => ({ label: String(i), observed: o, expected: expected[i]! })),
      3,
      0.05,
    )
    near(result.statistic, 0.47, 0.01)
    near(result.pValue, 0.925, 0.01)
    near(result.critical, 7.815, 0.01)
    expect(result.rejects).toBe(false)
  })

  it('normalises categories with a ratio or expected counts', () => {
    const value = one({
      type: 'chisquare_test_2d',
      categories: [
        { label: 'Round yellow', observed: 315, ratio: 9 },
        { label: 'Round green', observed: 108, ratio: 3 },
        { label: 'Wrinkled yellow', observed: 101, ratio: 3 },
        { label: 'Wrinkled green', observed: 32, ratio: 1 },
      ],
    })
    expect(value).toMatchObject({ type: 'chisquare_test_2d', df: 3, alpha: 0.05 })
    expect(one({ type: 'chisquare_test_2d', categories: [{ label: 'a', observed: 10, expected: 30 }, { label: 'b', observed: 10, expected: 30 }] })).toBe('chisquare-expected-total')
    expect(one({ type: 'chisquare_test_2d', categories: [{ label: 'a', observed: 10 }, { label: 'b', observed: 10 }] })).toBe('chisquare-missing-expected')
  })
})

describe('university genetics', () => {
  it('splits an X-linked cross by sex', () => {
    const result = punnettSquare(genotypePairs('X^AX^a')!, genotypePairs('X^AY')!, 'complete')
    expect(result.bySex!.female.phenotypes).toHaveLength(1)
    expect(ratioText(result.bySex!.male.phenotypes.map((p) => p.count))).toBe('1 : 1')
  })

  it('handles ABO multiple alleles with codominance', () => {
    const result = punnettSquare(genotypePairs('I^Ai')!, genotypePairs('I^Bi')!, 'complete')
    expect(result.phenotypes.map((p) => p.key).sort()).toEqual(['i:I^A', 'i:I^A+I^B', 'i:I^B', 'i:i'])
    expect(ratioText(result.phenotypes.map((p) => p.count))).toBe('1 : 1 : 1 : 1')
  })

  it('keeps Mendel letters (Y/y for seed colour) autosomal', () => {
    const result = punnettSquare(genotypePairs('YyRr')!, genotypePairs('YyRr')!, 'complete')
    expect(ratioText(result.phenotypes.map((p) => p.count))).toBe('9 : 3 : 3 : 1')
    expect(result.bySex).toBeUndefined()
  })

  it('crosses an autosomal with an X-linked gene and rejects impossible parents', () => {
    const result = punnettSquare(genotypePairs('AaX^BX^b')!, genotypePairs('aaX^bY')!, 'complete')
    expect(result.total).toBe(16)
    expect(crossProblem(genotypePairs('X^AY')!, genotypePairs('X^AY')!)).toBe('sex-mismatch')
    expect(genotypePairs('X^AX^b')).toBeNull()
  })

  it('codominance gives three classes', () => {
    const result = punnettSquare(genotypePairs('Rr')!, genotypePairs('Rr')!, 'codominant')
    expect(ratioText(result.phenotypes.map((p) => p.count))).toBe('2 : 1 : 1')
  })

  it('normalises X-linked and ABO crosses with allele names', () => {
    expect(one({ type: 'punnett_2d', mother: 'X^AY', father: 'X^AY' })).toBe('genotype-sex-mismatch')
    expect(
      one({
        type: 'punnett_2d',
        mother: 'I^Ai',
        father: 'I^Bi',
        traits: [{ gene: 'i', alleles: [{ allele: 'I^A', name: 'A' }, { allele: 'I^B', name: 'B' }, { allele: 'i', name: 'O' }] }],
      }),
    ).toMatchObject({ traits: [{ gene: 'i', alleles: [{ allele: 'I^A', name: 'A' }, { allele: 'I^B', name: 'B' }, { allele: 'i', name: 'O' }] }] })
  })
})

describe('inheritance-mode analysis', () => {
  const family = (members: Array<Partial<PedigreeMember> & { id: string }>): PedigreeMember[] =>
    members.map((m) => ({ sex: 'unknown', affected: false, ...m }) as PedigreeMember)

  it('identifies an autosomal recessive pattern', () => {
    const verdicts = inheritanceAnalysis(
      family([
        { id: 'f', sex: 'male' },
        { id: 'm', sex: 'female' },
        { id: 'd', sex: 'female', affected: true, father: 'f', mother: 'm' },
        { id: 's', sex: 'male', father: 'f', mother: 'm' },
      ]),
    )!
    const byMode = Object.fromEntries(verdicts.map((v) => [v.mode, v]))
    expect(byMode.AR!.possible).toBe(true)
    expect(byMode.AD).toMatchObject({ possible: false, reason: { kind: 'unaffected-parents-affected-child' } })
    expect(byMode.XR).toMatchObject({ possible: false, reason: { kind: 'affected-daughter-unaffected-father' } })
    expect(byMode.YL).toMatchObject({ possible: false })
  })

  it('allows X-linked recessive for an affected son of a carrier mother', () => {
    const verdicts = inheritanceAnalysis(
      family([
        { id: 'f', sex: 'male' },
        { id: 'm', sex: 'female', carrier: true },
        { id: 's', sex: 'male', affected: true, father: 'f', mother: 'm' },
      ]),
    )!
    const byMode = Object.fromEntries(verdicts.map((v) => [v.mode, v.possible]))
    expect(byMode).toMatchObject({ XR: true, AR: true, AD: false, XD: false })
  })

  it('excludes autosomal recessive when two affected parents have an unaffected child', () => {
    const verdicts = inheritanceAnalysis(
      family([
        { id: 'f', sex: 'male', affected: true },
        { id: 'm', sex: 'female', affected: true },
        { id: 'c', sex: 'female', father: 'f', mother: 'm' },
      ]),
    )!
    expect(verdicts.find((v) => v.mode === 'AR')).toMatchObject({ possible: false, reason: { kind: 'affected-parents-unaffected-child' } })
    expect(verdicts.find((v) => v.mode === 'AD')!.possible).toBe(true)
  })
})

describe('transcription with strand direction and start codon', () => {
  it('reverses a template strand written 5′→3′', () => {
    // Coding ATGGCCTAA; its template written 5′→3′ is TTAGGCCAT.
    const result = translateDna('TTAGGCCAT', 'template', { direction: '5to3', start: 'aug' })!
    expect(result.mrna).toBe('AUGGCCUAA')
    expect(result.reversed).toBe(true)
    expect(result.codons.map((c) => c.aminoAcid)).toEqual(['Met', 'Ala', 'Stop'])
  })

  it('starts at the first AUG', () => {
    const result = translateDna('GCATGGCCTGA', 'coding', { direction: '5to3', start: 'aug' })!
    expect(result.startIndex).toBe(2)
    expect(result.codons.map((c) => c.aminoAcid)).toEqual(['Met', 'Ala', 'Stop'])
    expect(translateDna('GGGCCC', 'coding', { start: 'aug' })!.startIndex).toBe(-1)
  })

  it('reads the direction from 5′/3′ labels and defaults to 5′→3′', () => {
    expect(one({ type: 'translation_2d', dna: "3'-TACCGGATT-5'", strand: 'template' })).toMatchObject({ dna: 'TACCGGATT', direction: '3to5', start: 'aug' })
    expect(one({ type: 'translation_2d', dna: 'TTAGGCCAT', strand: 'template' })).toMatchObject({ direction: '5to3' })
  })
})

describe('polyprotic and weak-base titrations', () => {
  const phosphoric = { analyte: 'acid' as const, concentration: 0.1, volume: 25, titrantConcentration: 0.1, ka: [7.5e-3, 6.2e-8, 4.8e-13] }
  const ammonia = { analyte: 'base' as const, concentration: 0.1, volume: 25, titrantConcentration: 0.1, kb: 1.8e-5 }

  it('finds one equivalence point per proton', () => {
    expect(equivalenceVolumes(phosphoric)).toEqual([25, 50, 75])
    near(titrationPH(phosphoric, 37.5), 7.21, 0.05)
    near(titrationPH(phosphoric, 25), 4.67, 0.15)
    expect(bufferPoints(phosphoric).map((p) => p.volume)).toEqual([12.5, 37.5, 62.5])
  })

  it('titrates a weak base with a strong acid', () => {
    near(titrationPH(ammonia, 0), 11.13, 0.03)
    near(titrationPH(ammonia, 12.5), 9.26, 0.03)
    near(titrationPH(ammonia, 25), 5.28, 0.05)
  })

  it('normalises analytes and rejects disordered constants', () => {
    expect(one({ type: 'titration_2d', analyte: 'base', concentration: 0.1, volume: 25, titrantConcentration: 0.1, kb: 1.8e-5 })).toMatchObject({
      setup: { analyte: 'base', kb: 1.8e-5 },
    })
    expect(one({ type: 'titration_2d', concentration: 0.1, volume: 25, titrantConcentration: 0.1, ka: [1e-7, 1e-3] })).toBe('invalid-titration-ka')
  })
})

describe('university figures render', () => {
  it('shows the χ² verdict and the ABO phenotype names', () => {
    render(
      <TutorVisualizationFigure
        visualization={{
          ...base,
          id: 'x',
          type: 'chisquare_test_2d',
          df: 3,
          alpha: 0.05,
          categories: [
            { label: 'RY', observed: 315, expected: 312.75 },
            { label: 'Ry', observed: 108, expected: 104.25 },
            { label: 'rY', observed: 101, expected: 104.25 },
            { label: 'ry', observed: 32, expected: 34.75 },
          ],
        }}
      />,
    )
    expect(screen.getByText(/do not reject the null hypothesis/)).toBeInTheDocument()

    render(
      <TutorVisualizationFigure
        visualization={{
          ...base,
          id: 'abo',
          type: 'punnett_2d',
          mother: 'I^Ai',
          father: 'I^Bi',
          dominance: 'complete',
          traits: [{ gene: 'i', alleles: [{ allele: 'I^A', name: 'A' }, { allele: 'I^B', name: 'B' }, { allele: 'i', name: 'O' }] }],
        }}
      />,
    )
    for (const name of ['A', 'B', 'AB', 'O']) expect(screen.getAllByText(name).length).toBeGreaterThan(0)
  })

  it('lists the possible modes of inheritance under a pedigree', () => {
    render(
      <TutorVisualizationFigure
        visualization={{
          ...base,
          id: 'p',
          type: 'pedigree_2d',
          members: [
            { id: 'f', sex: 'male', affected: false },
            { id: 'm', sex: 'female', affected: false },
            { id: 'd', sex: 'female', affected: true, father: 'f', mother: 'm' },
          ],
        }}
      />,
    )
    expect(screen.getByText('Possible modes of inheritance')).toBeInTheDocument()
    // Excludes both dominant modes for the same reason.
    expect(screen.getAllByText(/unaffected parents with an affected child \(I-1, I-2, II-1\)/)).toHaveLength(2)
  })
})

describe('prompts and gates', () => {
  it('offers the χ² test to statistics and biology but not calculus', () => {
    expect(prompts.visualizationGenerator.buildSystemPrompt({ subject: 'stats' })).toContain('chisquare_test_2d')
    expect(prompts.visualizationGenerator.buildSystemPrompt({ subject: 'biology' })).toContain('X^AX^a')
    expect(prompts.visualizationGenerator.buildSystemPrompt({ subject: 'calculus' })).not.toContain('chisquare_test_2d')
    expect(prompts.visualizationGenerator.buildSystemPrompt({ subject: 'chemistry' })).toContain('polyprotic')
  })

  it('recognises the new topics', () => {
    expect(looksLikeBiologyFigureText('伴性遗传与 X 连锁隐性')).toBe(true)
    expect(hasGraphableMath('服从自由度为 5 的 t 分布')).toBe(true)
    expect(hasGraphableMath('用卡方检验判断是否符合 9:3:3:1')).toBe(true)
  })

  it('profiles teach at university depth', () => {
    expect(prompts.subjectProfile.withSubject('S', 'chemistry')).toMatch(/ΔG° = ΔH° − TΔS°/)
    expect(prompts.subjectProfile.withSubject('S', 'biology')).toMatch(/5′→3′/)
    expect(prompts.subjectProfile.withSubject('S', 'stats')).toMatch(/degrees of freedom/)
  })
})
