/**
 * Normalizer for the economics market diagram (`market_2d`, schema v11).
 *
 * The draft is untrusted: the curves and scenario are read structurally
 * (`entities/econ/marketSpec.ts`) and then solved exactly
 * (`entities/econ/market.ts`). A market whose curves do not meet at a
 * positive price and quantity, or whose scenario cannot be computed, is
 * rejected — the figure is dropped rather than drawn wrongly.
 */
import { solveMarket } from '@/entities/econ/market'
import { parseMarketSpec, parseQuantityScale } from '@/entities/econ/marketSpec'
import type {
  MarketCurveLabels,
  MarketPanel,
  MarketVisualization,
  TutorVisualization,
  VisualizationDraft,
  VisualizationPlacement,
} from './types'
import { VISUALIZATION_LIMITS } from './limits'
import { asRecord, sanitizeText } from './sanitize'

type Normalized = { ok: true; value: TutorVisualization } | { ok: false; reason: string }

interface CommonBase {
  id: string
  schemaVersion: number
  placement: VisualizationPlacement
  caption?: string
}

const MAX_LABEL = VISUALIZATION_LIMITS.maxLabelLength
/** Short curve names: "D", "S₂", "MSC", "D (2024)". */
const MAX_CURVE_LABEL = 16

function readLabels(raw: unknown): MarketCurveLabels | undefined {
  const item = asRecord(raw)
  if (!item) return undefined
  const labels: MarketCurveLabels = {}
  for (const key of ['demand', 'supply', 'newDemand', 'newSupply'] as const) {
    const text = sanitizeText(item[key], MAX_CURVE_LABEL)
    if (text) labels[key] = text
  }
  return Object.keys(labels).length > 0 ? labels : undefined
}

function readPanel(raw: unknown, fallbackLabels?: MarketCurveLabels): MarketPanel | string {
  const item = asRecord(raw)
  if (!item) return 'invalid-market'
  const spec = parseMarketSpec(item)
  if (!spec) return 'invalid-market'
  const solved = solveMarket(spec)
  if (!solved.ok) return `market-${solved.reason}`
  const title = sanitizeText(item.title, MAX_LABEL)
  const labels = readLabels(item.labels) ?? fallbackLabels
  return { spec, ...(title ? { title } : {}), ...(labels ? { labels } : {}) }
}

function normalizeMarket(draft: VisualizationDraft, base: CommonBase): Normalized {
  const labels = readLabels(draft.labels)
  const rawPanels = Array.isArray(draft.panels) ? draft.panels.slice(0, 2) : [draft]
  const panels: MarketPanel[] = []
  for (const raw of rawPanels) {
    const panel = readPanel(raw, labels)
    if (typeof panel === 'string') return { ok: false, reason: panel }
    panels.push(panel)
  }
  if (panels.length === 0) return { ok: false, reason: 'invalid-market' }
  const priceUnit = sanitizeText(draft.priceUnit, 12)
  const quantityUnit = sanitizeText(draft.quantityUnit, 24)
  const quantityScale = parseQuantityScale(draft.quantityScale)
  const value: MarketVisualization = {
    ...base,
    type: 'market_2d',
    panels,
    ...(priceUnit ? { priceUnit } : {}),
    ...(quantityUnit ? { quantityUnit } : {}),
    ...(quantityScale && quantityScale !== 'units' ? { quantityScale } : {}),
  }
  return { ok: true, value }
}

export const MARKET_NORMALIZERS: Record<
  string,
  (draft: VisualizationDraft, base: CommonBase) => Normalized
> = {
  market_2d: normalizeMarket,
}
