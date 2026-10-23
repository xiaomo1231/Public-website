/**
 * practice-generate v4: economics graph questions.
 *  - `buildSystemPrompt({ economics: true })` (economics courses): a part may
 *    carry a `{"type":"market", …}` check — a supply-and-demand diagram the
 *    app draws and solves itself (`shift_id` / `area_read` /
 *    `draw_diagram`). The stated answer is recomputed from the market and
 *    replaced by the app's when it disagrees.
 * Without the option the prompts are v3's word for word. v3 is kept unchanged.
 */
import * as V3 from './v3'

export * from './v3'
export const VERSION = 'v4' as const

/** The `market` check, shared with mock-paper v3 (one line of the check list). */
export const MARKET_CHECK_LINE =
  '  {"type":"market","kind":"area_read","market":{"demand":{"form":"price","intercept":120,"slope":-2},"supply":{"form":"price","intercept":20,"slope":2},"scenario":{"kind":"tax","amount":10,"on":"sellers"}},"target":"dwl"} for an economics supply-and-demand diagram question. The app draws the diagram from "market" (P = intercept + slope·Q; demand slope < 0, supply slope > 0; scenario one of {"kind":"equilibrium"}, {"kind":"shift","demand":{"dq":n},"supply":{"dq":n}} (+ = right, only the curves that move), {"kind":"tax"|"subsidy","amount":n,"on":"buyers"|"sellers"}, {"kind":"ceiling"|"floor","price":n}, {"kind":"quota","quantity":n}, {"kind":"trade","worldPrice":n,"tariff":n}) and computes the answer itself. "kind": "shift_id" (which curves shift which way, effect on P* and Q*), "area_read" (one value: "target" one of eq_price, eq_quantity, new_price, new_quantity, buyer_price, seller_price, cs_after, ps_after, dwl, tax_revenue, subsidy_cost, buyer_burden, seller_burden, shortage, excess_supply, imports, quota_rent, elasticity_demand, elasticity_midpoint, tr_change) or "draw_diagram" (the student shows the change on the diagram; "draw": {"items": from "curve", "direction", "amount", "policy", "equilibrium", "region"; "region": "cs"|"ps"|"dwl"|"revenue"|"cost"|"rent"|"tariff"|"transfer"}). Small round numbers; the curves cross at a positive price and quantity; any curve equation in the prompt must be the market\'s;'

/** Insert the market check before the check list's closing "null otherwise" line. */
export function withMarketCheck(prompt: string): string {
  const lines = prompt.split('\n')
  const at = lines.findIndex((line) => line.startsWith('  null otherwise'))
  if (at < 0) return prompt
  lines.splice(at, 0, MARKET_CHECK_LINE)
  return lines.join('\n')
}

export function buildSystemPrompt(
  options: { sigFigs?: boolean; economics?: boolean } = {},
): string {
  const { economics, ...rest } = options
  const base = V3.buildSystemPrompt(rest)
  return economics ? withMarketCheck(base) : base
}
