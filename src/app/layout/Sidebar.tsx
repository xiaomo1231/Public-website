import { NavLink, useLocation } from 'react-router-dom'
import {
  FolderKanban,
  House,
  PanelLeftClose,
  Settings as SettingsIcon,
  ShieldCheck,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { Button } from '@/shared/ui/Button'
import { useTranslation, type TranslationKey } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { useSlidingIndicator } from '@/shared/lib/useSlidingIndicator'

interface NavItem {
  to: string
  labelKey: TranslationKey
  icon: ComponentType<{ className?: string }>
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: House },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
  { to: '/settings', labelKey: 'nav.settings', icon: SettingsIcon },
]

export interface SidebarProps {
  onNavigate?: () => void
  /**
   * Desktop only: when provided, a visible "collapse to the left" button is
   * shown. The mobile drawer omits it, so the drawer behaviour is unchanged.
   */
  onCollapse?: () => void
}

export function Sidebar({ onNavigate, onCollapse }: SidebarProps): JSX.Element {
  const { t } = useTranslation()
  const location = useLocation()
  const indicator = useSlidingIndicator<HTMLElement>('[data-active="true"]')

  return (
    <aside className="floating-sidebar flex h-full w-60 flex-col bg-card">
      <div className="flex items-center gap-3 px-5 pb-8 pt-7">
        <div className="brand-mark grid h-9 w-9 shrink-0 place-items-center rounded-lg shadow-soft">
          <BrandGlyph />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-foreground">{t('app.name')}</span>
          <span className="truncate text-xs text-muted-foreground">
            {t('app.tagline')}
          </span>
        </div>
        {onCollapse && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden h-8 w-8 shrink-0 lg:grid"
            aria-label={t('nav.collapseSidebar')}
            onClick={onCollapse}
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <nav
        ref={indicator.containerRef}
        data-indicator={indicator.ready ? 'ready' : undefined}
        className="group/nav relative mx-3 flex flex-1 flex-col gap-2"
      >
        {/* The active pill glides between links instead of jumping. */}
        <span
          aria-hidden
          data-animate={indicator.animate}
          className={cn(
            'slide-indicator sidebar-link--active rounded-xl bg-theme-primary-soft',
            !indicator.ready && 'hidden',
          )}
          style={indicator.style}
        />
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active =
            location.pathname === item.to ||
            (item.to !== '/' && location.pathname.startsWith(item.to + '/')) ||
            (item.to === '/projects' && location.pathname.startsWith('/projects'))
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              data-active={active}
              className={cn(
                'sidebar-link focus-ring group relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                active
                  ? 'sidebar-link--active bg-theme-primary-soft text-foreground group-data-[indicator=ready]/nav:bg-transparent group-data-[indicator=ready]/nav:shadow-none'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute right-4 h-1.5 w-1.5 animate-fade rounded-full bg-theme-primary"
                />
              )}
              <span
                aria-hidden
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-[color,background-color,box-shadow,transform] duration-300',
                  active
                    ? 'bg-card text-foreground shadow-soft'
                    : 'text-muted-foreground group-hover:text-accent-foreground motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-110',
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              {t(item.labelKey)}
            </NavLink>
          )
        })}
      </nav>

      <div className="p-4">
        <div className="flex items-start gap-2 px-2 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t('app.dataStaysLocal')}</span>
        </div>
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
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden>
      <path
        d="M13.2 3.2c-1.6-.9-3 .1-3.3 2l-1.8 9.6c-.3 1.9-1.7 2.9-3.3 2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}
