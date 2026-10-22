import type { BalanceResult } from '@/infrastructure/ai/balance'
import {
  estimateCost,
  monthKey,
  monthTotal,
  type AIUsagePrices,
  type AIUsageStore,
} from '@/entities/aiUsage/types'
import {
  LOCALE_TAGS,
  getUILanguage,
  translate,
  type TranslationKey,
  type TranslationParams,
  type UILanguage,
} from '@/i18n'

/** 1234 → "1.2K" (en) / "1234" → "1234"; compact token counts. */
export function formatTokens(value: number, language: UILanguage = getUILanguage()): string {
  return new Intl.NumberFormat(LOCALE_TAGS[language], {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

/**
 * Decimals for a set of amounts shown together (a table column): 4 when any
 * non-zero amount is below one cent, so small costs do not read as 0.00;
 * otherwise 2. Every amount of the set then uses the same count.
 */
export function moneyDigits(amounts: readonly number[]): number {
  return amounts.some((amount) => amount !== 0 && Math.abs(amount) < 0.01) ? 4 : 2
}

/**
 * A money amount in the given ISO currency (CNY → ¥, USD → $). `digits` fixes
 * the decimals (from `moneyDigits`) so amounts shown together line up.
 */
export function formatMoney(
  amount: number,
  currency: string,
  language: UILanguage = getUILanguage(),
  digits: number = moneyDigits([amount]),
): string {
  try {
    return new Intl.NumberFormat(LOCALE_TAGS[language], {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
  } catch {
    return `${amount.toFixed(digits)} ${currency}`
  }
}

/**
 * The one-line readout for the sidebar footer / account menu: the provider's
 * balance or this month's spend when available, otherwise this month's local
 * token count (plus an estimate when prices are set).
 */
export function usageReadout(input: {
  balance: BalanceResult | null
  usage: AIUsageStore | undefined
  prices: AIUsagePrices | null
  unconfigured: boolean
  now?: Date
  language?: UILanguage
}): string {
  const language = input.language ?? getUILanguage()
  const tr = (key: TranslationKey, params?: TranslationParams) => translate(language, key, params)
  if (input.unconfigured) return tr('usage.readout.unconfigured')
  const b = input.balance
  if (b?.status === 'ok' && b.kind === 'balance' && b.entries[0]) {
    const e = b.entries[0]
    return tr('usage.readout.balance', { amount: formatMoney(e.total, e.currency, language) })
  }
  if (b?.status === 'ok' && b.kind === 'spent') {
    return tr('usage.readout.spent', { amount: formatMoney(b.amount, b.currency, language) })
  }
  const total = monthTotal(input.usage, monthKey(input.now ?? new Date()))
  const tokens = tr('usage.readout.tokens', {
    tokens: formatTokens(total.promptTokens + total.completionTokens, language),
  })
  if (!input.prices) return tokens
  const cost = formatMoney(estimateCost(total, input.prices), input.prices.currency, language)
  return `${tokens} · ${tr('usage.readout.estimate', { amount: cost })}`
}

/** The status line about the provider's balance / spend. */
export function balanceMessage(
  balance: BalanceResult | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): { text: string; detail?: string; tone: 'ok' | 'info' | 'warn' } | null {
  if (!balance) return null
  switch (balance.status) {
    case 'ok':
      if (balance.kind === 'balance') {
        const first = balance.entries[0]
        if (!first) return { text: t('usage.balance.failed'), tone: 'warn' }
        const amounts = balance.entries.map((e) => formatMoney(e.total, e.currency)).join(' · ')
        const detail =
          first.granted !== undefined && first.toppedUp !== undefined
            ? t('usage.balance.detail', {
                granted: formatMoney(first.granted, first.currency),
                toppedUp: formatMoney(first.toppedUp, first.currency),
              })
            : undefined
        return {
          text: balance.available
            ? t('usage.balance.line', { amount: amounts })
            : `${t('usage.balance.line', { amount: amounts })} — ${t('usage.balance.unavailable')}`,
          ...(detail ? { detail } : {}),
          tone: balance.available ? 'ok' : 'warn',
        }
      }
      return {
        text: t('usage.balance.spentLine', {
          amount: formatMoney(balance.amount, balance.currency),
        }),
        tone: 'ok',
      }
    case 'unsupported':
      return { text: t('usage.balance.unsupported'), tone: 'info' }
    case 'needs-admin-key':
      return { text: t('usage.balance.needsAdminKey'), tone: 'info' }
    case 'error':
      if (balance.reason === 'blocked') return { text: t('usage.balance.blocked'), tone: 'warn' }
      if (balance.reason === 'auth') {
        return {
          text: t('usage.balance.auth', { status: balance.httpStatus ?? '' }),
          tone: 'warn',
        }
      }
      return { text: t('usage.balance.failed'), tone: 'warn' }
  }
}
