/**
 * Local generator of graded graph questions (economics), fully verifiable:
 * the market is picked here with friendly numbers (integer equilibrium,
 * terminating decimals everywhere), the stem comes from a template, and every
 * answer — the shift directions, each value, each multiple-choice option —
 * from the engine (`solveMarket`). No AI is involved.
 *
 *   - `generateMarketQuestion({ kind, family, rng, language })` one question
 *     (`shift_id`, `area_read`, `draw_diagram`) with stem, answer and solution;
 *   - `familiesForTopic(name)` which scenarios suit a course topic;
 *   - `marketVariant(question, rng, language)` the same structure with new
 *     numbers (改编题 for 错题跟进 and from a recognised course graph);
 *   - `marketChoiceOptions(...)` multiple-choice options built from the
 *     common mistakes (the wrong triangle, a forgotten ½, the burdens or the
 *     buyer / seller prices swapped, the original quantity …);
 *   - `buildMarketFigureGroup(...)` one shared figure and one question per
 *     slot of an AI mock paper's figure group.
 */
import type { Rng } from '@/entities/homework/practice/random'
import {
  formatCurveEquation,
  formatMarketNumber,
  resolveCurve,
  solveMarket,
  type CurveShift,
  type MarketNumber,
  type MarketScenario,
  type MarketSolution,
  type MarketSpec,
  type QuantityScale,
} from './market'
import {
  exactDecimal,
  expectedMarketAnswer,
  formatTargetValue,
  marketValue,
  regionCandidates,
  solveQuestion,
  validateMarketQuestion,
  type DrawItemKey,
  type MarketFigure,
  type MarketQuestion,
  type MarketQuestionKind,
  type MarketValueTarget,
  type RegionKey,
  type ShiftAnswer,
} from './graphQuestion'

export type MarketLanguage = 'zh' | 'en'

export type MarketFamily =
  | 'shift'
  | 'both_shift'
  | 'tax'
  | 'subsidy'
  | 'ceiling'
  | 'floor'
  | 'quota'
  | 'trade'
  | 'surplus'
  | 'elasticity'

export const MARKET_FAMILIES: readonly MarketFamily[] = [
  'shift',
  'both_shift',
  'tax',
  'subsidy',
  'ceiling',
  'floor',
  'quota',
  'trade',
  'surplus',
  'elasticity',
]

const TOPIC_FAMILIES: Array<[RegExp, MarketFamily[]]> = [
  [/\btax|税/i, ['tax']],
  [/subsid|补贴/i, ['subsidy']],
  [/ceiling|rent control|价格上限|限价|最高限价/i, ['ceiling']],
  [/floor|minimum wage|价格下限|最低工资|最低限价|支持价格/i, ['floor']],
  [/price control|管制/i, ['ceiling', 'floor']],
  [/quota|licen[cs]|配额|许可/i, ['quota']],
  [/trade|tariff|import|export|world price|贸易|关税|进口|出口|世界价格/i, ['trade']],
  [/elastic|弹性/i, ['elasticity']],
  [/surplus|welfare|efficien|deadweight|剩余|福利|效率|无谓损失/i, ['surplus', 'tax']],
  [/shift|demand|supply|equilibri|market|供求|需求|供给|均衡|市场/i, ['shift', 'both_shift']],
]

/** The scenario families a course topic suits; null when it names none. */
export function familiesForTopic(name: string): MarketFamily[] | null {
  for (const [pattern, families] of TOPIC_FAMILIES) if (pattern.test(name)) return families
  return null
}

/** Which question kinds a family can produce. */
export function kindsForFamily(family: MarketFamily): MarketQuestionKind[] {
  switch (family) {
    case 'shift':
    case 'tax':
    case 'subsidy':
      return ['shift_id', 'area_read', 'draw_diagram']
    case 'both_shift':
      return ['shift_id', 'area_read']
    case 'ceiling':
    case 'floor':
    case 'quota':
    case 'trade':
      return ['area_read', 'draw_diagram']
    case 'surplus':
    case 'elasticity':
      return ['area_read']
  }
}

/** A family that can produce the kind, preferring the given ones. */
export function familyFor(
  kind: MarketQuestionKind,
  preferred: readonly MarketFamily[] | null,
  rng: Rng,
): MarketFamily {
  const usable = (preferred ?? []).filter((family) => kindsForFamily(family).includes(kind))
  if (usable.length) return rng.pick(usable)
  const all = MARKET_FAMILIES.filter((family) => kindsForFamily(family).includes(kind))
  return rng.pick(all)
}

const TARGETS: Record<MarketFamily, MarketValueTarget[]> = {
  shift: ['new_price', 'new_quantity', 'cs_after', 'ps_after', 'cs_change'],
  both_shift: ['new_price', 'new_quantity'],
  tax: [
    'dwl',
    'tax_revenue',
    'buyer_price',
    'seller_price',
    'buyer_burden',
    'seller_burden',
    'new_quantity',
    'cs_after',
    'ps_after',
  ],
  subsidy: ['subsidy_cost', 'dwl', 'buyer_price', 'seller_price', 'new_quantity'],
  ceiling: ['shortage', 'dwl', 'new_quantity', 'ps_after'],
  floor: ['excess_supply', 'dwl', 'new_quantity'],
  quota: ['quota_rent', 'dwl', 'new_price'],
  trade: ['imports', 'cs_after', 'ps_after', 'tariff_revenue', 'dwl'],
  surplus: ['eq_price', 'eq_quantity', 'cs_before', 'ps_before'],
  elasticity: ['elasticity_demand', 'elasticity_midpoint', 'tr_change'],
}

/** The value targets a family asks about (in a sensible order). */
export function targetsForFamily(family: MarketFamily): MarketValueTarget[] {
  return TARGETS[family]
}

// --- markets ------------------------------------------------------------------------

/** A clean decimal (integer or a terminating decimal of at most 2 places). */
function friendly(n: MarketNumber | null | undefined): boolean {
  if (!n) return true
  const text = formatMarketNumber(n)
  if (text.startsWith('≈')) return false
  const decimals = text.split('.')[1]?.length ?? 0
  return decimals <= 2
}

function friendlySolution(solution: MarketSolution): boolean {
  const values = [
    solution.original.p,
    solution.original.q,
    solution.outcome.p,
    solution.outcome.q,
    solution.buyerPrice,
    solution.sellerPrice,
    solution.deadweightLoss,
    solution.after.cs,
    solution.after.ps,
    solution.after.government,
    solution.control?.gap,
    solution.trade?.volume,
  ]
  return values.every(friendly)
}

const SLOPES = [0.5, 1, 2, 1, 2, 4] as const

/** Demand P = a − bQ and supply P = c + dQ with an integer equilibrium. */
function baseMarket(rng: Rng): {
  spec: Pick<MarketSpec, 'demand' | 'supply'>
  q: number
  p: number
  b: number
  d: number
} {
  const b = rng.pick(SLOPES)
  const d = rng.pick(SLOPES)
  const q = rng.int(2, 6) * 10
  const c = rng.pick([0, 10, 20, 20, 30])
  const p = c + d * q
  const a = p + b * q
  return {
    spec: {
      demand: { form: 'price', intercept: a, slope: -b },
      supply: { form: 'price', intercept: c, slope: d },
    },
    q,
    p,
    b,
    d,
  }
}

export interface ShiftPlan {
  demand?: 'increase' | 'decrease'
  supply?: 'increase' | 'decrease'
}

function shiftScenario(plan: ShiftPlan, rng: Rng, q: number): MarketScenario {
  const amount = () => rng.pick([10, 20]) * (q >= 40 ? 1 : 0.5)
  const side = (direction: 'increase' | 'decrease' | undefined): CurveShift | undefined =>
    direction ? { dq: direction === 'increase' ? amount() : -amount() } : undefined
  const demand = side(plan.demand)
  const supply = side(plan.supply)
  return { kind: 'shift', ...(demand ? { demand } : {}), ...(supply ? { supply } : {}) }
}

function pickPlan(family: MarketFamily, rng: Rng): ShiftPlan {
  const dir = (): 'increase' | 'decrease' => (rng.next() < 0.5 ? 'increase' : 'decrease')
  if (family === 'both_shift') return { demand: dir(), supply: dir() }
  return rng.next() < 0.5 ? { demand: dir() } : { supply: dir() }
}

function scenarioFor(
  family: MarketFamily,
  base: ReturnType<typeof baseMarket>,
  rng: Rng,
  plan?: ShiftPlan,
  on?: 'buyers' | 'sellers',
): MarketScenario {
  const { q, p, b, d } = base
  const step = b + d
  switch (family) {
    case 'shift':
    case 'both_shift':
      return shiftScenario(plan ?? pickPlan(family, rng), rng, q)
    case 'elasticity':
      // A supply shift: the midpoint elasticity of demand is measured along demand.
      return shiftScenario({ supply: rng.next() < 0.5 ? 'increase' : 'decrease' }, rng, q)
    case 'tax':
    case 'subsidy': {
      // Quantity changes by amount / (b + d): a multiple of the slopes keeps it whole.
      const k = rng.pick([5, 10, 10, 15])
      const amount = step * k * (step < 2 ? 2 : 1)
      return {
        kind: family,
        amount: Math.min(amount, family === 'tax' ? p : amount),
        on: on ?? (rng.next() < 0.75 ? 'sellers' : 'buyers'),
      }
    }
    case 'ceiling':
      return { kind: 'ceiling', price: p - rng.pick([5, 10, 10, 20]) }
    case 'floor':
      return { kind: 'floor', price: p + rng.pick([5, 10, 10, 20]) }
    case 'quota':
      return { kind: 'quota', quantity: q - rng.pick([5, 10, 10]) }
    case 'trade': {
      const below = rng.pick([5, 10, 10, 20])
      const tariff = rng.next() < 0.5 ? Math.floor(below / 2) : undefined
      return { kind: 'trade', worldPrice: p - below, ...(tariff ? { tariff } : {}) }
    }
    case 'surplus':
      return { kind: 'equilibrium' }
  }
}

export interface GeneratedMarket {
  spec: MarketSpec
  solution: MarketSolution
  quantityScale?: QuantityScale
}

/** A market for a family: friendly numbers, solved; tries a few draws. */
export function generateMarket(
  family: MarketFamily,
  rng: Rng,
  options: { plan?: ShiftPlan; on?: 'buyers' | 'sellers'; thousands?: boolean } = {},
): GeneratedMarket {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const base = baseMarket(rng)
    const scenario = scenarioFor(family, base, rng, options.plan, options.on)
    const spec: MarketSpec = { ...base.spec, scenario }
    const result = solveMarket(spec)
    if (!result.ok) continue
    const solution = result.solution
    if (scenario.kind !== 'equilibrium' && scenario.kind !== 'shift' && !solution.binding) continue
    if (scenario.kind === 'trade' && solution.trade?.role !== 'importer') continue
    if (scenario.kind === 'tax' && solution.outcome.q.value <= 0) continue
    if (!friendlySolution(solution)) continue
    return {
      spec,
      solution,
      ...(options.thousands ? { quantityScale: 'thousands' as const } : {}),
    }
  }
  // A fixed, known-good market (never reached in practice).
  const spec: MarketSpec = {
    demand: { form: 'price', intercept: 100, slope: -2 },
    supply: { form: 'price', intercept: 20, slope: 2 },
    scenario:
      family === 'surplus' ? { kind: 'equilibrium' } : { kind: 'tax', amount: 8, on: 'sellers' },
  }
  const solved = solveMarket(spec)
  if (!solved.ok) throw new Error('fallback market does not solve')
  return { spec, solution: solved.solution }
}

// --- words --------------------------------------------------------------------------

interface Words {
  en: string
  zh: string
}

const GOODS: Words[] = [
  { en: 'coffee', zh: '咖啡' },
  { en: 'apples', zh: '苹果' },
  { en: 'bicycles', zh: '自行车' },
  { en: 'concert tickets', zh: '演唱会门票' },
  { en: 'wheat', zh: '小麦' },
  { en: 'laptops', zh: '笔记本电脑' },
  { en: 'gasoline', zh: '汽油' },
  { en: 'rental apartments', zh: '出租公寓' },
]

/** Events that shift one curve one way (the question never states the direction). */
const EVENTS: Record<'demand' | 'supply', Record<'increase' | 'decrease', Words[]>> = {
  demand: {
    increase: [
      {
        en: "Consumers' incomes rise ({good} is a normal good)",
        zh: '消费者收入上升（{good}是正常品）',
      },
      { en: 'The price of a substitute for {good} rises', zh: '{good}的替代品价格上涨' },
      { en: 'An advertising campaign makes {good} more popular', zh: '广告宣传使{good}更受欢迎' },
      {
        en: 'Buyers expect the price of {good} to rise next month',
        zh: '买方预期{good}下个月会涨价',
      },
    ],
    decrease: [
      {
        en: "Consumers' incomes fall ({good} is a normal good)",
        zh: '消费者收入下降（{good}是正常品）',
      },
      { en: 'The price of a complement of {good} rises', zh: '{good}的互补品价格上涨' },
      { en: 'A news report makes {good} less popular', zh: '一则新闻报道使{good}不再受欢迎' },
      { en: 'The number of buyers of {good} falls', zh: '{good}的买方人数减少' },
    ],
  },
  supply: {
    increase: [
      {
        en: 'A new technology lowers the cost of producing {good}',
        zh: '新技术降低了{good}的生产成本',
      },
      {
        en: 'The price of an input used to make {good} falls',
        zh: '生产{good}所用投入品的价格下降',
      },
      { en: 'More firms enter the market for {good}', zh: '更多厂商进入{good}市场' },
    ],
    decrease: [
      {
        en: 'The price of an input used to make {good} rises',
        zh: '生产{good}所用投入品的价格上涨',
      },
      {
        en: 'Bad weather destroys part of the supply of {good}',
        zh: '恶劣天气毁掉了部分{good}的供给',
      },
      {
        en: 'A new regulation raises the cost of producing {good}',
        zh: '新规定提高了{good}的生产成本',
      },
    ],
  },
}

function say(words: Words, language: MarketLanguage, good: Words): string {
  return words[language].replace('{good}', good[language])
}

function curveText(spec: MarketSpec, language: MarketLanguage): string {
  const d = resolveCurve(spec.demand, 'demand')
  const s = resolveCurve(spec.supply, 'supply')
  const demand = d.ok ? formatCurveEquation(d.value) : ''
  const supply = s.ok ? formatCurveEquation(s.value) : ''
  return language === 'zh'
    ? `需求曲线：${demand}；供给曲线：${supply}。`
    : `Demand: ${demand}; supply: ${supply}.`
}

function money(n: number, language: MarketLanguage, unit = '$'): string {
  void language
  return `${unit}${formatMarketNumber({ value: n, exact: { n: BigInt(Math.round(n * 100)), d: 100n } })}`
}

function scaleNote(scale: QuantityScale | undefined, language: MarketLanguage): string {
  if (scale !== 'thousands') return ''
  return language === 'zh' ? '（数量单位：千件）' : ' (Quantities are in thousands of units.)'
}

/** The change, as the stem states it (amounts given when `numbers`). */
export function scenarioSentence(
  spec: MarketSpec,
  language: MarketLanguage,
  good: Words,
  events: { demand?: Words; supply?: Words },
  numbers: boolean,
): string {
  const scenario = spec.scenario
  const zh = language === 'zh'
  switch (scenario.kind) {
    case 'equilibrium':
      return ''
    case 'shift': {
      const parts: string[] = []
      for (const side of ['demand', 'supply'] as const) {
        const shift = scenario[side]
        if (!shift) continue
        const event = events[side]
        const text = event ? say(event, language, good) : ''
        if (!numbers || shift.dq === undefined) {
          parts.push(text)
          continue
        }
        const amount = Math.abs(shift.dq)
        const more = shift.dq > 0
        const what = zh
          ? `在每一价格下${side === 'demand' ? '需求量' : '供给量'}${more ? '增加' : '减少'} ${amount} 单位`
          : `at every price the quantity ${side === 'demand' ? 'demanded' : 'supplied'} ${more ? 'rises' : 'falls'} by ${amount} units`
        parts.push(text ? (zh ? `${text}：${what}` : `${text}: ${what}`) : what)
      }
      if (zh) return `${parts.join('；同时')}。`
      // "…; at the same time, bad weather …": later clauses start lower-case.
      const joined = parts.map((part, index) =>
        index > 0 && /^[A-Z][a-z]/.test(part) ? part[0]!.toLowerCase() + part.slice(1) : part,
      )
      return `${joined.join('; at the same time, ')}.`
    }
    case 'tax':
    case 'subsidy': {
      const amount = money(scenario.amount, language)
      const who = scenario.on === 'sellers' ? (zh ? '卖方' : 'sellers') : zh ? '买方' : 'buyers'
      if (scenario.kind === 'tax')
        return zh
          ? `政府对${who}每单位征收 ${amount} 的税。`
          : `The government levies a tax of ${amount} per unit on ${who}.`
      return zh
        ? `政府向${who}每单位发放 ${amount} 的补贴。`
        : `The government pays ${who} a subsidy of ${amount} per unit.`
    }
    case 'ceiling':
      return zh
        ? `政府规定价格上限为 ${money(scenario.price, language)}。`
        : `The government sets a price ceiling of ${money(scenario.price, language)}.`
    case 'floor':
      return zh
        ? `政府规定价格下限为 ${money(scenario.price, language)}。`
        : `The government sets a price floor of ${money(scenario.price, language)}.`
    case 'quota':
      return zh
        ? `政府用配额把销售量限制为 ${scenario.quantity} 单位。`
        : `A quota limits the quantity sold to ${scenario.quantity} units.`
    case 'trade': {
      const base = zh
        ? `该国开放贸易，世界价格为 ${money(scenario.worldPrice, language)}`
        : `The country opens to trade at a world price of ${money(scenario.worldPrice, language)}`
      const tariff =
        scenario.tariff !== undefined
          ? zh
            ? `，并对进口每单位征收 ${money(scenario.tariff, language)} 的关税`
            : ` and imposes a tariff of ${money(scenario.tariff, language)} per unit on imports`
          : ''
      return `${base}${tariff}${zh ? '。' : '.'}`
    }
  }
}

const TARGET_ASK: Record<MarketValueTarget, Words> = {
  eq_price: { en: 'What is the equilibrium price?', zh: '均衡价格是多少？' },
  eq_quantity: { en: 'What is the equilibrium quantity?', zh: '均衡数量是多少？' },
  new_price: { en: 'What is the new equilibrium price?', zh: '新的均衡价格是多少？' },
  new_quantity: {
    en: 'What quantity is traded after the change?',
    zh: '变化之后的交易量是多少？',
  },
  buyer_price: { en: 'What price do buyers pay?', zh: '买方支付的价格是多少？' },
  seller_price: { en: 'What price do sellers receive?', zh: '卖方得到的价格是多少？' },
  cs_before: { en: 'Calculate the consumer surplus.', zh: '计算消费者剩余。' },
  ps_before: { en: 'Calculate the producer surplus.', zh: '计算生产者剩余。' },
  cs_after: {
    en: 'Calculate the consumer surplus after the change.',
    zh: '计算变化之后的消费者剩余。',
  },
  ps_after: {
    en: 'Calculate the producer surplus after the change.',
    zh: '计算变化之后的生产者剩余。',
  },
  cs_change: {
    en: 'By how much does consumer surplus change? (Use a minus sign for a fall.)',
    zh: '消费者剩余变化了多少？（减少用负号表示）',
  },
  ps_change: {
    en: 'By how much does producer surplus change? (Use a minus sign for a fall.)',
    zh: '生产者剩余变化了多少？（减少用负号表示）',
  },
  total_surplus_after: {
    en: 'Calculate total surplus after the change.',
    zh: '计算变化之后的总剩余。',
  },
  dwl: { en: 'Calculate the deadweight loss.', zh: '计算无谓损失。' },
  tax_revenue: { en: 'Calculate the government’s tax revenue.', zh: '计算政府的税收收入。' },
  subsidy_cost: {
    en: 'Calculate the cost of the subsidy to the government.',
    zh: '计算政府的补贴支出。',
  },
  tariff_revenue: { en: 'Calculate the tariff revenue.', zh: '计算关税收入。' },
  quota_rent: { en: 'Calculate the quota rent.', zh: '计算配额租金。' },
  buyer_burden: {
    en: 'How much of the tax per unit do buyers bear?',
    zh: '每单位税收中买方负担多少？',
  },
  seller_burden: {
    en: 'How much of the tax per unit do sellers bear?',
    zh: '每单位税收中卖方负担多少？',
  },
  shortage: { en: 'How large is the shortage?', zh: '短缺量是多少？' },
  excess_supply: { en: 'How large is the surplus (excess supply)?', zh: '过剩量是多少？' },
  imports: { en: 'How much does the country import?', zh: '该国进口多少？' },
  exports: { en: 'How much does the country export?', zh: '该国出口多少？' },
  elasticity_demand: {
    en: 'What is the price elasticity of demand at the original equilibrium (absolute value)?',
    zh: '原均衡点处的需求价格弹性是多少（取绝对值）？',
  },
  elasticity_supply: {
    en: 'What is the price elasticity of supply at the original equilibrium?',
    zh: '原均衡点处的供给价格弹性是多少？',
  },
  elasticity_midpoint: {
    en: 'Using the midpoint method, what is the price elasticity of demand between the old and new equilibrium (absolute value)?',
    zh: '用中点法计算新旧均衡之间的需求价格弹性（取绝对值）。',
  },
  tr_before: { en: 'What is total revenue at the equilibrium?', zh: '均衡时的总收益是多少？' },
  tr_after: { en: 'What is total revenue after the change?', zh: '变化之后的总收益是多少？' },
  tr_change: {
    en: 'By how much does total revenue (P × Q) change? (Use a minus sign for a fall.)',
    zh: '总收益（P × Q）变化了多少？（减少用负号表示）',
  },
}

/** "the deadweight loss" — a target as a noun (multiple-choice stems). */
const TARGET_NOUN: Record<MarketValueTarget, Words> = {
  eq_price: { en: 'The equilibrium price is', zh: '均衡价格是' },
  eq_quantity: { en: 'The equilibrium quantity is', zh: '均衡数量是' },
  new_price: { en: 'The new equilibrium price is', zh: '新的均衡价格是' },
  new_quantity: { en: 'The quantity traded after the change is', zh: '变化之后的交易量是' },
  buyer_price: { en: 'The price buyers pay is', zh: '买方支付的价格是' },
  seller_price: { en: 'The price sellers receive is', zh: '卖方得到的价格是' },
  cs_before: { en: 'Consumer surplus is', zh: '消费者剩余是' },
  ps_before: { en: 'Producer surplus is', zh: '生产者剩余是' },
  cs_after: { en: 'Consumer surplus after the change is', zh: '变化之后的消费者剩余是' },
  ps_after: { en: 'Producer surplus after the change is', zh: '变化之后的生产者剩余是' },
  cs_change: { en: 'The change in consumer surplus is', zh: '消费者剩余的变化是' },
  ps_change: { en: 'The change in producer surplus is', zh: '生产者剩余的变化是' },
  total_surplus_after: { en: 'Total surplus after the change is', zh: '变化之后的总剩余是' },
  dwl: { en: 'The deadweight loss is', zh: '无谓损失是' },
  tax_revenue: { en: 'Tax revenue is', zh: '税收收入是' },
  subsidy_cost: { en: 'The cost of the subsidy is', zh: '补贴支出是' },
  tariff_revenue: { en: 'Tariff revenue is', zh: '关税收入是' },
  quota_rent: { en: 'The quota rent is', zh: '配额租金是' },
  buyer_burden: { en: 'The tax per unit borne by buyers is', zh: '买方每单位负担的税是' },
  seller_burden: { en: 'The tax per unit borne by sellers is', zh: '卖方每单位负担的税是' },
  shortage: { en: 'The shortage is', zh: '短缺量是' },
  excess_supply: { en: 'The surplus (excess supply) is', zh: '过剩量是' },
  imports: { en: 'Imports are', zh: '进口量是' },
  exports: { en: 'Exports are', zh: '出口量是' },
  elasticity_demand: {
    en: 'The price elasticity of demand at the original equilibrium (absolute value) is',
    zh: '原均衡点处的需求价格弹性（绝对值）是',
  },
  elasticity_supply: {
    en: 'The price elasticity of supply at the original equilibrium is',
    zh: '原均衡点处的供给价格弹性是',
  },
  elasticity_midpoint: {
    en: 'The midpoint price elasticity of demand (absolute value) is',
    zh: '用中点法计算的需求价格弹性（绝对值）是',
  },
  tr_before: { en: 'Total revenue at the equilibrium is', zh: '均衡时的总收益是' },
  tr_after: { en: 'Total revenue after the change is', zh: '变化之后的总收益是' },
  tr_change: { en: 'The change in total revenue is', zh: '总收益的变化是' },
}

const REGION_NAMES: Record<RegionKey, Words> = {
  cs: { en: 'consumer surplus', zh: '消费者剩余' },
  ps: { en: 'producer surplus', zh: '生产者剩余' },
  dwl: { en: 'deadweight loss', zh: '无谓损失' },
  revenue: { en: 'tax revenue', zh: '税收收入' },
  cost: { en: 'cost of the subsidy', zh: '补贴支出' },
  rent: { en: 'quota rent', zh: '配额租金' },
  tariff: { en: 'tariff revenue', zh: '关税收入' },
  transfer: { en: 'transfer from producers to consumers', zh: '生产者向消费者的转移' },
}

export function regionName(region: RegionKey, language: MarketLanguage): string {
  return REGION_NAMES[region][language]
}

export function targetAsk(target: MarketValueTarget, language: MarketLanguage): string {
  return TARGET_ASK[target][language]
}

// --- solutions ----------------------------------------------------------------------

/** A short worked solution from the engine's numbers. */
export function marketSolutionText(question: MarketQuestion, language: MarketLanguage): string {
  const solution = solveQuestion(question)
  if (!solution) return ''
  const zh = language === 'zh'
  const unit = question.figure.priceUnit ?? '$'
  const price = (n: MarketNumber) => `${unit}${formatMarketNumber(n)}`
  const lines: string[] = []
  lines.push(
    zh
      ? `原均衡：令需求等于供给，得 Q* = ${formatMarketNumber(solution.original.q)}，P* = ${price(solution.original.p)}。`
      : `Original equilibrium (demand = supply): Q* = ${formatMarketNumber(solution.original.q)}, P* = ${price(solution.original.p)}.`,
  )
  if (solution.scenario !== 'equilibrium') {
    lines.push(
      zh
        ? `变化之后：Q = ${formatMarketNumber(solution.outcome.q)}，买方价格 P = ${price(solution.outcome.p)}。`
        : `After the change: Q = ${formatMarketNumber(solution.outcome.q)}, price paid by buyers P = ${price(solution.outcome.p)}.`,
    )
  }
  if (solution.buyerPrice && solution.sellerPrice)
    lines.push(
      zh
        ? `买方支付 ${price(solution.buyerPrice)}，卖方得到 ${price(solution.sellerPrice)}。`
        : `Buyers pay ${price(solution.buyerPrice)}; sellers receive ${price(solution.sellerPrice)}.`,
    )
  if (solution.control && solution.binding)
    lines.push(
      zh
        ? `在管制价格下需求量 ${formatMarketNumber(solution.control.quantityDemanded)}，供给量 ${formatMarketNumber(solution.control.quantitySupplied)}。`
        : `At the controlled price, quantity demanded is ${formatMarketNumber(solution.control.quantityDemanded)} and quantity supplied ${formatMarketNumber(solution.control.quantitySupplied)}.`,
    )
  const expected = expectedMarketAnswer(question)
  if (expected?.value) {
    const name = TARGET_NOUN[expected.value.target][language]
    lines.push(`${name} ${expected.value.text}${zh ? '。' : '.'}`)
  }
  if (expected?.shift) lines.push(shiftSolution(expected.shift, language))
  if (question.kind === 'draw_diagram' && question.draw?.region) {
    const area = solution.areas.find(
      (item) => item.kind === question.draw!.region && item.phase === 'after' && !item.effect,
    )
    if (area)
      lines.push(
        zh
          ? `${regionName(question.draw.region, language)}面积 = ${price(area.area)}。`
          : `The ${regionName(question.draw.region, language)} is ${price(area.area)}.`,
      )
  }
  return lines.join('\n\n')
}

const MOVE_WORDS: Record<string, Words> = {
  increase: { en: 'increases (shifts right)', zh: '增加（右移）' },
  decrease: { en: 'decreases (shifts left)', zh: '减少（左移）' },
  none: { en: 'does not shift', zh: '不移动' },
}

const OUTCOME_WORDS: Record<string, Words> = {
  increase: { en: 'rises', zh: '上升' },
  decrease: { en: 'falls', zh: '下降' },
  unchanged: { en: 'is unchanged', zh: '不变' },
  ambiguous: {
    en: 'is ambiguous (depends on the sizes of the shifts)',
    zh: '不确定（取决于两条曲线移动的幅度）',
  },
}

export function shiftSolution(answer: ShiftAnswer, language: MarketLanguage): string {
  const zh = language === 'zh'
  return zh
    ? `需求${MOVE_WORDS[answer.demand]!.zh}，供给${MOVE_WORDS[answer.supply]!.zh}；均衡价格${OUTCOME_WORDS[answer.price]!.zh}，均衡数量${OUTCOME_WORDS[answer.quantity]!.zh}。`
    : `Demand ${MOVE_WORDS[answer.demand]!.en}; supply ${MOVE_WORDS[answer.supply]!.en}; the equilibrium price ${OUTCOME_WORDS[answer.price]!.en} and the equilibrium quantity ${OUTCOME_WORDS[answer.quantity]!.en}.`
}

/** The expected answer as text (stored as the question's reference answer). */
export function marketAnswerText(question: MarketQuestion, language: MarketLanguage): string {
  const expected = expectedMarketAnswer(question)
  if (!expected) return ''
  if (expected.shift) return shiftSolution(expected.shift, language)
  if (expected.value) return expected.value.text
  if (expected.draw) {
    const zh = language === 'zh'
    const parts: string[] = []
    for (const move of expected.draw.moves)
      parts.push(
        `${move.side === 'demand' ? (zh ? '需求' : 'Demand') : zh ? '供给' : 'Supply'} ${MOVE_WORDS[move.direction]![language]}`,
      )
    if (expected.draw.policy)
      parts.push(
        zh
          ? `政策线位于 ${expected.draw.policy.value}`
          : `policy line at ${expected.draw.policy.value}`,
      )
    parts.push(
      zh
        ? `新结果 Q = ${round2(expected.draw.point.q)}，P = ${round2(expected.draw.point.p)}`
        : `new outcome Q = ${round2(expected.draw.point.q)}, P = ${round2(expected.draw.point.p)}`,
    )
    if (expected.draw.region) parts.push(regionName(expected.draw.region, language))
    return parts.join(zh ? '；' : '; ')
  }
  return ''
}

function round2(n: number): string {
  return String(Math.round(n * 100) / 100)
}

// --- questions ----------------------------------------------------------------------

export interface GeneratedMarketQuestion {
  question: MarketQuestion
  stem: string
  answer: string
  solution: string
  family: MarketFamily
  good: Words
}

interface Draft {
  family: MarketFamily
  market: GeneratedMarket
  events: { demand?: Words; supply?: Words }
  good: Words
}

function eventsFor(spec: MarketSpec, rng: Rng): { demand?: Words; supply?: Words } {
  const scenario = spec.scenario
  if (scenario.kind !== 'shift') return {}
  const out: { demand?: Words; supply?: Words } = {}
  for (const side of ['demand', 'supply'] as const) {
    const dq = scenario[side]?.dq
    if (dq === undefined) continue
    out[side] = rng.pick(EVENTS[side][dq > 0 ? 'increase' : 'decrease'])
  }
  return out
}

function draft(
  family: MarketFamily,
  rng: Rng,
  options: { plan?: ShiftPlan; on?: 'buyers' | 'sellers'; thousands?: boolean } = {},
): Draft {
  const market = generateMarket(family, rng, options)
  return { family, market, events: eventsFor(market.spec, rng), good: rng.pick(GOODS) }
}

function intro(good: Words, language: MarketLanguage): string {
  return language === 'zh'
    ? `下图是${good.zh}市场。`
    : `The figure shows the market for ${good.en}.`
}

function figureOf(market: GeneratedMarket, show: MarketFigure['show']): MarketFigure {
  return {
    spec: market.spec,
    show,
    priceUnit: '$',
    ...(market.quantityScale ? { quantityScale: market.quantityScale } : {}),
  }
}

/** Items a drawing of this scenario is graded on, and the region to select. */
function drawTask(solution: MarketSolution, spec: MarketSpec, rng: Rng): MarketQuestion['draw'] {
  const kind = spec.scenario.kind
  const regions = regionCandidates(solution)
  const items: DrawItemKey[] = []
  let region: RegionKey | undefined
  if (kind === 'shift' || kind === 'tax' || kind === 'subsidy') {
    items.push('curve', 'direction')
    if (kind !== 'shift') items.push('amount')
    items.push('equilibrium')
    const preferred: RegionKey[] =
      kind === 'tax' ? ['dwl', 'revenue'] : kind === 'subsidy' ? ['dwl', 'cost'] : ['cs', 'ps']
    region = rng.pick(preferred.filter((key) => regions.includes(key)).concat())
  } else {
    items.push('policy')
    if (kind !== 'trade') items.push('equilibrium')
    const preferred: RegionKey[] =
      kind === 'quota' ? ['rent', 'dwl'] : kind === 'trade' ? ['cs', 'ps'] : ['dwl']
    const usable = preferred.filter((key) => regions.includes(key))
    region = usable.length ? rng.pick(usable) : undefined
  }
  if (region) items.push('region')
  return { items, ...(region ? { region } : {}) }
}

function drawInstructions(
  question: MarketQuestion,
  spec: MarketSpec,
  language: MarketLanguage,
): string {
  const zh = language === 'zh'
  const task = question.draw!
  const steps: string[] = []
  if (task.items.includes('curve'))
    steps.push(
      zh
        ? task.items.includes('amount')
          ? '把需要移动的曲线拖到新的位置（移动的距离要与题目一致）'
          : '把需要移动的曲线向正确的方向拖动'
        : task.items.includes('amount')
          ? 'drag the curve that moves to its new position (by the amount stated)'
          : 'drag the curve(s) that move in the right direction',
    )
  if (task.items.includes('policy')) {
    const line =
      spec.scenario.kind === 'quota'
        ? zh
          ? '配额线'
          : 'quota line'
        : spec.scenario.kind === 'trade'
          ? zh
            ? '世界价格线'
            : 'world-price line'
          : spec.scenario.kind === 'ceiling'
            ? zh
              ? '价格上限线'
              : 'price-ceiling line'
            : zh
              ? '价格下限线'
              : 'price-floor line'
    steps.push(zh ? `放置${line}` : `place the ${line}`)
  }
  if (task.items.includes('equilibrium'))
    steps.push(
      zh
        ? '在图上点出新的结果（买方支付的价格与交易量）'
        : 'tap the new outcome (the price buyers pay and the quantity traded)',
    )
  if (task.region)
    steps.push(
      zh
        ? `选出${regionName(task.region, language)}区域`
        : `select the ${regionName(task.region, language)}`,
    )
  return zh
    ? `在图上表示这一变化：${steps.join('；')}。`
    : `Show this change on the diagram: ${steps.join('; ')}.`
}

function shiftAsk(language: MarketLanguage): string {
  return language === 'zh'
    ? '哪条曲线移动、向哪个方向移动？均衡价格和均衡数量如何变化？'
    : 'Which curve(s) shift, in which direction, and what happens to the equilibrium price and quantity?'
}

function buildFromDraft(
  kind: MarketQuestionKind,
  d: Draft,
  rng: Rng,
  language: MarketLanguage,
  target?: MarketValueTarget,
): GeneratedMarketQuestion | null {
  const { market, good } = d
  const spec = market.spec
  let question: MarketQuestion
  let stem: string
  switch (kind) {
    case 'shift_id': {
      question = { kind, figure: figureOf(market, 'before'), qualitative: true }
      const change = scenarioSentence(spec, language, good, d.events, false)
      stem = `${intro(good, language)}${language === 'zh' ? '' : ' '}${change}${language === 'zh' ? '' : ' '}${shiftAsk(language)}`
      break
    }
    case 'area_read': {
      const pool = TARGETS[d.family].filter(
        (item) =>
          marketValue(market.solution, item) !== null &&
          friendly(marketValue(market.solution, item)),
      )
      const chosen = target && pool.includes(target) ? target : pool.length ? rng.pick(pool) : null
      if (!chosen) return null
      const show = chosen === 'eq_price' || chosen === 'eq_quantity' ? 'curves' : 'before'
      question = { kind, figure: figureOf(market, show), target: chosen }
      const change = scenarioSentence(spec, language, good, d.events, true)
      const space = language === 'zh' ? '' : ' '
      stem = [
        intro(good, language),
        curveText(spec, language),
        scaleNote(market.quantityScale, language),
        change,
        TARGET_ASK[chosen][language],
      ]
        .filter(Boolean)
        .join(space)
      break
    }
    case 'draw_diagram': {
      question = {
        kind,
        figure: figureOf(market, 'before'),
        draw: drawTask(market.solution, spec, rng)!,
      }
      const change = scenarioSentence(spec, language, good, d.events, true)
      const space = language === 'zh' ? '' : ' '
      stem = [
        intro(good, language),
        curveText(spec, language),
        scaleNote(market.quantityScale, language),
        change,
        drawInstructions(question, spec, language),
      ]
        .filter(Boolean)
        .join(space)
      break
    }
  }
  if (!validateMarketQuestion(question)) return null
  return {
    question,
    stem,
    answer: marketAnswerText(question, language),
    solution: marketSolutionText(question, language),
    family: d.family,
    good,
  }
}

/** One graph question of a kind (and family, when given). Never null: retries other draws. */
export function generateMarketQuestion(input: {
  kind: MarketQuestionKind
  family?: MarketFamily
  families?: readonly MarketFamily[] | null
  target?: MarketValueTarget
  rng: Rng
  language: MarketLanguage
  thousands?: boolean
}): GeneratedMarketQuestion {
  const { kind, rng, language } = input
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const family =
      input.family && kindsForFamily(input.family).includes(kind)
        ? input.family
        : familyFor(kind, input.families ?? null, rng)
    const built = buildFromDraft(
      kind,
      draft(family, rng, input.thousands ? { thousands: true } : {}),
      rng,
      language,
      input.target,
    )
    if (built) return built
  }
  // Always possible: a tax market answers every kind.
  const built = buildFromDraft(kind, draft('tax', rng), rng, language, 'dwl')
  if (!built) throw new Error('market question generator failed')
  return built
}

/** The family a stored question's scenario belongs to. */
export function familyOfSpec(spec: MarketSpec): MarketFamily {
  const scenario = spec.scenario
  switch (scenario.kind) {
    case 'equilibrium':
      return 'surplus'
    case 'shift':
      return scenario.demand && scenario.supply ? 'both_shift' : 'shift'
    default:
      return scenario.kind
  }
}

/**
 * The same structure with new numbers (改编题): the same kind, scenario family,
 * value target or drawing items; a new market and context. Shift questions
 * keep which curves move (the directions may differ).
 */
export function marketVariant(
  question: MarketQuestion,
  rng: Rng,
  language: MarketLanguage,
): GeneratedMarketQuestion | null {
  const scenarioFamily = familyOfSpec(question.figure.spec)
  // A value asked of another family (the midpoint elasticity of a supply
  // shift is an `elasticity` question) keeps the family that asks it.
  const target = question.target
  const family =
    target && !TARGETS[scenarioFamily].includes(target)
      ? (MARKET_FAMILIES.find((item) => TARGETS[item].includes(target)) ?? scenarioFamily)
      : scenarioFamily
  const scenario = question.figure.spec.scenario
  const options: { plan?: ShiftPlan; on?: 'buyers' | 'sellers'; thousands?: boolean } = {
    ...(question.figure.quantityScale === 'thousands' ? { thousands: true } : {}),
  }
  if (scenario.kind === 'tax' || scenario.kind === 'subsidy') options.on = scenario.on
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (scenario.kind === 'shift') {
      const dir = (): 'increase' | 'decrease' => (rng.next() < 0.5 ? 'increase' : 'decrease')
      options.plan = {
        ...(scenario.demand ? { demand: dir() } : {}),
        ...(scenario.supply ? { supply: dir() } : {}),
      }
    }
    const built = buildFromDraft(
      question.kind,
      draft(family, rng, options),
      rng,
      language,
      question.target,
    )
    if (!built) continue
    if (question.kind === 'area_read' && built.question.target !== question.target) continue
    if (question.kind === 'draw_diagram' && question.draw) {
      // The same items; the same region when this market has it.
      const solved = solveQuestion(built.question)
      const region =
        question.draw.region && solved && regionCandidates(solved).includes(question.draw.region)
          ? question.draw.region
          : built.question.draw?.region
      const items = question.draw.items.filter((item) => item !== 'region' || region)
      built.question.draw = { items, ...(region ? { region } : {}) }
      if (!validateMarketQuestion(built.question)) continue
    }
    if (question.rubric) built.question.rubric = question.rubric
    return built
  }
  return null
}

export interface MarketVariantPart {
  label?: string
  prompt: string
  answer: string
  solution: string
  question: MarketQuestion
}

export interface MarketVariantSet {
  stem: string
  parts: MarketVariantPart[]
}

/**
 * One new question mirroring several graph questions on one figure (the parts
 * of a recognised course question): a new market of the same scenario
 * family, the same kinds / targets / drawing items for every part.
 */
export function marketVariantSet(
  asks: ReadonlyArray<{ label?: string; question: MarketQuestion }>,
  rng: Rng,
  language: MarketLanguage,
): MarketVariantSet | null {
  if (asks.length === 0) return null
  const first = asks[0]!.question
  const scenario = first.figure.spec.scenario
  const scenarioFamily = familyOfSpec(first.figure.spec)
  const targets = asks.map((ask) => ask.question.target).filter(Boolean) as MarketValueTarget[]
  const family =
    targets.length &&
    !targets.every(
      (target) => TARGETS[scenarioFamily].includes(target) || TARGETS.surplus.includes(target),
    )
      ? (MARKET_FAMILIES.find((item) =>
          targets.every(
            (target) => TARGETS[item].includes(target) || TARGETS.surplus.includes(target),
          ),
        ) ?? scenarioFamily)
      : scenarioFamily
  const options: { plan?: ShiftPlan; on?: 'buyers' | 'sellers'; thousands?: boolean } = {
    ...(first.figure.quantityScale === 'thousands' ? { thousands: true } : {}),
  }
  if (scenario.kind === 'tax' || scenario.kind === 'subsidy') options.on = scenario.on
  const onlyShift = asks.every((ask) => ask.question.kind === 'shift_id')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (scenario.kind === 'shift') {
      const dir = (): 'increase' | 'decrease' => (rng.next() < 0.5 ? 'increase' : 'decrease')
      options.plan = {
        ...(scenario.demand ? { demand: dir() } : {}),
        ...(scenario.supply ? { supply: dir() } : {}),
      }
    }
    const d = draft(family, rng, options)
    const figure = figureOf(d.market, 'before')
    const parts: MarketVariantPart[] = []
    let failed = false
    for (const ask of asks) {
      const source = ask.question
      const solution = d.market.solution
      const question: MarketQuestion = {
        kind: source.kind,
        figure: {
          ...figure,
          ...(source.figure.priceUnit ? { priceUnit: source.figure.priceUnit } : {}),
        },
        ...(source.target ? { target: source.target } : {}),
        ...(source.qualitative === false ? { qualitative: false } : {}),
        ...(source.rubric ? { rubric: source.rubric } : {}),
      }
      if (source.draw) {
        const region =
          source.draw.region && regionCandidates(solution).includes(source.draw.region)
            ? source.draw.region
            : undefined
        question.draw = {
          items: source.draw.items.filter((item) => item !== 'region' || region),
          ...(region ? { region } : {}),
        }
      }
      if (
        !validateMarketQuestion(question) ||
        (source.target && !friendly(marketValue(solution, source.target)))
      ) {
        failed = true
        break
      }
      const prompt =
        question.kind === 'shift_id'
          ? shiftAsk(language)
          : question.kind === 'area_read'
            ? TARGET_ASK[question.target!][language]
            : drawInstructions(question, d.market.spec, language)
      parts.push({
        ...(ask.label ? { label: ask.label } : {}),
        prompt,
        answer: marketAnswerText(question, language),
        solution: marketSolutionText(question, language),
        question,
      })
    }
    if (failed) continue
    const space = language === 'zh' ? '' : ' '
    const stem = [
      intro(d.good, language),
      onlyShift ? '' : curveText(d.market.spec, language),
      onlyShift ? '' : scaleNote(d.market.quantityScale, language),
      scenarioSentence(d.market.spec, language, d.good, d.events, !onlyShift),
    ]
      .filter(Boolean)
      .join(space)
    return { stem, parts }
  }
  return null
}

// --- multiple choice -------------------------------------------------------------

function mnOf(value: number): MarketNumber {
  // Values here are friendly decimals (≤ 4 places); exact enough for display.
  const scaled = Math.round(value * 10_000)
  return { value, exact: { n: BigInt(scaled), d: 10_000n } }
}

/** Wrong values a student plausibly computes for a target (the common mistakes). */
export function distractorValues(
  solution: MarketSolution,
  target: MarketValueTarget,
): Array<{ value: number; rule: string }> {
  const v = marketValue(solution, target)?.value ?? 0
  const p0 = solution.original.p.value
  const q0 = solution.original.q.value
  const q1 = solution.outcome.q.value
  const wedge = solution.wedge?.value ?? 0
  const pb = solution.buyerPrice?.value
  const ps = solution.sellerPrice?.value
  const out: Array<{ value: number; rule: string }> = []
  const add = (value: number | undefined | null, rule: string) => {
    if (value === undefined || value === null || !Number.isFinite(value)) return
    out.push({ value, rule })
  }
  switch (target) {
    case 'dwl':
      add(2 * v, 'forgot-half')
      add(solution.after.government.value, 'revenue-rectangle')
      add(0.5 * wedge * q0, 'original-quantity')
      add(v / 2, 'halved-twice')
      break
    case 'tax_revenue':
    case 'subsidy_cost':
    case 'tariff_revenue':
      add(wedge * q0, 'original-quantity')
      add(v / 2, 'half-of-rectangle')
      if (solution.incidence) add(solution.incidence.buyersPerUnit.value * q1, 'buyer-share-only')
      add(solution.deadweightLoss?.value, 'dwl-instead')
      break
    case 'buyer_burden':
      add(solution.incidence?.sellersPerUnit.value, 'swapped-incidence')
      add(wedge, 'whole-tax')
      add(wedge / 2, 'half-tax')
      break
    case 'seller_burden':
      add(solution.incidence?.buyersPerUnit.value, 'swapped-incidence')
      add(wedge, 'whole-tax')
      add(wedge / 2, 'half-tax')
      break
    case 'buyer_price':
      add(ps, 'swapped-prices')
      add(p0, 'original-price')
      add(p0 + wedge, 'whole-tax-on-buyers')
      break
    case 'seller_price':
      add(pb, 'swapped-prices')
      add(p0, 'original-price')
      add(p0 - wedge, 'whole-tax-on-sellers')
      break
    case 'cs_after':
      add(solution.after.ps.value, 'swapped-surplus')
      add(2 * v, 'forgot-half')
      add(solution.before.cs?.value, 'before-instead')
      break
    case 'ps_after':
      add(solution.after.cs?.value, 'swapped-surplus')
      add(2 * v, 'forgot-half')
      add(solution.before.ps.value, 'before-instead')
      break
    case 'cs_before':
      add(solution.before.ps.value, 'swapped-surplus')
      add(2 * v, 'forgot-half')
      add(p0 * q0, 'total-revenue')
      break
    case 'ps_before':
      add(solution.before.cs?.value, 'swapped-surplus')
      add(2 * v, 'forgot-half')
      add(p0 * q0, 'total-revenue')
      break
    case 'cs_change':
    case 'ps_change':
      add(-v, 'wrong-sign')
      add(2 * v, 'forgot-half')
      break
    case 'new_quantity':
      add(q0, 'original-quantity')
      add(solution.control?.quantityDemanded.value, 'quantity-demanded')
      add(solution.control?.quantitySupplied.value, 'quantity-supplied')
      add(q1 + (q0 - q1) * 2, 'overshoot')
      break
    case 'new_price':
      add(p0, 'original-price')
      add(ps, 'seller-price')
      add(p0 + (v - p0) * 2, 'overshoot')
      break
    case 'eq_price':
    case 'eq_quantity': {
      const other = target === 'eq_price' ? q0 : p0
      add(other, 'swapped-axes')
      add(v * 2, 'doubled')
      add(v / 2, 'halved')
      break
    }
    case 'shortage':
    case 'excess_supply':
      add(solution.control?.quantityDemanded.value, 'quantity-demanded')
      add(solution.control?.quantitySupplied.value, 'quantity-supplied')
      add(q0, 'original-quantity')
      break
    case 'imports':
    case 'exports':
      add(solution.trade?.quantityDemanded.value, 'quantity-demanded')
      add(solution.trade?.quantitySupplied.value, 'quantity-supplied')
      add(solution.trade?.freeTradeVolume.value, 'free-trade-volume')
      break
    case 'quota_rent':
      add(solution.deadweightLoss?.value, 'dwl-instead')
      add(2 * v, 'doubled')
      add(v / 2, 'halved')
      break
    case 'elasticity_demand':
    case 'elasticity_midpoint':
    case 'elasticity_supply':
      add(v !== 0 ? 1 / v : null, 'reciprocal')
      add(-v, 'sign')
      add(v * 2, 'doubled')
      break
    case 'tr_change':
      add(solution.totalRevenue.after.value, 'level-instead-of-change')
      add(-v, 'wrong-sign')
      break
    default:
      add(v * 2, 'doubled')
      add(v / 2, 'halved')
  }
  return out
}

/**
 * Options for a multiple-choice question on a target: the right value plus
 * wrong values from the common mistakes (then nearby round numbers), all
 * distinct as shown; the right one at a random position.
 */
export function marketChoiceOptions(
  solution: MarketSolution,
  target: MarketValueTarget,
  figure: Pick<MarketFigure, 'priceUnit'>,
  rng: Rng,
  count = 4,
): { options: string[]; correct: number; rules: string[] } | null {
  const value = marketValue(solution, target)
  if (!value) return null
  const allowNegative =
    value.value < 0 || target === 'cs_change' || target === 'ps_change' || target === 'tr_change'
  const shown = formatTargetValue(value, target, figure)
  const texts = new Set([shown])
  const wrong: Array<{ text: string; rule: string }> = []
  const tryAdd = (n: number, rule: string) => {
    if (wrong.length >= count - 1) return
    if (!Number.isFinite(n) || (!allowNegative && n <= 0)) return
    const text = formatTargetValue(mnOf(Number(n.toFixed(4))), target, figure)
    if (text.startsWith('≈') || texts.has(text)) return
    texts.add(text)
    wrong.push({ text, rule })
  }
  for (const item of distractorValues(solution, target)) tryAdd(item.value, item.rule)
  const step = Math.max(1, Math.abs(value.value) * 0.2)
  for (const k of [1, -1, 2, -2, 3, 4]) tryAdd(Math.round(value.value + k * step), 'nearby')
  if (wrong.length < count - 1) return null
  const position = rng.int(0, count - 1)
  const options = wrong.map((item) => item.text)
  const rules = wrong.map((item) => item.rule)
  options.splice(position, 0, shown)
  rules.splice(position, 0, 'correct')
  return { options, correct: position, rules }
}

// --- figure groups (AI mock paper) -----------------------------------------------

export interface MarketGroupSlot {
  id: string
  kind: string
  /** Sub-part labels (non multiple choice), [] when none. */
  parts: Array<{ label: string; marks?: number }>
  marks?: number
  optionCount?: number
}

export interface MarketGroupQuestion {
  slotId: string
  /** The reply as the AI writer would have returned it (checked by `verifyMockQuestion`). */
  raw: {
    stem: string
    parts: Array<{
      label?: string
      prompt: string
      marks?: number
      answer: string
      solution: string
      scheme: string[]
      check: Record<string, unknown> | null
    }>
    options: string[]
    correct: string
  }
  targets: MarketValueTarget[]
}

export interface MarketGroup {
  figure: MarketFigure
  description: string
  questions: MarketGroupQuestion[]
}

const LETTERS = 'ABCDEF'

/** The figure as text (for the question writer and screen readers). */
export function describeFigure(figure: MarketFigure, language: MarketLanguage): string {
  const solution = solveQuestion({ figure })
  const zh = language === 'zh'
  const unit = figure.priceUnit ?? '$'
  const lines = [curveText(figure.spec, language)]
  if (solution) {
    lines.push(
      zh
        ? `原均衡：Q = ${formatMarketNumber(solution.original.q)}，P = ${unit}${formatMarketNumber(solution.original.p)}。`
        : `Original equilibrium: Q = ${formatMarketNumber(solution.original.q)}, P = ${unit}${formatMarketNumber(solution.original.p)}.`,
    )
    const change = scenarioSentence(
      figure.spec,
      language,
      { en: 'the good', zh: '该商品' },
      {},
      true,
    )
    if (change) lines.push(change)
    if (figure.show === 'after' && solution.scenario !== 'equilibrium')
      lines.push(
        zh
          ? `图中标出变化后的结果：Q = ${formatMarketNumber(solution.outcome.q)}${solution.buyerPrice ? `，买方价格 ${unit}${formatMarketNumber(solution.buyerPrice)}` : ''}${solution.sellerPrice ? `，卖方价格 ${unit}${formatMarketNumber(solution.sellerPrice)}` : ''}。`
          : `The figure marks the outcome: Q = ${formatMarketNumber(solution.outcome.q)}${solution.buyerPrice ? `, buyers' price ${unit}${formatMarketNumber(solution.buyerPrice)}` : ''}${solution.sellerPrice ? `, sellers' price ${unit}${formatMarketNumber(solution.sellerPrice)}` : ''}.`,
      )
  }
  if (figure.quantityScale === 'thousands') lines.push(scaleNote('thousands', language).trim())
  return lines.join(zh ? '' : ' ')
}

/**
 * One shared figure for an AI mock paper's figure group, and every slot's
 * question about it (different targets): multiple choice from the distractor
 * rules, numeric parts with an exact `check`. All answers from the engine.
 */
export function buildMarketFigureGroup(input: {
  topicName: string
  slots: readonly MarketGroupSlot[]
  language: MarketLanguage
  rng: Rng
}): MarketGroup | null {
  const { slots, language, rng } = input
  const families = familiesForTopic(input.topicName) ?? ['tax']
  const usable = families.filter((family) => family !== 'both_shift' && family !== 'surplus')
  const family = usable.length ? rng.pick(usable) : 'tax'
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const market = generateMarket(family, rng)
    const figure: MarketFigure = {
      spec: market.spec,
      show: 'after',
      priceUnit: '$',
    }
    const solution = market.solution
    const targets = rng.shuffle(
      // The original equilibrium reads well on any figure; other surplus
      // questions would be ambiguous (before or after the change?).
      [...TARGETS[family], 'eq_price' as const, 'eq_quantity' as const].filter(
        (target) => friendly(marketValue(solution, target)) && marketValue(solution, target),
      ),
    )
    // Distinct targets, as many as the group needs (parts included).
    const needed = slots.reduce((sum, slot) => sum + Math.max(1, slot.parts.length), 0)
    if (targets.length < needed) continue
    const queue = [...targets]
    const questions: MarketGroupQuestion[] = []
    let failed = false
    for (const slot of slots) {
      const multipleChoice = slot.kind === 'multiple_choice' && slot.parts.length < 2
      if (multipleChoice) {
        const target = queue.shift()!
        const choice = marketChoiceOptions(
          solution,
          target,
          figure,
          rng,
          Math.min(6, Math.max(3, slot.optionCount ?? 4)),
        )
        if (!choice) {
          failed = true
          break
        }
        const noun = TARGET_NOUN[target][language]
        const value = marketValue(solution, target)!
        questions.push({
          slotId: slot.id,
          targets: [target],
          raw: {
            stem: '',
            parts: [
              {
                prompt: language === 'zh' ? `根据上图，${noun}：` : `Refer to the figure. ${noun}:`,
                ...(slot.marks ? { marks: slot.marks } : {}),
                answer: '',
                solution: `${noun} ${formatTargetValue(value, target, figure)}${language === 'zh' ? '。' : '.'}`,
                scheme: [
                  language === 'zh'
                    ? `B${slot.marks ?? 1} ${formatTargetValue(value, target, figure)}`
                    : `B${slot.marks ?? 1} ${formatTargetValue(value, target, figure)}`,
                ],
                check: null,
              },
            ],
            options: choice.options,
            correct: LETTERS[choice.correct]!,
          },
        })
        continue
      }
      const labels = slot.parts.length ? slot.parts : [{ label: '', marks: slot.marks }]
      const parts: MarketGroupQuestion['raw']['parts'] = []
      const used: MarketValueTarget[] = []
      for (const part of labels) {
        const target = queue.shift()!
        used.push(target)
        const value = marketValue(solution, target)!
        parts.push({
          ...(part.label ? { label: part.label } : {}),
          prompt: TARGET_ASK[target][language],
          ...(part.marks ? { marks: part.marks } : {}),
          answer: formatTargetValue(value, target, figure),
          solution: `${TARGET_NOUN[target][language]} ${formatTargetValue(value, target, figure)}${language === 'zh' ? '。' : '.'}`,
          scheme: [`A${part.marks ?? 1} ${formatTargetValue(value, target, figure)}`],
          check: {
            type: 'numeric',
            expression: exactDecimal(value),
            unit: '',
            ...(target === 'elasticity_demand' || target === 'elasticity_midpoint'
              ? { absolute: true }
              : {}),
          },
        })
      }
      questions.push({
        slotId: slot.id,
        targets: used,
        raw: {
          stem: language === 'zh' ? '根据上图回答：' : 'Refer to the figure.',
          parts,
          options: [],
          correct: '',
        },
      })
    }
    if (failed) continue
    return { figure, description: describeFigure(figure, language), questions }
  }
  return null
}
