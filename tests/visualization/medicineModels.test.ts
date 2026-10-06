import { describe, expect, it } from 'vitest'
import {
  analyzeAcidBase,
  cardiacFacts,
  chartRows,
  clearance,
  concentrationAtTime,
  energyYield,
  goldman,
  hendersonPH,
  isoelectricPoint,
  lungCapacities,
  nernst,
  netCharge,
  netFiltrationPressure,
  oxygenContent,
  palmerOf,
  pkFacts,
  saturation,
  toothName,
  universalOf,
} from '@/entities/tutorVisualization/medicine'

const near = (a: number, b: number, eps = 0.05) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('membrane potentials', () => {
  it('matches textbook equilibrium potentials', () => {
    near(nernst('K+', 140, 4), -95, 1)
    near(nernst('Na+', 12, 145), 66.6, 1)
    near(nernst('Cl-', 4, 110), -88.6, 1.5)
    near(nernst('Ca2+', 0.0001, 2), 132, 2)
  })

  it('gives a resting potential near −70 mV with GHK', () => {
    const vm = goldman([
      { ion: 'K+', inside: 140, outside: 4, permeability: 1 },
      { ion: 'Na+', inside: 12, outside: 145, permeability: 0.04 },
      { ion: 'Cl-', inside: 4, outside: 110, permeability: 0.45 },
    ])!
    expect(vm).toBeGreaterThan(-80)
    expect(vm).toBeLessThan(-60)
  })
})

describe('oxygen and circulation', () => {
  it('follows the Hill curve', () => {
    near(saturation(26.8, 26.8, 2.7), 0.5, 1e-9)
    expect(saturation(100, 26.8, 2.7)).toBeGreaterThan(0.97)
    near(oxygenContent(15, 100, 26.8, 2.7), 20.0, 0.4)
  })

  it('computes stroke volume, EF and cardiac output', () => {
    const facts = cardiacFacts({ edv: 120, esv: 50, edp: 8, aorticOpen: 80, peak: 120, endSystolic: 100, minimum: 4, hr: 70 })
    expect(facts.strokeVolume).toBe(70)
    near(facts.ejectionFraction, 0.5833, 1e-3)
    near(facts.cardiacOutput!, 4.9, 1e-9)
    expect(facts.strokeWork).toBeGreaterThan(4000)
  })

  it('derives lung capacities', () => {
    expect(lungCapacities({ tv: 500, irv: 3000, erv: 1100, rv: 1200 })).toEqual({ ic: 3500, frc: 2300, vc: 4600, tlc: 5800 })
  })

  it('computes net filtration pressure and clearance', () => {
    expect(netFiltrationPressure({ pgc: 55, pbs: 15, pigc: 30, pibs: 0 })).toBe(10)
    expect(clearance(30, 0.25, 1)).toBe(120)
  })
})

describe('acid–base analysis', () => {
  it('agrees with Henderson–Hasselbalch', () => {
    near(hendersonPH(40, 24), 7.4, 0.01)
  })

  it('identifies a compensated metabolic acidosis and an extra disorder', () => {
    const compensated = analyzeAcidBase(7.29, 30, 14)
    expect(compensated.primary).toBe('metabolic_acidosis')
    expect(compensated.compensation[0]).toMatchObject({ variable: 'paco2', low: 27, high: 31 })
    expect(compensated.additionalDisorder).toBeUndefined()
    // PaCO₂ higher than Winter's range: a coexisting respiratory acidosis.
    expect(analyzeAcidBase(7.2, 40, 15).additionalDisorder).toBe('too_high')
  })

  it('separates acute and chronic respiratory acidosis', () => {
    const analysis = analyzeAcidBase(7.25, 60, 26, 'acute')
    expect(analysis.primary).toBe('respiratory_acidosis')
    expect(analysis.compensation).toHaveLength(1)
    expect(analysis.compensation[0]).toMatchObject({ chronicity: 'acute', low: 24.5, high: 27.5 })
  })
})

describe('biochemistry', () => {
  const glycine = [
    { pka: 2.34, kind: 'acid' as const },
    { pka: 9.6, kind: 'base' as const },
  ]
  const lysine = [
    { pka: 2.18, kind: 'acid' as const },
    { pka: 8.95, kind: 'base' as const },
    { pka: 10.53, kind: 'base' as const },
  ]
  const aspartate = [
    { pka: 1.88, kind: 'acid' as const },
    { pka: 3.65, kind: 'acid' as const },
    { pka: 9.6, kind: 'base' as const },
  ]

  it('finds isoelectric points', () => {
    near(isoelectricPoint(glycine), 5.97, 0.01)
    near(isoelectricPoint(lysine), 9.74, 0.01)
    near(isoelectricPoint(aspartate), 2.77, 0.01)
    near(netCharge(glycine, isoelectricPoint(glycine)), 0, 0.01)
  })

  it('counts ATP from glucose oxidation', () => {
    const glucose = [
      { label: 'hexokinase', atp: -1 },
      { label: 'PFK-1', atp: -1 },
      { label: 'GAPDH', nadh: 1, compartment: 'cytosol' as const, times: 2 },
      { label: 'PGK', atp: 1, times: 2 },
      { label: 'pyruvate kinase', atp: 1, times: 2 },
      { label: 'PDH', nadh: 1, co2: 1, times: 2 },
      { label: 'TCA', nadh: 3, fadh2: 1, gtp: 1, co2: 2, times: 2 },
    ]
    const modern = energyYield(glucose, 'modern', 'malate_aspartate')
    expect(modern.substrateLevel).toBe(4)
    expect(modern.co2).toBe(6)
    expect(modern.total).toBe(32)
    expect(energyYield(glucose, 'modern', 'glycerol_phosphate').total).toBe(30)
    expect(energyYield(glucose, 'classic', 'malate_aspartate').total).toBe(38)
  })
})

describe('pharmacokinetics', () => {
  const iv = { route: 'iv_bolus' as const, dose: 100, vd: 50, halfLife: 4 }

  it('decays by half each half-life', () => {
    near(concentrationAtTime(iv, 0), 2, 1e-9)
    near(concentrationAtTime(iv, 4), 1, 1e-9)
    const facts = pkFacts(iv)
    near(facts.clearance, (Math.LN2 / 4) * 50, 1e-9)
    near(facts.auc, 100 / facts.clearance, 1e-9)
  })

  it('accumulates to the steady state with repeated doses', () => {
    const regimen = { ...iv, interval: 4, doses: 12 }
    const facts = pkFacts(regimen)
    near(facts.accumulation!, 2, 1e-9)
    near(facts.peakSteadyState!, 4, 1e-9)
    near(facts.troughSteadyState!, 2, 1e-9)
    near(concentrationAtTime(regimen, 11 * 4), 4, 0.01)
  })

  it('peaks after absorption for an oral dose', () => {
    const oral = { route: 'oral' as const, dose: 100, vd: 50, halfLife: 4, bioavailability: 0.8, ka: 1.5 }
    expect(concentrationAtTime(oral, 0)).toBe(0)
    expect(concentrationAtTime(oral, 1.5)).toBeGreaterThan(concentrationAtTime(oral, 12))
  })
})

describe('dental notation', () => {
  it('converts FDI to Universal and Palmer', () => {
    expect(universalOf(18)).toBe('1')
    expect(universalOf(11)).toBe('8')
    expect(universalOf(21)).toBe('9')
    expect(universalOf(38)).toBe('17')
    expect(universalOf(48)).toBe('32')
    expect(universalOf(55)).toBe('A')
    expect(universalOf(65)).toBe('J')
    expect(universalOf(75)).toBe('K')
    expect(universalOf(85)).toBe('T')
    expect(palmerOf(16)).toBe('6┘')
    expect(palmerOf(21)).toBe('└1')
    expect(palmerOf(54)).toBe('D┘')
    expect(universalOf(19)).toBeNull()
  })

  it('names teeth and lays out the chart', () => {
    expect(toothName(36, 'zh')).toBe('左下第一磨牙')
    expect(toothName(53, 'en')).toBe('upper right primary canine')
    expect(chartRows('permanent').upper.slice(0, 2)).toEqual([18, 17])
    expect(chartRows('primary').lower.at(-1)).toBe(75)
  })
})
