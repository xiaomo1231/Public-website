import { NavLink, useLocation } from 'react-router-dom'
import {
  FolderKanban,
  LayoutDashboard,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation, type TranslationKey } from '@/i18n'
import { cn } from '@/shared/lib/utils'

interface NavItem {
  to: string
  labelKey: TranslationKey
  icon: ComponentType<{ className?: string }>
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
  { to: '/settings', labelKey: 'nav.settings', icon: SettingsIcon },
]

export interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps): JSX.Element {
  const { t } = useTranslation()
  const location = useLocation()

  return (
    <aside className="floating-sidebar flex h-full w-60 flex-col bg-card">
      <div className="flex items-center gap-3 px-5 pb-8 pt-7">
        <div className="brand-mark grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-soft">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-foreground">{t('app.name')}</span>
          <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('app.tagline')}
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-2 px-3">
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
              className={cn(
                'sidebar-link focus-ring group relative flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition-colors',
                active
                  ? 'sidebar-link--active bg-theme-primary-soft text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute right-4 h-1.5 w-1.5 rounded-full bg-theme-primary"
                />
              )}
              <span
                aria-hidden
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors',
                  active
                    ? 'bg-card text-foreground shadow-soft'
                    : 'text-muted-foreground group-hover:text-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              {t(item.labelKey)}
            </NavLink>
          )
        })}
      </nav>

      <div aria-hidden className="sidebar-orbit">
        <Sparkles />
        <span>✦</span>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t('app.dataStaysLocal')}</span>
        </div>
      </div>
    </aside>
  )
}
