import { providerHeaders, redactUrl, sanitizeProviderText } from './openaiCompatible'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Why the model list could not be fetched. The settings page keeps the model
 * field as free text in every case and explains the reason.
 */
export type ModelListFailure =
  /** The browser blocked the request (CORS) or the network is down. */
  | 'blocked'
  /** The key was rejected (401 / 403). */
  | 'auth'
  /** The provider has no `/models` endpoint (404 / 405). */
  | 'unsupported'
  /** Any other HTTP error or an unreadable body. */
  | 'failed'
  /** Base URL or key missing. */
  | 'missing-config'

export type ModelListResult =
  | {
      ok: true
      models: string[]
      /** Output limits by model id, for the models whose metadata states one. */
      limits: Record<string, number>
    }
  | { ok: false; reason: ModelListFailure; status?: number; message?: string }

/** `{base}/models`, tolerating a base that already ends in `/chat/completions`. */
export function modelsEndpoint(baseURL: string): string {
  const base = baseURL
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
  return `${base}/models`
}

/**
 * Parse an OpenAI-compatible `/models` body: `{ data: [{ id }] }`. Also accepts
 * a bare array and `{ models: [...] }` (some gateways), with `id` or `name`.
 * Returns sorted unique ids, or null when the shape is not recognised.
 */
export function parseModelList(json: unknown): string[] | null {
  const root = json as Record<string, unknown> | unknown[] | null
  const list = Array.isArray(root)
    ? root
    : root && typeof root === 'object'
      ? Array.isArray(root.data)
        ? root.data
        : Array.isArray(root.models)
          ? root.models
          : null
      : null
  if (!list) return null
  const ids = new Set<string>()
  for (const entry of list) {
    const id =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? ((entry as Record<string, unknown>).id ?? (entry as Record<string, unknown>).name)
          : undefined
    if (typeof id === 'string' && id.trim()) ids.add(id.trim())
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

/** Output-limit fields some `/models` bodies carry (never a context length). */
const OUTPUT_LIMIT_FIELDS = [
  'max_output_tokens',
  'max_completion_tokens',
  'output_token_limit',
  'outputTokenLimit',
] as const

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/**
 * Output limits from a `/models` body, by model id: `max_output_tokens`,
 * `max_completion_tokens`, `output_token_limit` / `outputTokenLimit`, or
 * OpenRouter's `top_provider.max_completion_tokens`. `context_length` and
 * other context fields are ignored on purpose — the input window says
 * nothing reliable about how much one reply may hold.
 */
export function parseModelOutputLimits(json: unknown): Record<string, number> {
  const root = json as Record<string, unknown> | unknown[] | null
  const list = Array.isArray(root)
    ? root
    : root && typeof root === 'object'
      ? Array.isArray(root.data)
        ? root.data
        : Array.isArray(root.models)
          ? root.models
          : []
      : []
  const limits: Record<string, number> = {}
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : typeof row.name === 'string' ? row.name : ''
    if (!id.trim()) continue
    let limit: number | undefined
    for (const field of OUTPUT_LIMIT_FIELDS) {
      limit = positiveInt(row[field])
      if (limit) break
    }
    if (!limit && row.top_provider && typeof row.top_provider === 'object')
      limit = positiveInt((row.top_provider as Record<string, unknown>).max_completion_tokens)
    if (limit) limits[id.trim()] = limit
  }
  return limits
}

/**
 * `GET {base}/models` with the same headers chat requests use. Never throws;
 * the key is never logged (only origin + path of the URL).
 */
export async function fetchModelList(
  input: { baseURL: string; apiKey: string },
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<ModelListResult> {
  if (!input.baseURL.trim() || !input.apiKey.trim()) return { ok: false, reason: 'missing-config' }
  const url = modelsEndpoint(input.baseURL)
  const doFetch = options.fetchImpl ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 15_000)
  const onAbort = (): void => ctrl.abort()
  options.signal?.addEventListener('abort', onAbort)
  try {
    let res: Response
    try {
      res = await doFetch(url, {
        method: 'GET',
        headers: providerHeaders(input.apiKey.trim()),
        signal: ctrl.signal,
      })
    } catch (err) {
      // A CORS rejection surfaces as a bare TypeError, indistinguishable from
      // being offline: report both as "blocked".
      logger.info('Model list request blocked', {
        url: redactUrl(url),
        errorName: err instanceof Error ? err.name : typeof err,
      })
      return { ok: false, reason: 'blocked' }
    }
    if (!res.ok) {
      const reason: ModelListFailure =
        res.status === 401 || res.status === 403
          ? 'auth'
          : res.status === 404 || res.status === 405
            ? 'unsupported'
            : 'failed'
      const text = await res.text().catch(() => '')
      const message = text ? sanitizeProviderText(text.trim()) : undefined
      logger.info('Model list request failed', { url: redactUrl(url), status: res.status })
      return { ok: false, reason, status: res.status, ...(message ? { message } : {}) }
    }
    const json = await res.json().catch(() => null)
    const models = parseModelList(json)
    if (!models) return { ok: false, reason: 'failed', status: res.status }
    return { ok: true, models, limits: parseModelOutputLimits(json) }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
