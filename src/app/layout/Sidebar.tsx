import { NavLink, useLocation } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { useTranslation } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { UsageReadout } from '@/widgets/settings/UsageReadout'
import { useUsageReadoutVisible } from '@/features/settings/usageReadoutPreference'
import { NAV_ITEMS, isNavItemActive } from './navItems'

export interface SidebarProps {
  onNavigate?: () => void
  /**
   * Desktop only: when provided, a visible "collapse to the left" button is
   * shown. The narrow-screen drawer omits it.
   */
  onCollapse?: () => void
  /**
   * `rail`: the thin icon strip of a 专注子页面 (labels kept for screen
   * readers). `full` inside a rail is the expanded overlay. Both then show a
   * rail toggle instead of the collapse button.
   */
  variant?: 'full' | 'rail'
  /** Set inside a rail (collapsed or expanded): shows the rail toggle. */
  onToggleRail?: () => void
  railExpanded?: boolean
}

/**
 * The lab style's side rail: attached to the edge, hairline-separated, flat.
 * Each place carries a two-digit index, like a numbered instrument panel; the
 * current one gets a soft accent fill with an accent rule on its left edge.
 */
export function Sidebar({
  onNavigate,
  onCollapse,
  variant = 'full',
  onToggleRail,
  railExpanded = false,
}: SidebarProps): JSX.Element {
  const { t } = useTranslation()
  const location = useLocation()
  const showUsage = useUsageReadoutVisible()
  const rail = variant === 'rail'

  return (
    <aside
      className={cn('flex h-full flex-col border-r bg-card', rail ? 'w-14' : 'w-56')}
      data-sidebar-variant={variant}
    >
      <div
        className={cn(
          'flex items-center gap-2.5 border-b py-3.5',
          rail ? 'flex-col px-1.5 py-2' : 'px-4',
        )}
      >
        {!rail && (
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-[1.5px] border-foreground text-foreground">
            <BrandGlyph />
          </div>
        )}
        {!rail && (
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {t('app.name')}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {t('app.tagline')}
            </span>
          </div>
        )}
        {onToggleRail && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label={railExpanded ? t('nav.collapseRail') : t('nav.expandRail')}
            aria-expanded={railExpanded}
            data-rail-toggle
            onClick={onToggleRail}
          >
            {railExpanded ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </Button>
        )}
        {onCollapse && !onToggleRail && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden h-7 w-7 shrink-0 coarse:h-11 coarse:w-11 lg:grid"
            aria-label={t('nav.collapseSidebar')}
            onClick={onCollapse}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav
        aria-label={t('nav.main')}
        className={cn('flex flex-1 flex-col gap-px', rail ? 'items-center p-1.5' : 'p-2')}
      >
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.icon
          const active = isNavItemActive(item, location.pathname)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={rail ? t(item.labelKey) : undefined}
              className={cn(
                'sidebar-link focus-ring flex items-center gap-2.5 rounded-sm text-[13px] transition-colors duration-150 coarse:min-h-11 coarse:text-sm',
                rail ? 'h-11 w-11 justify-center' : 'px-2.5 py-2',
                active
                  ? 'bg-theme-primary-soft font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {!rail && (
                <span aria-hidden className="w-5 font-mono text-[11px] text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
              )}
              <Icon className="h-4 w-4 shrink-0" />
              <span className={rail ? 'sr-only' : undefined}>{t(item.labelKey)}</span>
            </NavLink>
          )
        })}
      </nav>

      {/* Off by default (设置 → AI 用量与余额); hidden means no balance requests. */}
      {showUsage && !rail && (
        <div className="border-t px-4 py-3 font-mono text-[11px]" data-usage-readout>
          <UsageReadout onNavigate={onNavigate} />
        </div>
      )}
    </aside>
  )
}

/**
 * The product mark: an integral sign, drawn as one stroke. Course maths is
 * what the app is for, so the mark says that instead of a generic "AI" spark.
 */
function BrandGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className="h-[15px] w-[15px]" fill="none" aria-hidden>
      <path
        d="M13.2 3.2c-1.6-.9-3 .1-3.3 2l-1.8 9.6c-.3 1.9-1.7 2.9-3.3 2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}
