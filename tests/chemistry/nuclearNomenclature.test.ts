import { beforeEach, describe, expect, it } from 'vitest'
import {
  compareEquations,
  imbalances,
  isNuclear,
  parseEquation,
  parseSpecies,
} from '@/infrastructure/chemistry/equation'
import {
  compareFormula,
  nameAccepted,
  normalizeChemicalName,
} from '@/infrastructure/chemistry/nomenclature'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import type { Question } from '@/entities/question/types'
import { setUILanguage } from '@/i18n'

function parsed(text: string) {
  const result = parseEquation(text)
  if (!result.ok)
    throw new Error(`could not parse ${text}: ${result.reason} ${result.detail ?? ''}`)
  return result.equation
}

describe('nuclide notation', () => {
  it.each([
    ['^{54}Cr^{6+}', '[54]Cr6+', 54, 24],
    ['⁵⁴Cr⁶⁺', '[54]Cr6+', 54, 24],
    ['²³⁵U', '[235]U', 235, 92],
    ['^235_92U', '[235]U', 235, 92],
    ['{}^{14}_{6}C', '[14]C', 14, 6],
    ['_6^14C', '[14]C', 14, 6],
  ])('%s', (text, key, A, Z) => {
    const species = parseSpecies(text)
    expect(species?.key).toBe(key)
    expect(species?.nucleus).toEqual({ A, Z })
  })

  it('rejects an atomic number that does not belong to the element', () => {
    expect(parseSpecies('^14_7C')).toBeNull()
    expect(parseSpecies('^2_1He')).toBeNull()
  })

  it('knows the particles, written either way', () => {
    expect(parseSpecies('α')?.key).toBe(parseSpecies('^4_2He')?.key)
    expect(parseSpecies('β-')?.key).toBe('e-')
    expect(parseSpecies('^0_-1e')?.key).toBe('e-')
    expect(parseSpecies('β+')?.key).toBe('e+')
    expect(parseSpecies('^1_0n')?.key).toBe('n')
    expect(parseSpecies('γ')?.nucleus).toEqual({ A: 0, Z: 0 })
  })
})

describe('nuclear equations conserve A and Z', () => {
  it('fission, alpha and beta decay balance', () => {
    for (const text of [
      '^{235}_{92}U + ^1_0n -> ^{141}_{56}Ba + ^{92}_{36}Kr + 3 ^1_0n',
      '^{238}U -> ^{234}Th + α',
      '^{14}C -> ^{14}N + β-',
      '^{14}_{6}C -> ^{14}_{7}N + ^0_-1e',
      '^{11}C -> ^{11}B + β+',
      '^{60}Ni^* -> ^{60}Ni + γ'.replace('^*', ''),
    ]) {
      const equation = parsed(text)
      expect(isNuclear(equation)).toBe(true)
      expect(imbalances(equation)).toEqual([])
    }
  })

  it('reports the mass number and atomic number that do not balance', () => {
    const equation = parsed('^{238}U -> ^{234}Th + β-')
    expect(imbalances(equation)).toEqual([
      { what: 'mass number', left: 238, right: 234 },
      { what: 'atomic number', left: 92, right: 89 },
    ])
  })

  it('an element without a mass number in a nuclear equation is not readable', () => {
    expect(parseEquation('U -> ^{234}Th + α')).toMatchObject({ ok: false, reason: 'bad-species' })
  })

  it('grades a nuclear equation against the reference (α = ^4_2He)', () => {
    const reference = parsed('^{238}_{92}U -> ^{234}_{90}Th + ^4_2He')
    expect(compareEquations('^{238}U -> ^{234}Th + α', reference).verdict).toBe('correct')
    expect(compareEquations('^{238}U -> ^{234}Th + β-', reference).verdict).toBe('species')
  })

  it('ordinary chemistry is unchanged', () => {
    const equation = parsed('2H2 + O2 -> 2H2O')
    expect(isNuclear(equation)).toBe(false)
    expect(imbalances(equation)).toEqual([])
    expect(imbalances(parsed('Fe^3+ + e- -> Fe^2+'))).toEqual([])
    expect(imbalances(parsed('Zn + Cu^2+ -> Zn^2+ + Cu'))).toEqual([])
  })
})

describe('nomenclature', () => {
  it('compares formulas by composition and charge', () => {
    expect(compareFormula('Fe2(SO4)3', 'Fe2(SO4)3')).toBe('correct')
    expect(compareFormula('\\ce{CuSO4·5H2O}', 'CuSO4(H2O)5')).toBe('correct')
    expect(compareFormula('CuSO4*5H2O'.replace('*', '·'), 'CuSO4·5H2O')).toBe('correct')
    expect(compareFormula('FeO', 'Fe2O3')).toBe('composition')
    expect(compareFormula('SO4^-', 'SO4^2-')).toBe('charge')
    expect(compareFormula('NH4+', 'NH4^+')).toBe('correct')
    expect(compareFormula('???', 'NaCl')).toBe('unreadable')
  })

  it('reads nuclide answers, including the caret-free form', () => {
    expect(compareFormula('⁵⁴Cr⁶⁺', '^{54}Cr^{6+}')).toBe('correct')
    expect(compareFormula('54Cr6+', '^{54}Cr^{6+}')).toBe('correct')
    expect(compareFormula('^{52}Cr^{6+}', '^{54}Cr^{6+}')).toBe('mass-number')
    expect(compareFormula('^{54}Cr^{3+}', '^{54}Cr^{6+}')).toBe('charge')
  })

  it('does not decide organic isomers', () => {
    expect(compareFormula('CH3OCH3', 'CH3CH2OH')).toBe('isomers')
    expect(compareFormula('C2H5OH', 'CH3CH2OH')).toBe('correct')
  })

  it('normalises names', () => {
    expect(normalizeChemicalName('Iron (III) Sulphate')).toBe(
      normalizeChemicalName('iron(III) sulfate'),
    )
    expect(nameAccepted('ferric sulfate', ['iron(III) sulfate', 'ferric sulfate'])).toBe(true)
    expect(nameAccepted('aluminium chloride', ['aluminum chloride'])).toBe(true)
    expect(nameAccepted('iron(II) sulfate', ['iron(III) sulfate'])).toBe(false)
  })
})

describe('nomenclature questions', () => {
  beforeEach(() => setUILanguage('zh-CN'))
  const base: Question = {
    id: 'n1',
    projectId: 'p',
    knowledgePoint: 'naming',
    type: 'nomenclature',
    difficulty: 'basic',
    prompt: 'Write the formula of iron(III) sulfate.',
    correctAnswer: 'Fe2(SO4)3',
    nomenclature: {
      direction: 'name_to_formula',
      formula: 'Fe2(SO4)3',
      names: ['iron(III) sulfate', 'ferric sulfate'],
    },
    hints: [],
    sourceRefs: [],
    promptVersion: 'v9',
    createdAt: 0,
  }

  it('name → formula', () => {
    expect(evaluateDeterministic(base, 'Fe2(SO4)3').isCorrect).toBe(true)
    const wrong = evaluateDeterministic(base, 'FeSO4')
    expect(wrong.isCorrect).toBe(false)
    expect(wrong.note).toContain('原子种类或个数')
  })

  it('formula → name leaves an unmatched name to the equivalence check', () => {
    const question: Question = {
      ...base,
      prompt: 'Name $\\ce{Fe2(SO4)3}$.',
      correctAnswer: 'iron(III) sulfate',
      nomenclature: { ...base.nomenclature!, direction: 'formula_to_name' },
    }
    expect(evaluateDeterministic(question, 'Iron(III) sulphate').isCorrect).toBe(true)
    const other = evaluateDeterministic(question, 'iron trisulfate')
    expect(other.isCorrect).toBe(false)
    expect(other.blanks).toHaveLength(1)
    expect(other.blanks![0]!.accepted).toEqual(['iron(III) sulfate', 'ferric sulfate'])
  })
})
