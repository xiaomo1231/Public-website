import { forwardRef, type AnchorHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { Gauge } from 'lucide-react'
import { useAIUsage } from '@/features/settings/useAIUsage'
import { useTranslation } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { usageReadout } from './usageFormat'

/** Where the readout leads: the AI usage section of the settings page. */
export const AI_USAGE_SETTINGS_PATH = '/settings#ai-usage'

export interface UsageReadoutProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  onNavigate?: () => void
}

/**
 * A one-line AI balance / usage readout linking to the settings section.
 * Mounted while visible, so it refreshes on open and after every generation.
 * Forwards its ref so a menu item can render it via `asChild`.
 */
export const UsageReadout = forwardRef<HTMLAnchorElement, UsageReadoutProps>(function UsageReadout(
  { className, onNavigate, onClick, ...rest },
  ref,
) {
  const { t, language } = useTranslation()
  const { snapshot, balance, unconfigured } = useAIUsage()
  const text = usageReadout({
    balance,
    usage: snapshot?.usage,
    prices: snapshot?.prices ?? null,
    unconfigured,
    language,
  })
  const blocked = balance?.status === 'error' && balance.reason === 'blocked'
  return (
    <Link
      ref={ref}
      {...rest}
      to={AI_USAGE_SETTINGS_PATH}
      onClick={(event) => {
        onClick?.(event)
        onNavigate?.()
      }}
      aria-label={`${t('usage.readout.open')}: ${text}`}
      title={blocked ? t('usage.balance.blocked') : t('usage.readout.open')}
      className={cn(
        'focus-ring flex min-w-0 items-start gap-2 rounded-sm text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      <Gauge className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 tabular-nums">{text}</span>
    </Link>
  )
})
