import { useId } from 'react'
import {
  DEFAULT_QUESTION_LANGUAGE,
  QUESTION_LANGUAGES,
  type QuestionLanguage,
} from '@/entities/user/types'
import { useAuth } from '@/features/auth/useAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Label } from '@/shared/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { cn } from '@/shared/lib/utils'
import { toast } from '@/features/toast/toastStore'
import { logger } from '@/infrastructure/logger/logger'
import { useTranslation } from '@/i18n'
import { QUESTION_LANGUAGE_LABEL_KEYS } from './questionLanguageLabels'

/**
 * Global 讲解与题目语言 (each course can override it on its own page).
 * Saved at once on the profile.
 */
export function QuestionLanguageSetting({
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
  const id = useId()
  const { profile, setQuestionLanguage } = useAuth()
  const value = profile?.questionLanguage ?? DEFAULT_QUESTION_LANGUAGE
  const choose = (next: string) => {
    setQuestionLanguage(next as QuestionLanguage).catch((err: unknown) => {
      logger.warn('Saving the question language failed', { error: (err as Error)?.message })
      toast({
        variant: 'error',
        title: t('settings.saveFailedTitle'),
        description: t('settings.saveFailed'),
      })
    })
  }
  return (
    <Card className={className} data-question-language-setting>
      <CardHeader className={headerClassName}>
        <CardTitle className={titleClassName}>{t('quizConfig.questionLanguage')}</CardTitle>
        <CardDescription>{t('settings.questionLanguage.description')}</CardDescription>
      </CardHeader>
      <CardContent className={cn('space-y-2', bodyClassName)}>
        <Label htmlFor={id} className="sr-only">
          {t('quizConfig.questionLanguage')}
        </Label>
        <Select value={value} onValueChange={choose}>
          <SelectTrigger id={id} className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUESTION_LANGUAGES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(QUESTION_LANGUAGE_LABEL_KEYS[mode])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('questionLanguage.examHint')}</p>
      </CardContent>
    </Card>
  )
}
