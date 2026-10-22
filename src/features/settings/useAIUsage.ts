import { useCallback, useEffect, useRef, useState } from 'react'
import type { BalanceResult } from '@/infrastructure/ai/balance'
import type { AISettings } from '@/entities/settings/types'
import {
  AIUsageService,
  queryProviderBalance,
  subscribeAIUsage,
  type AIUsageSnapshot,
} from '@/services/aiUsageService'
import { useAISettings } from './useAISettings'

/** A balance answer is reused for this long before asking the provider again. */
const BALANCE_TTL_MS = 30_000

interface BalanceCacheEntry {
  key: string
  at: number
  promise: Promise<BalanceResult>
}

let balanceCache: BalanceCacheEntry | null = null

/** Test seam. */
export function clearBalanceCacheForTesting(): void {
  balanceCache = null
}

/** Identifies the settings a cached answer belongs to (no secrets in it). */
function cacheKey(s: AISettings): string {
  return `${s.provider}|${s.baseURL}|${s.updatedAt}|${s.adminApiKey ? 1 : 0}`
}

function loadBalance(settings: AISettings, force: boolean): Promise<BalanceResult> {
  const key = cacheKey(settings)
  const now = Date.now()
  if (
    !force &&
    balanceCache &&
    balanceCache.key === key &&
    now - balanceCache.at < BALANCE_TTL_MS
  ) {
    return balanceCache.promise
  }
  const promise = queryProviderBalance(settings)
  balanceCache = { key, at: now, promise }
  return promise
}

export interface AIUsageState {
  snapshot: AIUsageSnapshot | null
  balance: BalanceResult | null
  balanceLoading: boolean
  /** True when no API key is configured. */
  unconfigured: boolean
  refresh: () => void
  reset: () => Promise<void>
}

/**
 * Local usage counters plus the provider's balance / spend. Reloads when the
 * component mounts (e.g. the account menu opens) and after every recorded AI
 * response; the balance query is throttled.
 */
export function useAIUsage(): AIUsageState {
  const { settings } = useAISettings()
  const [snapshot, setSnapshot] = useState<AIUsageSnapshot | null>(null)
  const [balance, setBalance] = useState<BalanceResult | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const alive = useRef(true)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const loadSnapshot = useCallback(() => {
    void new AIUsageService()
      .snapshot()
      .then((next) => {
        if (alive.current) setSnapshot(next)
      })
      .catch(() => {
        /* the readout simply stays empty */
      })
  }, [])

  /** Only the latest balance request may update the readout. */
  const balanceSeq = useRef(0)
  const refreshBalance = useCallback((force: boolean) => {
    const seq = ++balanceSeq.current
    const current = settingsRef.current
    if (!current?.apiKey.trim()) {
      setBalance(null)
      setBalanceLoading(false)
      return
    }
    setBalanceLoading(true)
    void loadBalance(current, force)
      .then((result) => {
        if (alive.current && seq === balanceSeq.current) setBalance(result)
      })
      .catch(() => {
        /* the readout falls back to local counts */
      })
      .finally(() => {
        if (alive.current && seq === balanceSeq.current) setBalanceLoading(false)
      })
  }, [])

  useEffect(() => {
    alive.current = true
    loadSnapshot()
    const unsubscribe = subscribeAIUsage(() => {
      loadSnapshot()
      refreshBalance(false)
    })
    return () => {
      alive.current = false
      unsubscribe()
    }
  }, [loadSnapshot, refreshBalance])

  const settingsKey = settings ? cacheKey(settings) : ''
  useEffect(() => {
    refreshBalance(false)
  }, [settingsKey, refreshBalance])

  const refresh = useCallback(() => {
    loadSnapshot()
    refreshBalance(true)
  }, [loadSnapshot, refreshBalance])

  const reset = useCallback(async () => {
    await new AIUsageService().reset()
    loadSnapshot()
  }, [loadSnapshot])

  return {
    snapshot,
    balance,
    balanceLoading,
    unconfigured: Boolean(settings) && !settings?.apiKey.trim(),
    refresh,
    reset,
  }
}
