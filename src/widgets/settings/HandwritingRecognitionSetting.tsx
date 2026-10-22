import { Cloud, HardDrive, Sparkles } from 'lucide-react'
import {
  DEFAULT_HANDWRITING_RECOGNITION_MODE,
  HANDWRITING_RECOGNITION_MODES,
  type HandwritingRecognitionMode,
} from '@/entities/handwriting/types'
import { useAuth } from '@/features/auth/useAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { cn } from '@/shared/lib/utils'
import { onRadioKeyDown } from '@/shared/lib/radioGroupKeys'
import { toast } from '@/features/toast/toastStore'
import { logger } from '@/infrastructure/logger/logger'
import { useTranslation, type TranslationKey } from '@/i18n'

const ICONS = { auto: Sparkles, local: HardDrive, online: Cloud } as const

/**
 * 手写识别方式 (模拟考试 handwriting): 自动 / 仅本机 / 仅在线. Saved at once on
 * the profile. Whatever is chosen, recognition is a draft the student
 * confirms before grading, and typing is always possible.
 */
export function HandwritingRecognitionSetting({
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
  const { profile, setHandwritingRecognition } = useAuth()
  const mode = profile?.handwritingRecognition ?? DEFAULT_HANDWRITING_RECOGNITION_MODE
  const choose = (option: HandwritingRecognitionMode) => {
    setHandwritingRecognition(option).catch((err: unknown) => {
      logger.warn('Saving the handwriting recognition mode failed', {
        error: (err as Error)?.message,
      })
      toast({
        variant: 'error',
        title: t('settings.saveFailedTitle'),
        description: t('settings.saveFailed'),
      })
    })
  }
  return (
    <Card className={className} data-handwriting-setting>
      <CardHeader className={headerClassName}>
        <CardTitle className={titleClassName}>{t('settings.handwriting.title')}</CardTitle>
        <CardDescription>{t('settings.handwriting.description')}</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-3', bodyClassName)}>
        <div
          role="radiogroup"
          aria-label={t('settings.handwriting.mode')}
          className="grid gap-2 sm:grid-cols-3"
        >
          {HANDWRITING_RECOGNITION_MODES.map((option, index) => {
            const Icon = ICONS[option]
            const selected = option === mode
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                data-handwriting-option={option}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(option)}
                onKeyDown={(event) =>
                  onRadioKeyDown(event, HANDWRITING_RECOGNITION_MODES, index, choose)
                }
                className={cn(
                  'focus-ring flex min-h-11 flex-col items-start gap-1.5 rounded-lg border p-3 text-left text-sm transition-colors duration-150 hover:bg-muted lecture:rounded-none lab:rounded-none',
                  selected && 'border-primary ring-1 ring-primary',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4" aria-hidden />
                  {t(`settings.handwriting.${option}` as TranslationKey)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`settings.handwriting.${option}Hint` as TranslationKey)}
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('settings.handwriting.localStatus')}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('settings.handwriting.confirmNote')}
        </p>
      </CardContent>
    </Card>
  )
}
