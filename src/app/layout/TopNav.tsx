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

  // Not sticky / translucent: the page scrolls in the sibling PageContainer,
  // so the bar never overlaps content and a backdrop blur would cost for nothing.
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4 sm:px-6 lg:px-8">
      <NavLink
        to="/dashboard"
        aria-label={t('app.name')}
        className="focus-ring flex shrink-0 items-center gap-2.5 rounded-md"
      >
        <span aria-hidden className="font-heading text-lg font-bold leading-none text-foreground">
          学
        </span>
        <span
          aria-hidden
          className="hidden whitespace-nowrap text-sm font-semibold text-foreground lg:inline"
        >
          {t('app.name')}
        </span>
      </NavLink>

      <nav
        aria-label={t('nav.main')}
        className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item, location.pathname)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                // Inset ring: the nav scrolls sideways, so an outer ring would be clipped.
                'relative flex h-14 shrink-0 items-center whitespace-nowrap px-3 text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
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
