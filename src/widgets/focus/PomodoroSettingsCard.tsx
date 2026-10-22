import { Timer } from 'lucide-react'
import type { PomodoroSettings } from '@/entities/focus/pomodoro'
import { usePomodoroSettings, useSavePomodoroSettings } from '@/features/focus/usePomodoro'
import { toast } from '@/features/toast/toastStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'
import { PomodoroLengthFields } from './PomodoroDock'

const TOGGLES: ReadonlyArray<{
  key: 'visible' | 'sound' | 'dimBreaks'
  label: TranslationKey
  hint: TranslationKey
}> = [
  { key: 'visible', label: 'settings.pomodoro.visible', hint: 'settings.pomodoro.visibleHint' },
  { key: 'sound', label: 'settings.pomodoro.sound', hint: 'settings.pomodoro.soundHint' },
  { key: 'dimBreaks', label: 'settings.pomodoro.dim', hint: 'settings.pomodoro.dimHint' },
]

/** 设置 → 番茄钟: lengths, cycle and alerts. Saved at once on the profile. */
export function PomodoroSettingsCard({
  className,
  headerClassName,
  titleClassName,
  bodyClassName,
}: {
  className?: string
  headerClassName?: string
  titleClassName?: string
  bodyClassName?: string
}): JSX.Element {
  const { t } = useTranslation()
  const settings = usePomodoroSettings()
  const save = useSavePomodoroSettings()
  const toggle = (key: keyof PomodoroSettings, value: boolean) => {
    save({ [key]: value }).catch(() =>
      toast({
        variant: 'error',
        title: t('settings.saveFailedTitle'),
        description: t('settings.saveFailed'),
      }),
    )
  }
  return (
    <Card className={className} id="pomodoro-settings" data-pomodoro-settings>
      <CardHeader className={headerClassName}>
        <CardTitle className={cn(titleClassName, 'flex items-center gap-2')}>
          <Timer className="h-4 w-4 lecture:hidden" aria-hidden />
          {t('settings.pomodoro.title')}
        </CardTitle>
        <CardDescription>{t('settings.pomodoro.description')}</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-4', bodyClassName)}>
        <PomodoroLengthFields settings={settings} className="grid-cols-2 sm:grid-cols-4" />
        <div className="space-y-1">
          {TOGGLES.map(({ key, label, hint }) => (
            <label
              key={key}
              className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm"
            >
              <input
                type="checkbox"
                className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
                checked={settings[key]}
                data-pomodoro-toggle={key}
                onChange={(event) => toggle(key, event.target.checked)}
              />
              <span>
                <span className="font-medium">{t(label)}</span>
                <span className="block text-xs text-muted-foreground">{t(hint)}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('settings.pomodoro.examNote')}</p>
      </CardContent>
    </Card>
  )
}
