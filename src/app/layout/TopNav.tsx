import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { HeaderControls } from './Header'
import { NAV_ITEMS, isNavItemActive } from './navItems'

/**
 * The lecture style's navigation: one quiet bar across the top — the mark,
 * the four places, and the controls. Course sections live in a second row
 * under it (ProjectFlowNav), so the page below stays a single reading column.
 */
export function TopNav(): JSX.Element {
  const { t } = useTranslation()
  const location = useLocation()

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-6 border-b bg-background/90 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
      <NavLink to="/dashboard" className="focus-ring flex shrink-0 items-center gap-2.5 rounded-md">
        <span aria-hidden className="font-heading text-lg font-bold leading-none text-foreground">
          学
        </span>
        <span className="hidden text-sm font-semibold text-foreground sm:inline">
          {t('app.name')}
        </span>
      </NavLink>

      <nav aria-label={t('nav.main')} className="ml-auto flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item, location.pathname)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-ring relative flex h-14 items-center px-3 text-sm transition-colors duration-200',
                active
                  ? 'font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(item.labelKey)}
            </NavLink>
          )
        })}
      </nav>

      <HeaderControls />
    </header>
  )
}
