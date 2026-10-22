import { BookA, CalendarDays, FolderKanban, House, Settings as SettingsIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { TranslationKey } from '@/i18n'

export interface NavItem {
  to: string
  labelKey: TranslationKey
  icon: ComponentType<{ className?: string }>
}

/** The places in the app, shared by the lab side rail and the lecture top bar. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: House },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
  { to: '/plan', labelKey: 'nav.plan', icon: CalendarDays },
  { to: '/vocab', labelKey: 'nav.vocab', icon: BookA },
  { to: '/settings', labelKey: 'nav.settings', icon: SettingsIcon },
]

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.to || pathname.startsWith(item.to + '/')
}
