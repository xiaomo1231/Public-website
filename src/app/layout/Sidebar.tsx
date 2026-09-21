import { NavLink, useLocation } from 'react-router-dom'
import {
  BookOpen,
  FolderKanban,
  LayoutDashboard,
  Settings as SettingsIcon,
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
    <aside className="flex h-full w-64 flex-col border-r bg-card/30">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-primary-strong text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">{t('app.name')}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('app.tagline')}
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
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
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
          <BookOpen className="h-4 w-4" />
          <span>{t('app.dataStaysLocal')}</span>
        </div>
      </div>
    </aside>
  )
}