/**
 * v11 visualization-generator prompt.
 *
 * Adds the economics market diagram `market_2d` (linear supply and demand:
 * shifts, per-unit taxes and subsidies, price ceilings and floors, quotas,
 * world prices with tariffs or import quotas, elasticity comparisons in two
 * panels). The model supplies only the lesson's curves, scenario and labels;
 * equilibria, prices, surplus areas, deadweight loss, incidence and
 * elasticities are computed exactly by `entities/econ/market.ts`.
 *
 * The market rules are only sent to economics courses and to courses with no
 * specific subject ("other" / none). For every other subject the system
 * prompt is byte-for-byte the v10 prompt (tested), so their requests do not
 * change. v10 is kept unchanged.
 */
import type { Subject } from '@/entities/project/types'
import * as V10 from './v10'

export const VERSION = 'v11' as const
export const PROMPT_KIND = 'visualization-generator' as const

export type { VisualizationInput, VisualizationOutput, VisualizationPromptOptions } from './v10'

/**
 * Figure families per subject. The `market` flag (economics, "other" and
 * unset subjects) lives on v10's table; v10's own prompt text never reads it.
 */
export type { FigureFamilies } from './v10'
export const scienceFiguresFor: (subject: Subject | undefined) => V10.FigureFamilies =
  V10.scienceFiguresFor

export const MARKET_RULES = [
  'MARKET FIGURES (economics):',
  '  - `market_2d`: a linear supply-and-demand diagram the lesson works through. Price P is on the vertical axis and quantity Q on the horizontal axis.',
  '      Provide `demand` and `supply`, each ONE of: { "form": "price", "intercept": a, "slope": b } for P = a + bQ; { "form": "quantity", "intercept": c, "slope": d } for Q = c + dP;',
  '      { "form": "points", "points": [{ "q": <number>, "p": <number> }, { "q": <number>, "p": <number> }] } (two points the lesson gives); { "form": "vertical", "quantity": q } (perfectly inelastic); { "form": "horizontal", "price": p } (perfectly elastic).',
  '      Demand slopes down and supply slopes up. Copy the numbers exactly as the lesson writes them; never convert them yourself.',
  '      `scenario` is exactly one of:',
  '        { "kind": "equilibrium" };',
  '        { "kind": "shift", "demand"?: <shift>, "supply"?: <shift> }, where <shift> is { "to": <curve> } (the new curve the lesson states), { "dq": <horizontal shift, + = right> }, { "dp": <vertical shift, + = up> } or { "slope": <new b in P = a + bQ>, "pivot": "intercept" | "equilibrium" };',
  '        { "kind": "tax", "amount": <per unit>, "on": "buyers" | "sellers" }; { "kind": "subsidy", "amount": <per unit>, "on": "buyers" | "sellers" };',
  '        { "kind": "ceiling", "price": <number> }; { "kind": "floor", "price": <number> }; { "kind": "quota", "quantity": <limit on the quantity sold, e.g. supply management> };',
  '        { "kind": "trade", "worldPrice": <number>, "tariff"?: <per unit>, "importQuota"?: <quantity> } for a small open economy (a tariff or an import quota only when the country imports).',
  '      Optional: `labels`: { "demand"?: "D", "supply"?: "S", "newDemand"?: "D₂", "newSupply"?: "S₂" }, `priceUnit` (e.g. "$"), `quantityUnit` (e.g. "kg"), and `quantityScale`: "units" | "thousands" | "millions" when the lesson counts quantities in thousands or millions.',
  '      To compare two markets side by side (e.g. the same tax with elastic and with inelastic demand) provide `panels`: 2 items { "title", "demand", "supply", "scenario" } instead of the top-level demand / supply / scenario.',
  '      NEVER provide equilibria, new prices or quantities, surplus, revenue, deadweight loss, shortages, incidence or elasticities — the app computes every one of them exactly, and drops a figure whose curves do not meet at a positive price and quantity.',
  '      Example: { "type": "market_2d", "demand": { "form": "price", "intercept": 180, "slope": -2 }, "supply": { "form": "price", "intercept": 60, "slope": 2 }, "scenario": { "kind": "tax", "amount": 40, "on": "sellers" }, "priceUnit": "$" }',
]

const PLACEMENT_HEADING = '\nplacement (optional):\n'
const TYPE_LINE = /("type": "function_2d \| [^"]*)"/

export function buildSystemPrompt(options: V10.VisualizationPromptOptions = {}): string {
  const base = V10.buildSystemPrompt(options)
  if (!scienceFiguresFor(options.subject).market) return base
  if (!base.includes(PLACEMENT_HEADING) || !TYPE_LINE.test(base)) {
    throw new Error('visualization-generator v11: v10 prompt layout changed')
  }
  return base
    .replace(PLACEMENT_HEADING, `\n${MARKET_RULES.join('\n')}\n${PLACEMENT_HEADING}`)
    .replace(TYPE_LINE, '$1 | market_2d"')
}

export const buildUserPrompt = V10.buildUserPrompt
