/**
 * Reading untrusted JSON (a model reply, an imported question) into a
 * `MarketSpec`. Only the structure is checked here; `solveMarket` then
 * decides whether the market makes sense (positive equilibrium, slopes, …).
 * Every function returns null rather than guessing.
 */
import type { CurveShift, CurveSpec, MarketScenario, MarketSpec, QuantityScale } from './market'
import { MARKET_MAX_MAGNITUDE, QUANTITY_SCALES } from './market'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** A finite number within the market magnitude limit (numeric strings accepted). */
export function readMarketNumber(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.replace(/[−–]/g, '-').replace(/[,$\s]/g, ''))
        : NaN
  return Number.isFinite(n) && Math.abs(n) <= MARKET_MAX_MAGNITUDE ? n : null
}

function readPoint(value: unknown): { q: number; p: number } | null {
  if (Array.isArray(value) && value.length === 2) {
    const q = readMarketNumber(value[0])
    const p = readMarketNumber(value[1])
    return q !== null && p !== null ? { q, p } : null
  }
  const item = record(value)
  const q = readMarketNumber(item?.q ?? item?.quantity)
  const p = readMarketNumber(item?.p ?? item?.price)
  return q !== null && p !== null ? { q, p } : null
}

/** Read one curve: price form, quantity form, two points, vertical or horizontal. */
export function parseCurveSpec(value: unknown): CurveSpec | null {
  const item = record(value)
  if (!item) return null
  const form = typeof item.form === 'string' ? item.form : undefined
  if (form === 'points' || (form === undefined && Array.isArray(item.points))) {
    const points = Array.isArray(item.points) ? item.points.map(readPoint) : []
    if (points.length !== 2 || !points[0] || !points[1]) return null
    return { form: 'points', points: [points[0], points[1]] }
  }
  if (form === 'vertical' || (form === undefined && 'vertical' in item)) {
    const quantity = readMarketNumber(item.quantity ?? item.vertical)
    return quantity !== null ? { form: 'vertical', quantity } : null
  }
  if (form === 'horizontal' || (form === undefined && 'horizontal' in item)) {
    const price = readMarketNumber(item.price ?? item.horizontal)
    return price !== null ? { form: 'horizontal', price } : null
  }
  if (form === 'price' || form === 'quantity' || form === undefined) {
    const intercept = readMarketNumber(item.intercept)
    const slope = readMarketNumber(item.slope)
    if (intercept === null || slope === null) return null
    return { form: form ?? 'price', intercept, slope }
  }
  return null
}

function parseShift(value: unknown): CurveShift | null {
  const item = record(value)
  if (!item) return null
  const shift: CurveShift = {}
  if (item.to !== undefined) {
    const to = parseCurveSpec(item.to)
    if (!to) return null
    return { to }
  }
  for (const key of ['dq', 'dp', 'slope'] as const) {
    if (item[key] === undefined) continue
    const n = readMarketNumber(item[key])
    if (n === null) return null
    shift[key] = n
  }
  if (item.pivot === 'intercept' || item.pivot === 'equilibrium') shift.pivot = item.pivot
  return shift.dq !== undefined || shift.dp !== undefined || shift.slope !== undefined
    ? shift
    : null
}

const side = (value: unknown): 'buyers' | 'sellers' | null =>
  value === 'buyers' || value === 'consumers'
    ? 'buyers'
    : value === 'sellers' || value === 'producers'
      ? 'sellers'
      : null

/** Read a scenario; unknown kinds or missing values → null. */
export function parseScenario(value: unknown): MarketScenario | null {
  const item = record(value)
  const kind = typeof item?.kind === 'string' ? item.kind : undefined
  if (!item || !kind) return null
  switch (kind) {
    case 'equilibrium':
      return { kind }
    case 'shift': {
      const demand = item.demand !== undefined ? parseShift(item.demand) : undefined
      const supply = item.supply !== undefined ? parseShift(item.supply) : undefined
      if (demand === null || supply === null || (!demand && !supply)) return null
      return { kind, ...(demand ? { demand } : {}), ...(supply ? { supply } : {}) }
    }
    case 'tax':
    case 'subsidy': {
      const amount = readMarketNumber(item.amount)
      const on = side(item.on) ?? 'sellers'
      return amount !== null && amount > 0 ? { kind, amount, on } : null
    }
    case 'ceiling':
    case 'floor': {
      const price = readMarketNumber(item.price)
      return price !== null ? { kind, price } : null
    }
    case 'quota': {
      const quantity = readMarketNumber(item.quantity)
      return quantity !== null && quantity > 0 ? { kind, quantity } : null
    }
    case 'trade': {
      const worldPrice = readMarketNumber(item.worldPrice)
      if (worldPrice === null) return null
      const tariff = item.tariff !== undefined ? readMarketNumber(item.tariff) : undefined
      const importQuota =
        item.importQuota !== undefined ? readMarketNumber(item.importQuota) : undefined
      if (tariff === null || importQuota === null) return null
      return {
        kind,
        worldPrice,
        ...(tariff !== undefined ? { tariff } : {}),
        ...(importQuota !== undefined ? { importQuota } : {}),
      }
    }
    default:
      return null
  }
}

/** Read `{ demand, supply, scenario }` (scenario defaults to the plain equilibrium). */
export function parseMarketSpec(value: unknown): MarketSpec | null {
  const item = record(value)
  if (!item) return null
  const demand = parseCurveSpec(item.demand)
  const supply = parseCurveSpec(item.supply)
  const scenario =
    item.scenario === undefined ? { kind: 'equilibrium' as const } : parseScenario(item.scenario)
  return demand && supply && scenario ? { demand, supply, scenario } : null
}

export function parseQuantityScale(value: unknown): QuantityScale | undefined {
  return QUANTITY_SCALES.includes(value as QuantityScale) ? (value as QuantityScale) : undefined
}
