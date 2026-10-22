import { AlignJustify, AlignLeft } from 'lucide-react'
import { DEFAULT_WALKTHROUGH_LEVEL, type WalkthroughLevel } from '@/entities/homework/walkthrough'
import { useAuth } from '@/features/auth/useAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { cn } from '@/shared/lib/utils'
import { onRadioKeyDown } from '@/shared/lib/radioGroupKeys'
import { toast } from '@/features/toast/toastStore'
import { logger } from '@/infrastructure/logger/logger'
import { useTranslation, type TranslationKey } from '@/i18n'

const OPTIONS: readonly WalkthroughLevel[] = ['standard', 'detailed']
const ICONS = { standard: AlignLeft, detailed: AlignJustify } as const

/**
 * 作业完整讲解的默认版本 (普通 / 详细). Saved at once on the profile; each
 * section can still be switched, and nothing is generated from here.
 */
export function WalkthroughLevelSetting({
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
  const { profile, setWalkthroughLevel } = useAuth()
  const level = profile?.walkthroughLevel ?? DEFAULT_WALKTHROUGH_LEVEL
  const choose = (option: WalkthroughLevel) => {
    setWalkthroughLevel(option).catch((err: unknown) => {
      logger.warn('Saving the walkthrough level failed', { error: (err as Error)?.message })
      toast({
        variant: 'error',
        title: t('settings.saveFailedTitle'),
        description: t('settings.saveFailed'),
      })
    })
  }
  return (
    <Card className={className} data-walkthrough-level-setting>
      <CardHeader className={headerClassName}>
        <CardTitle className={titleClassName}>{t('settings.walkthrough.title')}</CardTitle>
        <CardDescription>{t('settings.walkthrough.description')}</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-3', bodyClassName)}>
        <div
          role="radiogroup"
          aria-label={t('settings.walkthrough.level')}
          className="grid gap-2 sm:grid-cols-2"
        >
          {OPTIONS.map((option, index) => {
            const Icon = ICONS[option]
            const selected = option === level
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                data-walkthrough-level-option={option}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(option)}
                onKeyDown={(event) => onRadioKeyDown(event, OPTIONS, index, choose)}
                className={cn(
                  'focus-ring flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left text-sm transition-colors duration-150 hover:bg-muted lecture:rounded-none lab:rounded-none',
                  selected && 'border-primary ring-1 ring-primary',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4" aria-hidden />
                  {t(`homework.walkthrough.level.${option}` as TranslationKey)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`settings.walkthrough.${option}Hint` as TranslationKey)}
                </span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
