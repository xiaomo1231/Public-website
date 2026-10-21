import type { ComponentType } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { UI_STYLES, type UserTheme, type UserUiStyle } from '@/entities/user/types'
import { COLOR_THEMES, isCssHexColor } from '@/features/theme/colorThemes'
import { useColorTheme, useThemePreference, useUiStyle } from '@/features/theme/useAppearance'
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
  const { uiStyle, setUiStyle } = useUiStyle()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('theme.appearance')}</CardTitle>
        <CardDescription>{t('theme.appearanceHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('theme.uiStyle')}</legend>
          <p className="text-xs text-muted-foreground">{t('theme.uiStyleHint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {UI_STYLES.map((style) => {
              const selected = uiStyle === style
              return (
                <label key={style} className="cursor-pointer">
                  <input
                    type="radio"
                    name="interface-style"
                    value={style}
                    checked={selected}
                    onChange={() => setUiStyle(style)}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'block rounded-xl border p-3 transition-colors',
                      'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                      selected
                        ? 'border-primary ring-1 ring-primary'
                        : 'border-input hover:bg-accent',
                    )}
                  >
                    <StyleThumbnail style={style} />
                    <span className="mt-2.5 block text-sm font-medium text-foreground">
                      {t(style === 'lecture' ? 'theme.uiStyle.lecture' : 'theme.uiStyle.lab')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t(
                        style === 'lecture' ? 'theme.uiStyle.lectureHint' : 'theme.uiStyle.labHint',
                      )}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

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
                      'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
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
                      {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                    </span>
                    <span className="text-xs text-muted-foreground">{t(theme.descriptionKey)}</span>
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

/**
 * A wireframe of each style, drawn in the current theme's own tokens so it
 * never hard-codes a colour: lecture is a centred column under a top bar with
 * a serif title; lab is a side rail beside a grid of readouts.
 */
function StyleThumbnail({ style }: { style: UserUiStyle }): JSX.Element {
  if (style === 'lecture') {
    return (
      <span
        aria-hidden
        className="grid h-20 grid-rows-[10px_1fr] overflow-hidden rounded-md border bg-background"
      >
        <span className="border-b" />
        <span className="mx-auto mt-2 flex w-1/2 flex-col gap-1.5">
          <span className="font-serif text-[11px] font-bold leading-none text-foreground">
            Aa 讲义
          </span>
          <span className="h-1 rounded-full bg-muted-foreground/30" />
          <span className="h-1 w-5/6 rounded-full bg-muted-foreground/30" />
          <span className="h-1 rounded-full bg-muted-foreground/30" />
        </span>
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className="grid h-20 grid-cols-[22%_1fr] overflow-hidden rounded-sm border bg-background [background-image:linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] [background-size:10px_10px]"
    >
      <span className="border-r bg-card" />
      <span className="flex flex-col gap-1.5 p-2">
        <span className="h-1 w-1/3 bg-primary" />
        <span className="grid grid-cols-3 gap-0.5">
          <span className="h-4 border bg-card font-mono text-[8px] leading-4 text-foreground">
            06
          </span>
          <span className="h-4 border bg-card font-mono text-[8px] leading-4 text-foreground">
            0.62
          </span>
          <span className="h-4 border bg-card font-mono text-[8px] leading-4 text-foreground">
            2/6
          </span>
        </span>
        <span className="h-1 bg-muted-foreground/30" />
      </span>
    </span>
  )
}
