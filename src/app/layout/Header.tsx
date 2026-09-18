import { Monitor, Moon, Sun, LogOut } from 'lucide-react'
import type { UserTheme } from '@/entities/user/types'
import { useAuth } from '@/features/auth/useAuth'
import { useThemeStore } from '@/features/theme/themeStore'
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

const THEME_OPTIONS: { value: UserTheme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export interface HeaderProps {
  onOpenMobileNav?: () => void
}

export function Header({ onOpenMobileNav }: HeaderProps): JSX.Element {
  const { profile, lock } = useAuth()
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)

  const ThemeIcon =
    preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={onOpenMobileNav}
        >
          <span className="block h-4 w-4 rounded-sm border" aria-hidden />
        </Button>
        <div className="text-sm text-muted-foreground">
          {profile ? `Welcome, ${profile.name}` : 'Welcome'}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Change theme">
              <ThemeIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Theme</DropdownMenuLabel>
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
                  {opt.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-xs font-semibold uppercase">
                {profile?.name?.[0] ?? 'S'}
              </span>
              <span className="hidden sm:inline">{profile?.name ?? 'Account'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{profile?.name ?? 'Student'}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void lock()}>
              <LogOut className="h-4 w-4" />
              Lock app
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}