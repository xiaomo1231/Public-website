import { Monitor, Moon, Sun, LogOut, Languages } from 'lucide-react'
import type { UserTheme } from '@/entities/user/types'
import { useAuth } from '@/features/auth/useAuth'
import { useThemePreference } from '@/features/theme/useAppearance'
import { useUILanguage } from '@/features/settings/useUILanguage'
import { LANGUAGE_LABELS, UI_LANGUAGES, useTranslation, type TranslationKey } from '@/i18n'
import { Button } from '@/shared/ui/Button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/shared/ui/DropdownMenu'
import { cn } from '@/shared/lib/utils'

const THEME_OPTIONS: { value: UserTheme; labelKey: TranslationKey; icon: typeof Sun }[] = [
  { value: 'light', labelKey: 'header.theme.light', icon: Sun },
  { value: 'dark', labelKey: 'header.theme.dark', icon: Moon },
  { value: 'system', labelKey: 'header.theme.system', icon: Monitor },
]

export interface HeaderProps {
  onOpenMobileNav?: () => void
}

export function Header({ onOpenMobileNav }: HeaderProps): JSX.Element {
  const { profile, lock } = useAuth()
  const { t } = useTranslation()
  const { language, setLanguage } = useUILanguage()
  const { preference, setPreference } = useThemePreference()

  const ThemeIcon =
    preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor

  return (
    <header className="app-surface-tint flex h-14 items-center justify-between gap-3 border-b px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 lg:hidden"
          aria-label={t('header.openNavigation')}
          onClick={onOpenMobileNav}
        >
          <span className="block h-4 w-4 rounded-sm border" aria-hidden />
        </Button>
        <div className="min-w-0 truncate text-sm text-muted-foreground">
          {profile ? t('header.welcomeNamed', { name: profile.name }) : t('header.welcome')}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('header.changeTheme')}>
              <ThemeIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('header.theme')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon
              return (
                <DropdownMenuItem
                  key={opt.value}
                  onSelect={() => setPreference(opt.value)}
                  className={cn(preference === opt.value && 'bg-accent')}
                >
                  <Icon className="h-4 w-4" />
                  {t(opt.labelKey)}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('header.changeLanguage')}>
              <Languages className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('header.language')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {UI_LANGUAGES.map((lang) => (
              <DropdownMenuItem
                key={lang}
                onSelect={() => setLanguage(lang)}
                className={cn(language === lang && 'bg-accent')}
              >
                {LANGUAGE_LABELS[lang]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-xs font-semibold uppercase">
                {profile?.name?.[0] ?? 'S'}
              </span>
              <span className="hidden max-w-[12rem] truncate sm:inline">
                {profile?.name ?? t('header.account')}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[min(90vw,20rem)]">
            <DropdownMenuLabel className="truncate">
              {profile?.name ?? t('header.student')}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void lock()}>
              <LogOut className="h-4 w-4" />
              {t('header.lockApp')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}