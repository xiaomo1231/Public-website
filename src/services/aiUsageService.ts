import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { TokenUsage } from '@/infrastructure/ai/types'
import { queryBalance, type BalanceResult } from '@/infrastructure/ai/balance'
import { logger } from '@/infrastructure/logger/logger'
import {
  addUsage,
  normalizePrices,
  type AIUsageKind,
  type AIUsagePrices,
  type AIUsageStore,
} from '@/entities/aiUsage/types'
import type { AISettings } from '@/entities/settings/types'
import { setAIUsageSink } from './aiService'

/**
 * Local AI usage statistics and the provider balance lookup.
 *
 * Counters live on the AI settings row (`AISettingsRow.usage`), updated in a
 * read-modify-write transaction so concurrent responses never lose a count.
 * Settings saves preserve them (`SettingsRepository.putRow`). They hold token
 * counts only — never content, never keys.
 */

type Listener = () => void
const listeners = new Set<Listener>()

/** Notified after usage is recorded or reset (readouts refresh). */
export function subscribeAIUsage(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      /* a broken listener must not stop the others */
    }
  }
}

export interface AIUsageSnapshot {
  usage: AIUsageStore | undefined
  prices: AIUsagePrices | null
}

export class AIUsageService {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  /**
   * Add one response. Without a settings row there is no configured provider
   * (and so no real request): nothing is recorded.
   */
  async record(
    kind: AIUsageKind,
    usage: TokenUsage | undefined,
    at: Date = new Date(),
  ): Promise<void> {
    await this.db.transaction('rw', this.db.settings, async () => {
      const row = await this.db.settings.get('singleton')
      if (!row) return
      const next = addUsage(
        row.usage,
        kind,
        usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              ...(usage.cachedTokens !== undefined ? { cachedTokens: usage.cachedTokens } : {}),
            }
          : undefined,
        at,
      )
      await this.db.settings.update('singleton', { usage: next })
    })
    notify()
  }

  async snapshot(): Promise<AIUsageSnapshot> {
    const row = await this.db.settings.get('singleton')
    return { usage: row?.usage, prices: normalizePrices(row?.usagePrices) }
  }

  /** Clear every month's counters. */
  async reset(): Promise<void> {
    await this.db.transaction('rw', this.db.settings, async () => {
      const row = await this.db.settings.get('singleton')
      if (!row?.usage) return
      const next = { ...row }
      delete next.usage
      await this.db.settings.put(next)
    })
    notify()
  }
}

/** Provider balance / spend for the given settings. Never throws. */
export async function queryProviderBalance(
  settings: Pick<AISettings, 'provider' | 'baseURL' | 'apiKey' | 'adminApiKey'>,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; now?: Date } = {},
): Promise<BalanceResult> {
  return queryBalance({
    provider: settings.provider,
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    ...(settings.adminApiKey ? { adminApiKey: settings.adminApiKey } : {}),
    ...options,
  })
}

/**
 * Route every AIService response into the local statistics. Called once at
 * app start; writes are fire-and-forget and failures are only logged.
 */
export function installAIUsageRecording(service?: AIUsageService): void {
  const svc = service ?? null
  setAIUsageSink((kind, usage) => {
    void (svc ?? new AIUsageService()).record(kind, usage).catch((err: unknown) => {
      logger.debug('Recording AI usage failed', {
        errorName: err instanceof Error ? err.name : typeof err,
      })
    })
  })
}
