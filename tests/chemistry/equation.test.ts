import { describe, expect, it } from 'vitest'
import {
  compareEquations,
  hillFormula,
  imbalances,
  parseEquation,
  parseSpecies,
  type ParsedEquation,
} from '@/infrastructure/chemistry/equation'

const reference = (text: string): ParsedEquation => {
  const parsed = parseEquation(text)
  if (!parsed.ok) throw new Error(`reference did not parse: ${text}`)
  return parsed.equation
}

describe('species', () => {
  it('reads groups, hydrates, charges and states', () => {
    expect(parseSpecies('Ca(OH)2')!.atoms).toEqual({ Ca: 1, O: 2, H: 2 })
    expect(parseSpecies('CuSO4·5H2O')!.atoms).toEqual({ Cu: 1, S: 1, O: 9, H: 10 })
    expect(parseSpecies('K4[Fe(CN)6]')!.atoms).toEqual({ K: 4, Fe: 1, C: 6, N: 6 })
    expect(parseSpecies('SO4^2-')).toMatchObject({ charge: -2, key: 'O4S2-' })
    expect(parseSpecies('Fe^3+(aq)')).toMatchObject({ charge: 3, atoms: { Fe: 1 } })
    expect(parseSpecies('e-')).toMatchObject({ charge: -1, key: 'e-' })
  })

  it('treats digits before a bare sign as a subscript, as mhchem does', () => {
    expect(parseSpecies('NH4+')).toMatchObject({ atoms: { N: 1, H: 4 }, charge: 1 })
    expect(parseSpecies('Fe3+')).toMatchObject({ atoms: { Fe: 3 }, charge: 1 })
  })

  it('accepts Unicode subscripts and superscripts', () => {
    expect(parseSpecies('SO₄²⁻')).toMatchObject({ atoms: { S: 1, O: 4 }, charge: -2 })
    expect(parseSpecies('H₂O')!.atoms).toEqual({ H: 2, O: 1 })
  })

  it('rejects unknown elements and broken brackets', () => {
    expect(parseSpecies('Xx2')).toBeNull()
    expect(parseSpecies('Ca(OH2')).toBeNull()
    expect(parseSpecies('h2o')).toBeNull()
  })

  it('writes formulas in Hill order', () => {
    expect(hillFormula({ O: 1, H: 2, C: 2 })).toBe('C2H2O')
    expect(hillFormula({ Na: 1, Cl: 1 })).toBe('ClNa')
  })
})

describe('equations', () => {
  it('reads coefficients, arrows and conditions', () => {
    const parsed = parseEquation('2H2 + O2 ->[点燃] 2H2O')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.equation.reactants.map((t) => t.coefficient.n)).toEqual([2, 1])
      expect(imbalances(parsed.equation)).toEqual([])
    }
    expect(parseEquation('N2 + 3H2 <=> 2NH3').ok).toBe(true)
    expect(parseEquation('N₂ + 3H₂ ⇌ 2NH₃').ok).toBe(true)
    expect(parseEquation('1/2 O2 + H2 → H2O').ok).toBe(true)
    expect(parseEquation('2H2 + O2')).toMatchObject({ ok: false, reason: 'no-arrow' })
  })

  it('separates ions from the + between terms', () => {
    const parsed = parseEquation('Fe^3+ + e- -> Fe^2+')
    expect(parsed.ok && parsed.equation.reactants.map((t) => t.species.key)).toEqual(['Fe3+', 'e-'])
    const ions = parseEquation('Ag^+ + Cl^- -> AgCl(s)')
    expect(ions.ok && imbalances(ions.equation)).toEqual([])
  })

  it('reports each element and the charge that do not balance', () => {
    const parsed = parseEquation('H2 + O2 -> H2O')
    expect(parsed.ok && imbalances(parsed.equation)).toEqual([{ what: 'O', left: 2, right: 1 }])
    const charge = parseEquation('Fe^3+ -> Fe^2+')
    expect(charge.ok && imbalances(charge.equation)).toEqual([{ what: 'charge', left: 3, right: 2 }])
  })
})

describe('compareEquations', () => {
  const water = reference('2H2 + O2 -> 2H2O')

  it('accepts any order, states and a common multiple', () => {
    expect(compareEquations('O2 + 2H2 -> 2H2O', water)).toEqual({ verdict: 'correct' })
    expect(compareEquations('2H2(g) + O2(g) → 2H2O(l)', water)).toEqual({ verdict: 'correct' })
    expect(compareEquations('4H2 + 2O2 -> 4H2O', water)).toEqual({ verdict: 'correct' })
    expect(compareEquations('H2 + 1/2O2 -> H2O', water)).toEqual({ verdict: 'correct' })
  })

  it('explains what is wrong', () => {
    expect(compareEquations('H2 + O2 -> H2O', water)).toEqual({
      verdict: 'unbalanced',
      imbalances: [{ what: 'O', left: 2, right: 1 }],
    })
    expect(compareEquations('2H2 + O2 -> 2H2O2', water)).toEqual({
      verdict: 'species',
      missing: ['H2O'],
      extra: ['H2O2'],
    })
    expect(compareEquations('2H2 + O2 = 2H2O)', water)).toMatchObject({ verdict: 'unreadable' })
  })

  it('does not accept swapped sides', () => {
    expect(compareEquations('2H2O -> 2H2 + O2', water)).toMatchObject({ verdict: 'species' })
  })
})
