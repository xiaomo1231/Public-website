/**
 * v10 quiz-generator prompt: economics graph questions.
 *  - New types (economics courses only, `questionTypesForSubject`):
 *    `shift_id` (which curves shift, which way, effect on P* and Q*),
 *    `area_read` (one value read from the diagram: P*, Q*, CS, PS, DWL, tax
 *    revenue, burdens, shortage, elasticity …) and `draw_diagram` (show the
 *    change on the diagram). Each carries a `market` (curves + scenario) the
 *    app solves exactly; every answer is recomputed from it, so the model's
 *    numbers are never used.
 *  - Described only when the quiz plans them (`types`), like v9's types.
 * Without any graph type the system and user prompts are v9's word for word
 * (non-economics courses never plan them). v9 is kept unchanged.
 */

import * as V9 from './v9'

export const VERSION = 'v10' as const
export const PROMPT_KIND = 'quiz-generator' as const

export type GraphQuestionType = 'shift_id' | 'area_read' | 'draw_diagram'

export const GRAPH_TYPES: readonly GraphQuestionType[] = ['shift_id', 'area_read', 'draw_diagram']

export type QuizQuestionType = V9.QuizQuestionType | GraphQuestionType

export type ProfessorConvention = V9.ProfessorConvention

export interface QuizGenerationInput extends Omit<V9.QuizGenerationInput, 'plan'> {
  plan: Array<{
    difficulty: V9.QuizGenerationInput['plan'][number]['difficulty']
    type: QuizQuestionType
  }>
}

export interface GeneratedQuizQuestion extends Omit<V9.GeneratedQuizQuestion, 'type'> {
  type: QuizQuestionType
  /** Graph types only: `{ demand, supply, scenario }` (checked and solved by the app). */
  market?: unknown
  /** area_read only: the value asked for. */
  target?: string | null
  /** draw_diagram only: `{ items, region }`. */
  draw?: unknown
}

export interface QuizGenerationOutput {
  questions: GeneratedQuizQuestion[]
}

export interface QuizSystemPromptOptions extends Omit<V9.QuizSystemPromptOptions, 'types'> {
  types?: readonly QuizQuestionType[]
}

export const GRAPH_TARGETS = [
  'eq_price',
  'eq_quantity',
  'new_price',
  'new_quantity',
  'buyer_price',
  'seller_price',
  'cs_before',
  'ps_before',
  'cs_after',
  'ps_after',
  'dwl',
  'tax_revenue',
  'subsidy_cost',
  'tariff_revenue',
  'quota_rent',
  'buyer_burden',
  'seller_burden',
  'shortage',
  'excess_supply',
  'imports',
  'elasticity_demand',
  'elasticity_midpoint',
  'tr_change',
] as const

export const MARKET_RULE =
  '  G1. Economics graph questions (`shift_id`, `area_read`, `draw_diagram`) are drawn and graded by the app from `market`: {"demand": curve, "supply": curve, "scenario": scenario}. A curve is {"form":"price","intercept":a,"slope":b} meaning P = a + b·Q (demand slope < 0, supply slope > 0). The scenario is one of {"kind":"equilibrium"}; {"kind":"shift","demand":{"dq":n},"supply":{"dq":n}} (horizontal shift at every price, + = right; list only the curves that move); {"kind":"tax" or "subsidy","amount":n,"on":"buyers" or "sellers"}; {"kind":"ceiling" or "floor","price":n}; {"kind":"quota","quantity":n}; {"kind":"trade","worldPrice":n,"tariff":n (optional)}. Use small round numbers; the curves must cross at a positive price and quantity, and a control or tax must bind. The app computes every answer from `market` (your `correctAnswer` is checked against it); write no number in the prompt that is not the market\'s.'

const SHIFT_RULE =
  '  G2. For `shift_id`: describe one or two real-world events (never say which curve moves or which way) and ask which curve(s) shift, in which direction, and what happens to the equilibrium price and quantity. Scenario kind "shift" (or a tax / subsidy). `correctAnswer` states the shifts and the effects, "ambiguous" for the variable the sizes of two shifts decide.'

const AREA_RULE = `  G3. For \`area_read\`: give the curves' equations and the change in the prompt and ask for exactly one value; set \`target\` to one of ${GRAPH_TARGETS.join(', ')}. \`correctAnswer\` is that value (a number, with $ for money).`

const DRAW_RULE =
  '  G4. For `draw_diagram`: give the curves and the change and ask the student to show it on the diagram. Set `draw` to {"items": the graded steps from "curve", "direction", "amount" (only when the prompt states the size of the shift or the tax), "policy" (a ceiling / floor / quota / world-price line), "equilibrium" (mark the new outcome), "region"; "region": one of "cs", "ps", "dwl", "revenue", "cost", "rent", "tariff", "transfer" when "region" is listed}. `correctAnswer` describes the drawing in words.'

function graphRules(types: ReadonlySet<string>): string[] {
  const rules = [MARKET_RULE]
  if (types.has('shift_id')) rules.push(SHIFT_RULE)
  if (types.has('area_read')) rules.push(AREA_RULE)
  if (types.has('draw_diagram')) rules.push(DRAW_RULE)
  return rules
}

const SCHEMA_ADDITIONS: Record<string, unknown> = {
  market: {
    demand: { form: 'price', intercept: 'number', slope: 'number (< 0)' },
    supply: { form: 'price', intercept: 'number', slope: 'number (> 0)' },
    scenario: 'object (graph types only; see G1)',
  },
  target: 'string | null (area_read only)',
  draw: '{ "items": string[], "region": string } | null (draw_diagram only)',
}

export function buildSystemPrompt(options: QuizSystemPromptOptions = {}): string {
  const { types, ...rest } = options
  const planned = new Set<string>(types ?? [])
  const graph = GRAPH_TYPES.filter((type) => planned.has(type))
  if (graph.length === 0)
    return V9.buildSystemPrompt({
      ...rest,
      ...(types ? { types: types as readonly V9.QuizQuestionType[] } : {}),
    })
  const others = (types ?? []).filter(
    (type): type is V9.QuizQuestionType => !(GRAPH_TYPES as readonly string[]).includes(type),
  )
  // A quiz of graph types only still needs the general rules: numeric is the carrier.
  let prompt = V9.buildSystemPrompt({
    ...rest,
    types: others.length > 0 ? others : ['numeric'],
  })
  if (others.length === 0)
    prompt = prompt.replace(/\n {2}\d+\. For `numeric`[^\n]*(?:\n {5}- [^\n]*)*/, '')

  const lines = prompt.split('\n')
  const rulesEnd = lines.findIndex(
    (line, i) => i > 0 && line === '' && lines.slice(0, i).includes('Rules:'),
  )
  if (rulesEnd > 0) lines.splice(rulesEnd, 0, ...graphRules(planned))
  prompt = lines.join('\n')

  const schemaStart = prompt.indexOf('JSON schema:\n')
  if (schemaStart < 0) return prompt
  const jsonStart = schemaStart + 'JSON schema:\n'.length
  const jsonEnd = prompt.indexOf('\n\n', jsonStart)
  try {
    const schema = JSON.parse(prompt.slice(jsonStart, jsonEnd)) as {
      questions: Array<Record<string, unknown>>
    }
    const question = schema.questions[0]!
    const typeList = [...others, ...graph].join(' | ')
    const fields: Record<string, unknown> = { ...question, type: typeList }
    fields.market = SCHEMA_ADDITIONS.market
    if (graph.includes('area_read')) fields.target = SCHEMA_ADDITIONS.target
    if (graph.includes('draw_diagram')) fields.draw = SCHEMA_ADDITIONS.draw
    const json = JSON.stringify({ questions: [fields] }, null, 2)
    return `${prompt.slice(0, jsonStart)}${json}${prompt.slice(jsonEnd)}`
  } catch {
    return prompt
  }
}

export function buildUserPrompt(input: QuizGenerationInput): string {
  return V9.buildUserPrompt(input as V9.QuizGenerationInput)
}
