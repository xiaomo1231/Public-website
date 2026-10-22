import { useState } from 'react'
import { Eye, EyeOff, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import {
  AI_USAGE_KINDS,
  estimateCost,
  monthBreakdown,
  monthKey,
  previousMonthKey,
  sumBuckets,
  type AIUsageBucket,
  type AIUsagePrices,
} from '@/entities/aiUsage/types'
import type { AISettings } from '@/entities/settings/types'
import { useAIUsage } from '@/features/settings/useAIUsage'
import { useUsageReadoutPreference } from '@/features/settings/usageReadoutPreference'
import { toast } from '@/features/toast/toastStore'
import { formatNumber, useTranslation, type TranslationKey } from '@/i18n'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { cn } from '@/shared/lib/utils'
import { balanceMessage, formatMoney, moneyDigits } from './usageFormat'

function UsageTable({
  buckets,
  prices,
}: {
  buckets: Record<(typeof AI_USAGE_KINDS)[number], AIUsageBucket>
  prices: AIUsagePrices | null
}): JSX.Element {
  const { t } = useTranslation()
  const rows = AI_USAGE_KINDS.filter((kind) => buckets[kind].requests > 0)
  const total = sumBuckets(Object.values(buckets))
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('usage.empty')}</p>
  }
  const cell = 'whitespace-nowrap px-2 py-1.5 text-right tabular-nums lab:font-mono'
  // One decimal count for the whole column (and its total), so ¥0.0031 and
  // ¥1.20 are not mixed with ¥1.2.
  const digits = prices
    ? moneyDigits([
        ...rows.map((kind) => estimateCost(buckets[kind], prices)),
        estimateCost(total, prices),
      ])
    : 2
  const cost = (b: AIUsageBucket): string =>
    prices ? formatMoney(estimateCost(b, prices), prices.currency, undefined, digits) : ''
  return (
    <div>
      {/* Fits its column: no scroll box inside the page. */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-1.5 text-left font-medium">
              {t('usage.col.kind')}
            </th>
            <th scope="col" className={cn(cell, 'font-medium')}>
              {t('usage.col.requests')}
            </th>
            <th scope="col" className={cn(cell, 'font-medium')}>
              {t('usage.col.input')}
            </th>
            <th scope="col" className={cn(cell, 'font-medium')}>
              {t('usage.col.cached')}
            </th>
            <th scope="col" className={cn(cell, 'font-medium')}>
              {t('usage.col.output')}
            </th>
            {prices && (
              <th scope="col" className={cn(cell, 'font-medium')}>
                {t('usage.col.cost')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((kind) => {
            const b = buckets[kind]
            return (
              <tr key={kind} className="border-b border-border/60">
                <th scope="row" className="break-words px-2 py-1.5 text-left font-normal">
                  {t(`usage.kind.${kind}` as TranslationKey)}
                </th>
                <td className={cell}>{formatNumber(b.requests)}</td>
                <td className={cell}>{formatNumber(b.promptTokens)}</td>
                <td className={cell}>{formatNumber(b.cachedTokens)}</td>
                <td className={cell}>{formatNumber(b.completionTokens)}</td>
                {prices && <td className={cell}>{cost(b)}</td>}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <th scope="row" className="px-2 py-1.5 text-left">
              {t('usage.total')}
            </th>
            <td className={cell}>{formatNumber(total.requests)}</td>
            <td className={cell}>{formatNumber(total.promptTokens)}</td>
            <td className={cell}>{formatNumber(total.cachedTokens)}</td>
            <td className={cell}>{formatNumber(total.completionTokens)}</td>
            {prices && <td className={cell}>{cost(total)}</td>}
          </tr>
        </tfoot>
      </table>
      {total.missingUsage > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('usage.missing', { count: total.missingUsage })}
        </p>
      )}
      {prices && <p className="mt-1 text-xs text-muted-foreground">{t('usage.estimateNote')}</p>}
    </div>
  )
}

export interface UsagePanelProps {
  /** The unsaved settings draft (prices and admin key are saved with Save). */
  draft: AISettings
  patch: <K extends keyof AISettings>(key: K, value: AISettings[K]) => void
}

/**
 * Settings → AI usage & balance: provider balance (or why it is unavailable),
 * this month / last month by request kind, reset, and the optional prices and
 * OpenAI admin key.
 */
export function UsagePanel({ draft, patch }: UsagePanelProps): JSX.Element {
  const { t } = useTranslation()
  const { snapshot, balance, balanceLoading, refresh, reset } = useAIUsage()
  const readout = useUsageReadoutPreference()
  const [month, setMonth] = useState<'this' | 'last'>('this')
  const [confirmReset, setConfirmReset] = useState(false)
  const [showAdminKey, setShowAdminKey] = useState(false)
  const key = month === 'this' ? monthKey() : previousMonthKey()
  const buckets = monthBreakdown(snapshot?.usage, key)
  const message = balanceMessage(balance, t)
  const prices = draft.usagePrices

  function setPrice(
    field: 'inputPerMillion' | 'outputPerMillion' | 'cachedInputPerMillion',
    raw: string,
  ) {
    const base: AIUsagePrices = prices ?? {
      inputPerMillion: 0,
      outputPerMillion: 0,
      currency: 'CNY',
    }
    const next: AIUsagePrices = { ...base }
    if (field === 'cachedInputPerMillion' && raw.trim() === '') delete next.cachedInputPerMillion
    else next[field] = Math.max(0, Number(raw) || 0)
    patch('usagePrices', next)
  }

  return (
    <div className="space-y-4">
      {/* Applies at once; not part of the settings Save button. */}
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
          data-usage-readout-toggle
          checked={readout.visible}
          onChange={(event) => readout.setVisible(event.target.checked)}
        />
        <span>
          <span className="font-medium">{t('usage.readout.toggle')}</span>
          <span className="block text-xs text-muted-foreground">
            {t('usage.readout.toggleHint')}
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5 text-sm" aria-live="polite">
          {balanceLoading && !message ? (
            <p className="text-muted-foreground">{t('usage.balance.loading')}</p>
          ) : message ? (
            <>
              <p
                className={cn(
                  message.tone === 'ok' && 'font-medium',
                  message.tone === 'info' && 'text-muted-foreground',
                  message.tone === 'warn' && 'text-amber-700 dark:text-amber-400',
                )}
              >
                {message.text}
              </p>
              {message.detail && <p className="text-xs text-muted-foreground">{message.detail}</p>}
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            {balanceLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {t('usage.refresh')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t('usage.reset')}
          </Button>
        </div>
      </div>

      <div role="group" aria-label={t('usage.title')} className="flex gap-1">
        {(['this', 'last'] as const).map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={month === m ? 'default' : 'ghost'}
            aria-pressed={month === m}
            onClick={() => setMonth(m)}
          >
            {m === 'this' ? t('usage.thisMonth') : t('usage.lastMonth')}
          </Button>
        ))}
      </div>
      <UsageTable buckets={buckets} prices={snapshot?.prices ?? null} />

      <fieldset className="space-y-2 border-t pt-4">
        <legend className="text-sm font-medium">{t('usage.prices.title')}</legend>
        <p className="text-xs text-muted-foreground">{t('usage.prices.hint')}</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="price-input">{t('usage.prices.input')}</Label>
            <Input
              id="price-input"
              type="number"
              min={0}
              step="0.01"
              value={prices?.inputPerMillion ?? ''}
              onChange={(e) => setPrice('inputPerMillion', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="price-cached">{t('usage.prices.cached')}</Label>
            <Input
              id="price-cached"
              type="number"
              min={0}
              step="0.01"
              value={prices?.cachedInputPerMillion ?? ''}
              onChange={(e) => setPrice('cachedInputPerMillion', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="price-output">{t('usage.prices.output')}</Label>
            <Input
              id="price-output"
              type="number"
              min={0}
              step="0.01"
              value={prices?.outputPerMillion ?? ''}
              onChange={(e) => setPrice('outputPerMillion', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="price-currency">{t('usage.prices.currency')}</Label>
            <select
              id="price-currency"
              className="focus-ring h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={prices?.currency ?? 'CNY'}
              onChange={(e) =>
                patch('usagePrices', {
                  inputPerMillion: prices?.inputPerMillion ?? 0,
                  outputPerMillion: prices?.outputPerMillion ?? 0,
                  ...(prices?.cachedInputPerMillion !== undefined
                    ? { cachedInputPerMillion: prices.cachedInputPerMillion }
                    : {}),
                  currency: e.target.value === 'USD' ? 'USD' : 'CNY',
                })
              }
            >
              <option value="CNY">CNY ¥</option>
              <option value="USD">USD $</option>
            </select>
          </div>
        </div>
      </fieldset>

      {draft.provider === 'openai' && (
        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="adminApiKey">{t('usage.adminKey.label')}</Label>
          <div className="flex gap-2">
            <Input
              id="adminApiKey"
              type={showAdminKey ? 'text' : 'password'}
              value={draft.adminApiKey}
              onChange={(e) => patch('adminApiKey', e.target.value)}
              placeholder="sk-admin-..."
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setShowAdminKey((s) => !s)}
              aria-label={showAdminKey ? t('settings.apiKey.hide') : t('settings.apiKey.show')}
            >
              {showAdminKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('usage.adminKey.hint')}</p>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('usage.resetTitle')}
        description={t('usage.resetBody')}
        confirmLabel={t('usage.reset')}
        variant="destructive"
        onConfirm={async () => {
          await reset()
          setConfirmReset(false)
          toast({ variant: 'success', title: t('usage.resetDone') })
        }}
      />
    </div>
  )
}
