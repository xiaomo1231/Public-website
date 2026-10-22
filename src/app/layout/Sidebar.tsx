import { NavLink, useLocation } from 'react-router-dom'
import { PanelLeftClose } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { useTranslation } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { UsageReadout } from '@/widgets/settings/UsageReadout'
import { NAV_ITEMS, isNavItemActive } from './navItems'

export interface SidebarProps {
  onNavigate?: () => void
  /**
   * Desktop only: when provided, a visible "collapse to the left" button is
   * shown. The narrow-screen drawer omits it.
   */
  onCollapse?: () => void
}

/**
 * The lab style's side rail: attached to the edge, hairline-separated, flat.
 * Each place carries a two-digit index, like a numbered instrument panel; the
 * current one gets a soft accent fill with an accent rule on its left edge.
 */
export function Sidebar({ onNavigate, onCollapse }: SidebarProps): JSX.Element {
  const { t } = useTranslation()
  const location = useLocation()

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-card">
      <div className="flex items-center gap-2.5 border-b px-4 py-3.5">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-[1.5px] border-foreground text-foreground">
          <BrandGlyph />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold text-foreground">
            {t('app.name')}
          </span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {t('app.tagline')}
          </span>
        </div>
        {onCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden h-7 w-7 shrink-0 lg:grid"
            aria-label={t('nav.collapseSidebar')}
            onClick={onCollapse}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav aria-label={t('nav.main')} className="flex flex-1 flex-col gap-px p-2">
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.icon
          const active = isNavItemActive(item, location.pathname)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'sidebar-link focus-ring flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13px] transition-colors duration-150',
                active
                  ? 'bg-theme-primary-soft font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span aria-hidden className="w-5 font-mono text-[11px] text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>
              <Icon className="h-4 w-4 shrink-0" />
              {t(item.labelKey)}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t px-4 py-3 font-mono text-[11px]">
        <UsageReadout onNavigate={onNavigate} />
      </div>
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
