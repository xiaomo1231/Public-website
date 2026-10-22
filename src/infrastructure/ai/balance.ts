import type { AIProviderId } from '@/entities/settings/types'
import { providerHeaders, redactUrl } from './openaiCompatible'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Provider balance / spend queries behind a small registry.
 *
 * Only endpoints confirmed in the provider's public documentation are
 * registered:
 *  - DeepSeek `GET {origin}/user/balance` with the API key
 *    (api-docs.deepseek.com/api/get-user-balance).
 *  - OpenAI `GET https://api.openai.com/v1/organization/costs` with an
 *    **admin** key (`sk-admin-…`): money spent this month, never a balance.
 *
 * Everything else (Qwen, MiniMax / Token Plan, MiMo, custom) has no registered
 * adapter: the UI shows local usage and, when the user entered prices, an
 * estimate. Nothing here is guessed.
 */

export interface BalanceQuery {
  provider: AIProviderId
  baseURL: string
  apiKey: string
  /** OpenAI admin key; used ONLY for the organization costs endpoint. */
  adminApiKey?: string
  now?: Date
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export interface BalanceEntry {
  currency: string
  total: number
  granted?: number
  toppedUp?: number
}

export type BalanceResult =
  | {
      status: 'ok'
      kind: 'balance'
      source: 'deepseek'
      /** Provider says the balance is enough to make calls. */
      available: boolean
      entries: BalanceEntry[]
    }
  | {
      status: 'ok'
      kind: 'spent'
      source: 'openai-costs'
      currency: string
      amount: number
      /** Start of the period (ms), the first day of this month. */
      since: number
    }
  /** No documented endpoint for this provider: fall back to local usage. */
  | { status: 'unsupported' }
  /** OpenAI without an admin key: only local usage is available. */
  | { status: 'needs-admin-key' }
  | {
      status: 'error'
      /** `blocked` = CORS / network: the provider does not allow browser queries. */
      reason: 'blocked' | 'auth' | 'failed'
      httpStatus?: number
    }

export interface BalanceAdapter {
  id: 'deepseek' | 'openai-costs'
  matches(q: BalanceQuery): boolean
  query(q: BalanceQuery): Promise<BalanceResult>
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function toNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

async function getJSON(
  url: string,
  key: string,
  q: BalanceQuery,
): Promise<{ ok: true; json: unknown } | { ok: false; result: BalanceResult }> {
  const doFetch = q.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(url, {
      method: 'GET',
      headers: providerHeaders(key),
      ...(q.signal ? { signal: q.signal } : {}),
    })
  } catch (err) {
    logger.info('Balance request blocked', {
      url: redactUrl(url),
      errorName: err instanceof Error ? err.name : typeof err,
    })
    return { ok: false, result: { status: 'error', reason: 'blocked' } }
  }
  if (!res.ok) {
    logger.info('Balance request failed', { url: redactUrl(url), status: res.status })
    return {
      ok: false,
      result: {
        status: 'error',
        reason: res.status === 401 || res.status === 403 ? 'auth' : 'failed',
        httpStatus: res.status,
      },
    }
  }
  const json = await res.json().catch(() => undefined)
  if (json === undefined) {
    return { ok: false, result: { status: 'error', reason: 'failed', httpStatus: res.status } }
  }
  return { ok: true, json }
}

/** `https://api.deepseek.com/v1` → `https://api.deepseek.com/user/balance`. */
export function deepseekBalanceUrl(baseURL: string): string {
  const base = baseURL
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/v1$/, '')
  return `${base}/user/balance`
}

/**
 * Parse DeepSeek's balance body (documented shape):
 * `{ is_available: boolean, balance_infos: [{ currency, total_balance,
 * granted_balance, topped_up_balance }] }` — amounts are decimal strings.
 */
export function parseDeepSeekBalance(json: unknown): BalanceResult {
  const root = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const infos = Array.isArray(root.balance_infos) ? root.balance_infos : null
  if (!infos) return { status: 'error', reason: 'failed' }
  const entries: BalanceEntry[] = []
  for (const raw of infos) {
    if (!raw || typeof raw !== 'object') continue
    const info = raw as Record<string, unknown>
    const total = toNumber(info.total_balance)
    if (total === undefined || typeof info.currency !== 'string') continue
    const granted = toNumber(info.granted_balance)
    const toppedUp = toNumber(info.topped_up_balance)
    entries.push({
      currency: info.currency,
      total,
      ...(granted !== undefined ? { granted } : {}),
      ...(toppedUp !== undefined ? { toppedUp } : {}),
    })
  }
  return {
    status: 'ok',
    kind: 'balance',
    source: 'deepseek',
    available: root.is_available !== false,
    entries,
  }
}

const deepseekAdapter: BalanceAdapter = {
  id: 'deepseek',
  matches: (q) => q.provider === 'deepseek' || hostOf(q.baseURL) === 'api.deepseek.com',
  async query(q) {
    const got = await getJSON(deepseekBalanceUrl(q.baseURL), q.apiKey, q)
    return got.ok ? parseDeepSeekBalance(got.json) : got.result
  },
}

/** The admin key is only ever sent here, never to a user-supplied base URL. */
export const OPENAI_COSTS_URL = 'https://api.openai.com/v1/organization/costs'

export function monthStartSeconds(now: Date): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
}

/**
 * Sum one page of the Costs API: `{ data: [{ results: [{ amount: { value,
 * currency } }] }], next_page }` (shape per OpenAI's usage-API cookbook).
 */
export function parseOpenAICostsPage(json: unknown): {
  amount: number
  currency: string
  nextPage: string | null
} | null {
  const root = (json && typeof json === 'object' ? json : null) as Record<string, unknown> | null
  if (!root || !Array.isArray(root.data)) return null
  let amount = 0
  let currency = 'usd'
  for (const bucket of root.data) {
    const results = (bucket as Record<string, unknown> | null)?.results
    if (!Array.isArray(results)) continue
    for (const result of results) {
      const value = (result as Record<string, unknown> | null)?.amount as
        Record<string, unknown> | undefined
      const n = toNumber(value?.value)
      if (n === undefined) continue
      amount += n
      if (typeof value?.currency === 'string') currency = value.currency
    }
  }
  const next = root.next_page
  return { amount, currency, nextPage: typeof next === 'string' && next ? next : null }
}

const MAX_COST_PAGES = 5

const openaiCostsAdapter: BalanceAdapter = {
  id: 'openai-costs',
  matches: (q) => q.provider === 'openai' || hostOf(q.baseURL) === 'api.openai.com',
  async query(q) {
    const adminKey = q.adminApiKey?.trim()
    if (!adminKey) return { status: 'needs-admin-key' }
    const now = q.now ?? new Date()
    const start = monthStartSeconds(now)
    let amount = 0
    let currency = 'usd'
    let page: string | null = null
    for (let i = 0; i < MAX_COST_PAGES; i += 1) {
      const params = new URLSearchParams({
        start_time: String(start),
        bucket_width: '1d',
        limit: '31',
      })
      if (page) params.set('page', page)
      const got = await getJSON(`${OPENAI_COSTS_URL}?${params.toString()}`, adminKey, q)
      if (!got.ok) return got.result
      const parsed = parseOpenAICostsPage(got.json)
      if (!parsed) return { status: 'error', reason: 'failed' }
      amount += parsed.amount
      currency = parsed.currency
      page = parsed.nextPage
      if (!page) break
    }
    return {
      status: 'ok',
      kind: 'spent',
      source: 'openai-costs',
      currency: currency.toUpperCase(),
      amount,
      since: start * 1000,
    }
  },
}

export const BALANCE_ADAPTERS: readonly BalanceAdapter[] = [deepseekAdapter, openaiCostsAdapter]

export function balanceAdapterFor(
  q: Pick<BalanceQuery, 'provider' | 'baseURL'>,
): BalanceAdapter | null {
  return BALANCE_ADAPTERS.find((a) => a.matches(q as BalanceQuery)) ?? null
}

/** Query the provider's balance or spend. Never throws. */
export async function queryBalance(q: BalanceQuery): Promise<BalanceResult> {
  const adapter = balanceAdapterFor(q)
  if (!adapter) return { status: 'unsupported' }
  if (adapter.id === 'deepseek' && !q.apiKey.trim()) return { status: 'unsupported' }
  try {
    return await adapter.query(q)
  } catch (err) {
    logger.info('Balance query failed', {
      adapter: adapter.id,
      errorName: err instanceof Error ? err.name : typeof err,
    })
    return { status: 'error', reason: 'failed' }
  }
}
