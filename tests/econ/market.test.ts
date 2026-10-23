import { describe, expect, it } from 'vitest'
import {
  BOTH_SHIFT_CASES,
  areaInBaseUnits,
  exactText,
  formatMarketNumber,
  midpointElasticity,
  pointElasticity,
  resolveCurve,
  scaleScenario,
  solveMarket,
  toRational,
  type MarketScenario,
  type MarketSolution,
  type MarketSpec,
} from '@/entities/econ/market'

// D: P = 180 − 2Q, S: P = 60 + 2Q → Q* = 30, P* = 120, total surplus 1800.
const D = { form: 'price', intercept: 180, slope: -2 } as const
const S = { form: 'price', intercept: 60, slope: 2 } as const

function solve(
  scenario: MarketScenario,
  demand: MarketSpec['demand'] = D,
  supply: MarketSpec['supply'] = S,
): MarketSolution {
  const result = solveMarket({ demand, supply, scenario })
  if (!result.ok) throw new Error(result.reason)
  return result.solution
}

function reason(spec: MarketSpec): string | null {
  const result = solveMarket(spec)
  return result.ok ? null : result.reason
}

const area = (solution: MarketSolution, id: string) =>
  solution.areas.find((a) => a.id === id)?.area.value

describe('market equilibrium', () => {
  it('solves the course example exactly', () => {
    const s = solve({ kind: 'equilibrium' })
    expect(s.original.q.value).toBe(30)
    expect(s.original.p.value).toBe(120)
    expect(s.before.cs?.value).toBe(900)
    expect(s.before.ps.value).toBe(900)
    expect(s.before.total?.value).toBe(1800)
    expect(s.totalRevenue.before.value).toBe(3600)
    expect(area(s, 'cs-before')).toBe(900)
  })

  it('reads the quantity form, two points, and keeps fractions exact', () => {
    // Qd = 90 − 0.5P is the same demand curve; S through (0, 60) and (30, 120).
    const s = solve(
      { kind: 'equilibrium' },
      { form: 'quantity', intercept: 90, slope: -0.5 },
      {
        form: 'points',
        points: [
          { q: 0, p: 60 },
          { q: 30, p: 120 },
        ],
      },
    )
    expect(s.original.q.value).toBe(30)
    expect(s.original.p.value).toBe(120)
    const odd = solve(
      { kind: 'equilibrium' },
      { form: 'price', intercept: 10, slope: -1 },
      { form: 'price', intercept: 0, slope: 2 },
    )
    expect(exactText(odd.original.q)).toBe('10/3')
    expect(exactText(odd.original.p)).toBe('20/3')
    expect(formatMarketNumber(odd.original.q)).toBe('≈ 3.33')
    expect(formatMarketNumber(odd.before.total!)).toBe('≈ 16.67')
  })

  it('handles a negative supply intercept: producer surplus starts on the quantity axis', () => {
    // S: P = −20 + 2Q crosses the Q axis at 10; D: P = 100 − 2Q → Q* = 30, P* = 40.
    const s = solve(
      { kind: 'equilibrium' },
      { form: 'price', intercept: 100, slope: -2 },
      { form: 'price', intercept: -20, slope: 2 },
    )
    // PS = trapezoid (0..10 at height 40) + triangle (10..30, 40 → 0): 400 + 400.
    expect(s.before.ps.value).toBe(800)
  })

  it('rejects specs that would draw something wrong', () => {
    expect(
      reason({
        demand: { form: 'price', intercept: 10, slope: 2 },
        supply: S,
        scenario: { kind: 'equilibrium' },
      }),
    ).toBe('demand-slopes-up')
    expect(
      reason({
        demand: D,
        supply: { form: 'price', intercept: 60, slope: -1 },
        scenario: { kind: 'equilibrium' },
      }),
    ).toBe('supply-slopes-down')
    // Curves meet at a negative quantity.
    expect(
      reason({
        demand: { form: 'price', intercept: 50, slope: -1 },
        supply: { form: 'price', intercept: 60, slope: 1 },
        scenario: { kind: 'equilibrium' },
      }),
    ).toBe('equilibrium-not-positive')
    expect(
      reason({
        demand: { form: 'price', intercept: 50, slope: -1 },
        supply: { form: 'price', intercept: 20, slope: -1 },
        scenario: { kind: 'equilibrium' },
      }),
    ).toBe('supply-slopes-down')
    expect(
      reason({ demand: D, supply: S, scenario: { kind: 'tax', amount: 120, on: 'sellers' } }),
    ).toBe('market-shut-down')
    expect(reason({ demand: D, supply: S, scenario: { kind: 'ceiling', price: -4 } })).toBe(
      'negative-price',
    )
    expect(
      reason({ demand: D, supply: S, scenario: { kind: 'trade', worldPrice: 140, tariff: 5 } }),
    ).toBe('tariff-needs-imports')
    expect(
      reason({
        demand: { form: 'price', intercept: Number.NaN, slope: -1 },
        supply: S,
        scenario: { kind: 'equilibrium' },
      }),
    ).toBe('invalid-number')
    expect(reason({ demand: D, supply: S, scenario: { kind: 'shift', demand: { dq: -70 } } })).toBe(
      'new-equilibrium-not-positive',
    )
  })
})

describe('taxes and subsidies', () => {
  it('splits a $40 tax: buyers 20, sellers 20, revenue 800, DWL 200', () => {
    const s = solve({ kind: 'tax', amount: 40, on: 'sellers' })
    expect(s.outcome.q.value).toBe(20)
    expect(s.buyerPrice?.value).toBe(140)
    expect(s.sellerPrice?.value).toBe(100)
    expect(s.postedPrice?.value).toBe(140)
    expect(s.incidence?.buyersPerUnit.value).toBe(20)
    expect(s.incidence?.sellersShare.value).toBe(0.5)
    expect(s.after.government.value).toBe(800)
    expect(s.deadweightLoss?.value).toBe(200)
    expect(area(s, 'revenue')).toBe(800)
    expect(area(s, 'dwl')).toBe(200)
    expect(s.after.cs?.value).toBe(400)
    expect(s.after.ps.value).toBe(400)
    expect(s.change.total?.value).toBe(-200)
    // Drawn as supply shifted up by the tax.
    expect(s.newSupply).toMatchObject({ kind: 'sloped' })
    expect(Number(s.newSupply && s.newSupply.kind === 'sloped' ? s.newSupply.a.n : 0)).toBe(100)
  })

  it('gives the same outcome when buyers are taxed, with the demand curve shifted down', () => {
    const s = solve({ kind: 'tax', amount: 40, on: 'buyers' })
    expect(s.outcome.q.value).toBe(20)
    expect(s.postedPrice?.value).toBe(100)
    expect(s.newDemand).toBeDefined()
    expect(s.newSupply).toBeUndefined()
  })

  it('puts the whole tax on the inelastic side', () => {
    const vertical = solve(
      { kind: 'tax', amount: 10, on: 'buyers' },
      { form: 'price', intercept: 100, slope: -1 },
      { form: 'vertical', quantity: 50 },
    )
    expect(vertical.outcome.q.value).toBe(50)
    expect(vertical.incidence?.sellersShare.value).toBe(1)
    expect(vertical.deadweightLoss?.value).toBe(0)
    const flat = solve(
      { kind: 'tax', amount: 10, on: 'sellers' },
      { form: 'price', intercept: 100, slope: -2 },
      { form: 'horizontal', price: 20 },
    )
    expect(flat.outcome.q.value).toBe(35)
    expect(flat.incidence?.buyersShare.value).toBe(1)
    expect(flat.deadweightLoss?.value).toBe(25)
  })

  it('costs a subsidy and finds the over-production triangle', () => {
    const s = solve({ kind: 'subsidy', amount: 20, on: 'sellers' })
    expect(s.outcome.q.value).toBe(35)
    expect(s.buyerPrice?.value).toBe(110)
    expect(s.sellerPrice?.value).toBe(130)
    expect(s.after.government.value).toBe(-700)
    expect(s.deadweightLoss?.value).toBe(50)
    expect(s.change.total?.value).toBe(-50)
  })
})

describe('price controls and quotas', () => {
  // Qd = 24 − 2P, Qs = 2P → P* = 6, Q* = 12; a $4 ceiling.
  const d = { form: 'quantity', intercept: 24, slope: -2 } as const
  const s = { form: 'quantity', intercept: 0, slope: 2 } as const

  it('analyses a binding $4 ceiling', () => {
    const r = solve({ kind: 'ceiling', price: 4 }, d, s)
    expect(r.binding).toBe(true)
    expect(r.control?.quantityDemanded.value).toBe(16)
    expect(r.control?.quantitySupplied.value).toBe(8)
    expect(r.control?.gap.value).toBe(8)
    expect(r.control?.gapKind).toBe('shortage')
    expect(r.control?.demandPriceAtTraded?.value).toBe(8)
    expect(r.outcome.q.value).toBe(8)
    expect(r.change.cs?.value).toBe(12)
    expect(r.change.ps.value).toBe(-20)
    expect(r.deadweightLoss?.value).toBe(8)
    expect(area(r, 'transfer')).toBe(16)
    // Producer-surplus change panel: unchanged 16, transferred 16, lost 4.
    const ps = r.areas.filter((a) => a.id.startsWith('ps-change'))
    expect(ps.map((a) => [a.effect, a.area.value])).toEqual([
      ['unchanged', 16],
      ['loss', 16],
      ['loss', 4],
    ])
    expect(r.gap).toEqual({ q0: 8, q1: 16, p: 4, kind: 'shortage' })
  })

  it('leaves a non-binding ceiling or floor alone', () => {
    expect(solve({ kind: 'ceiling', price: 7 }, d, s).binding).toBe(false)
    expect(solve({ kind: 'floor', price: 5 }, d, s).binding).toBe(false)
    expect(solve({ kind: 'quota', quantity: 40 }).binding).toBe(false)
  })

  it('analyses a price floor', () => {
    const r = solve({ kind: 'floor', price: 140 })
    expect(r.control?.quantityDemanded.value).toBe(20)
    expect(r.control?.quantitySupplied.value).toBe(40)
    expect(r.control?.gapKind).toBe('surplus')
    expect(r.deadweightLoss?.value).toBe(200)
    expect(r.change.cs?.value).toBe(-500)
    expect(r.change.ps.value).toBe(300)
  })

  it('analyses a quota (supply management) with its rent', () => {
    const r = solve({ kind: 'quota', quantity: 20 })
    expect(r.buyerPrice?.value).toBe(140)
    expect(r.sellerPrice?.value).toBe(100)
    expect(r.after.rent.value).toBe(800)
    expect(r.deadweightLoss?.value).toBe(200)
  })

  it('keeps the whole stock on the market with vertical supply under a ceiling', () => {
    const r = solve(
      { kind: 'ceiling', price: 30 },
      { form: 'price', intercept: 100, slope: -1 },
      { form: 'vertical', quantity: 50 },
    )
    expect(r.outcome.q.value).toBe(50)
    expect(r.control?.gap.value).toBe(20)
    expect(r.deadweightLoss?.value).toBe(0)
  })
})

describe('trade', () => {
  it('measures imports, a tariff and its deadweight triangles', () => {
    const free = solve({ kind: 'trade', worldPrice: 100 })
    expect(free.trade?.role).toBe('importer')
    expect(free.trade?.volume.value).toBe(20)
    expect(free.trade?.gainsFromTrade?.value).toBe(200)
    const tariff = solve({ kind: 'trade', worldPrice: 100, tariff: 10 })
    expect(tariff.trade?.domesticPrice.value).toBe(110)
    expect(tariff.trade?.volume.value).toBe(10)
    expect(tariff.after.government.value).toBe(100)
    expect(tariff.deadweightLoss?.value).toBe(50)
    const quota = solve({ kind: 'trade', worldPrice: 100, importQuota: 10 })
    expect(quota.trade?.domesticPrice.value).toBe(110)
    expect(quota.after.rent.value).toBe(100)
    expect(solve({ kind: 'trade', worldPrice: 100, importQuota: 30 }).binding).toBe(false)
    // A prohibitive tariff returns the market to autarky.
    expect(solve({ kind: 'trade', worldPrice: 100, tariff: 50 }).trade?.volume.value).toBe(0)
  })

  it('measures exports above the domestic price', () => {
    const r = solve({ kind: 'trade', worldPrice: 140 })
    expect(r.trade?.role).toBe('exporter')
    expect(r.trade?.volume.value).toBe(20)
    expect(r.change.ps.value).toBeGreaterThan(0)
    expect(r.gap?.kind).toBe('exports')
  })
})

describe('shifts', () => {
  const d = { form: 'price', intercept: 100, slope: -1 } as const
  const s = { form: 'price', intercept: 20, slope: 1 } as const

  it('computes the new equilibrium and the elasticity along the unshifted curve', () => {
    const r = solve({ kind: 'shift', demand: { dq: 20 } }, d, s)
    expect(r.original.q.value).toBe(40)
    expect(r.outcome.q.value).toBe(50)
    expect(r.outcome.p.value).toBe(70)
    expect(r.deltaP.value).toBe(10)
    expect(r.deltaQ.value).toBe(10)
    expect(r.shift?.demand).toBe('increase')
    expect(r.elasticity.alongUnshifted?.side).toBe('supply')
    // (10 / 45) / (10 / 65) = 13/9
    expect(exactText(r.elasticity.alongUnshifted!.value.exact!)).toBe('13/9')
    // A stated new curve gives the same result.
    const stated = solve(
      { kind: 'shift', demand: { to: { form: 'price', intercept: 120, slope: -1 } } },
      d,
      s,
    )
    expect(stated.outcome.q.value).toBe(50)
  })

  it('covers the four both-curve cases and resolves the ambiguous variable', () => {
    const cases: Array<[MarketScenario, string, string]> = [
      [{ kind: 'shift', demand: { dq: 10 }, supply: { dq: 10 } }, 'price', 'unchanged'],
      [{ kind: 'shift', demand: { dq: -10 }, supply: { dq: -4 } }, 'price', 'decrease'],
      [{ kind: 'shift', demand: { dq: 10 }, supply: { dp: 10 } }, 'quantity', 'unchanged'],
      [{ kind: 'shift', demand: { dq: -4 }, supply: { dq: 10 } }, 'quantity', 'increase'],
    ]
    cases.forEach(([scenario, ambiguous, resolved], i) => {
      const r = solve(scenario, d, s)
      expect(r.shift?.case).toEqual(BOTH_SHIFT_CASES[i])
      expect(r.shift?.ambiguous).toBe(ambiguous)
      expect(r.shift?.resolved).toBe(resolved)
    })
  })

  it('rotates a curve about its intercept or the equilibrium', () => {
    const r = solve({ kind: 'shift', demand: { slope: -2, pivot: 'equilibrium' } }, d, s)
    expect(r.outcome.q.value).toBe(40)
    expect(r.shift?.demand).toBe('rotation')
    expect(
      reason({ demand: d, supply: s, scenario: { kind: 'shift', demand: { slope: 1 } } }),
    ).toBe('demand-slopes-up')
  })
})

describe('elasticity and units', () => {
  it('computes point and midpoint elasticities', () => {
    const curve = resolveCurve(D, 'demand')
    if (!curve.ok) throw new Error()
    const e = pointElasticity(curve.value, { q: toRational(30)!, p: toRational(120)! })
    expect(e?.value).toBe(-2)
    expect(e?.kind).toBe('elastic')
    const unit = midpointElasticity(
      { q: toRational(10)!, p: toRational(30)! },
      { q: toRational(30)!, p: toRational(10)! },
    )
    expect(unit?.value).toBe(-1)
    expect(unit?.kind).toBe('unit')
    const vertical = resolveCurve({ form: 'vertical', quantity: 5 }, 'supply')
    if (!vertical.ok) throw new Error()
    expect(
      pointElasticity(vertical.value, { q: toRational(5)!, p: toRational(3)! }, 'supply')?.kind,
    ).toBe('perfectly_inelastic')
  })

  it('converts areas to base units', () => {
    const s = solve({ kind: 'equilibrium' })
    expect(areaInBaseUnits(s.before.total!, 'thousands').value).toBe(1_800_000)
  })

  it('scales a scenario for animation', () => {
    const half = scaleScenario(
      { demand: D, supply: S, scenario: { kind: 'tax', amount: 40, on: 'sellers' } },
      0.5,
    )
    expect(half.scenario).toEqual({ kind: 'tax', amount: 20, on: 'sellers' })
    expect(
      scaleScenario({ demand: D, supply: S, scenario: { kind: 'ceiling', price: 100 } }, 0)
        .scenario,
    ).toEqual({
      kind: 'equilibrium',
    })
    const ceiling = scaleScenario(
      { demand: D, supply: S, scenario: { kind: 'ceiling', price: 100 } },
      0.5,
    )
    expect(ceiling.scenario).toEqual({ kind: 'ceiling', price: 110 })
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(
        solveMarket(
          scaleScenario(
            { demand: D, supply: S, scenario: { kind: 'trade', worldPrice: 100, importQuota: 10 } },
            t,
          ),
        ).ok,
      ).toBe(true)
    }
  })
})
