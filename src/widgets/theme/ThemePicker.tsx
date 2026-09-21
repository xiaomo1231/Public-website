import type { ComponentType } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import type { UserTheme } from '@/entities/user/types'
import { COLOR_THEMES, isCssHexColor } from '@/features/theme/colorThemes'
import { useColorTheme, useThemePreference } from '@/features/theme/useAppearance'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

const MODES: Array<{
  value: UserTheme
  labelKey: TranslationKey
  icon: ComponentType<{ className?: string }>
}> = [
  { value: 'light', labelKey: 'theme.mode.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.mode.dark', icon: Moon },
  { value: 'system', labelKey: 'theme.mode.system', icon: Monitor },
]

/**
 * Appearance picker: Light / Dark / System and the color theme palette.
 *
 * The two dimensions are presented as two separate controls on purpose — the
 * mode decides light vs dark, the palette decides the color family. Both are
 * pure presentation state: changing either only repaints CSS variables and
 * never touches course content or triggers AI.
 *
 * Native radio inputs are used (visually hidden, with a `peer` styled label)
 * so keyboard navigation, Space/arrow selection and focus rings work without
 * any custom key handling.
 */
export function ThemePicker(): JSX.Element {
  const { t } = useTranslation()
  const { preference, setPreference } = useThemePreference()
  const { colorTheme, setColorTheme } = useColorTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('theme.appearance')}</CardTitle>
        <CardDescription>{t('theme.appearanceHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('theme.mode')}</legend>
          <div className="flex flex-wrap gap-2">
            {MODES.map((mode) => {
              const Icon = mode.icon
              const selected = preference === mode.value
              return (
                <label key={mode.value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="appearance-mode"
                    value={mode.value}
                    checked={selected}
                    onChange={() => setPreference(mode.value)}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                      'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                      selected
                        ? 'border-primary bg-theme-primary-soft font-medium text-foreground'
                        : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {t(mode.labelKey)}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="space-y-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{t('theme.colorTheme')}</p>
            <p className="text-xs text-muted-foreground">{t('theme.colorThemeHint')}</p>
          </div>

          <div
            role="radiogroup"
            aria-label={t('theme.colorTheme')}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            {COLOR_THEMES.map((theme) => {
              const selected = colorTheme === theme.id
              return (
                <label key={theme.id} className="min-w-0 cursor-pointer">
                  <input
                    type="radio"
                    name="color-theme"
                    value={theme.id}
                    checked={selected}
                    onChange={() => setColorTheme(theme.id)}
                    aria-label={t(theme.labelKey)}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'flex h-full flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors',
                      'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                      selected
                        ? 'border-primary bg-theme-primary-soft'
                        : 'border-border hover:bg-accent/50',
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words text-sm font-medium text-foreground">
                        {t(theme.labelKey)}
                      </span>
                      {selected && (
                        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(theme.descriptionKey)}
                    </span>
                    <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1" aria-hidden>
                      {theme.preview.map((color, index) => {
                        const valid = isCssHexColor(color)
                        return (
                          <span
                            key={`${theme.id}-${index}`}
                            title={valid ? color : t('theme.invalidColor', { value: color })}
                            className={cn(
                              'grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] leading-none',
                              valid
                                ? 'border-black/10 dark:border-white/20'
                                : 'border-dashed border-destructive/70 text-destructive',
                            )}
                            style={valid ? { backgroundColor: color } : undefined}
                          >
                            {valid ? null : '?'}
                          </span>
                        )
                      })}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
