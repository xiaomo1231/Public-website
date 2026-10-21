import { useEffect, useId, useState } from 'react'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { normalizeLanguageTag, type Subject } from '@/entities/project/types'
import type { ExamStyleChoice } from './subjectDetails'
import { useTranslation, type TranslationKey } from '@/i18n'

/** Languages offered directly; anything else is typed as a BCP-47 tag. */
const TARGET_LANGUAGES: ReadonlyArray<[string, TranslationKey]> = [
  ['de', 'project.targetLanguage.de'],
  ['hu', 'project.targetLanguage.hu'],
  ['en', 'project.targetLanguage.en'],
  ['fr', 'project.targetLanguage.fr'],
  ['es', 'project.targetLanguage.es'],
]
const OTHER = 'other'

const EXAM_STYLE_OPTIONS: ReadonlyArray<[ExamStyleChoice, TranslationKey, TranslationKey]> = [
  ['auto', 'project.examStyle.auto', 'project.examStyle.autoHint'],
  ['domestic', 'project.examStyle.domestic', 'project.examStyle.domesticHint'],
  ['international', 'project.examStyle.international', 'project.examStyle.internationalHint'],
]

export interface SubjectDetailsFieldsProps {
  subject: Subject
  targetLanguage: string
  onTargetLanguageChange: (tag: string) => void
  examStyle: ExamStyleChoice
  onExamStyleChange: (style: ExamStyleChoice) => void
  disabled?: boolean
}

/**
 * Fields that only some subjects have: the language being learnt (a language
 * course) and the exam system (medicine). Renders nothing for other subjects.
 */
export function SubjectDetailsFields({
  subject,
  targetLanguage,
  onTargetLanguageChange,
  examStyle,
  onExamStyleChange,
  disabled,
}: SubjectDetailsFieldsProps): JSX.Element | null {
  const { t } = useTranslation()
  const languageId = useId()
  const customId = useId()
  const examId = useId()
  const preset = TARGET_LANGUAGES.some(([tag]) => tag === targetLanguage)
  const [otherChosen, setOtherChosen] = useState(!preset && targetLanguage !== '')
  useEffect(() => {
    if (preset) setOtherChosen(false)
    else if (targetLanguage) setOtherChosen(true)
  }, [preset, targetLanguage])

  if (subject === 'language') {
    const choice = preset ? targetLanguage : otherChosen ? OTHER : ''
    const invalid = otherChosen && targetLanguage !== '' && !normalizeLanguageTag(targetLanguage)
    return (
      <div className="space-y-2">
        <Label htmlFor={languageId}>{t('project.targetLanguage')}</Label>
        <Select
          value={choice}
          onValueChange={(value) => {
            if (value === OTHER) {
              setOtherChosen(true)
              onTargetLanguageChange('')
            } else {
              setOtherChosen(false)
              onTargetLanguageChange(value)
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger id={languageId}>
            <SelectValue placeholder={t('project.targetLanguage.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {TARGET_LANGUAGES.map(([tag, key]) => (
              <SelectItem key={tag} value={tag} translate="no">
                {t(key)}
              </SelectItem>
            ))}
            <SelectItem value={OTHER}>{t('project.targetLanguage.other')}</SelectItem>
          </SelectContent>
        </Select>
        {otherChosen && (
          <div className="space-y-1">
            <Label htmlFor={customId} className="text-xs text-muted-foreground">
              {t('project.targetLanguage.custom')}
            </Label>
            <Input
              id={customId}
              value={targetLanguage}
              onChange={(e) => onTargetLanguageChange(e.target.value.trim())}
              placeholder={t('project.targetLanguage.customPlaceholder')}
              maxLength={35}
              disabled={disabled}
              invalid={invalid}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t('project.targetLanguage.hint')}</p>
      </div>
    )
  }

  if (subject === 'medicine') {
    const hint = EXAM_STYLE_OPTIONS.find(([value]) => value === examStyle)?.[2]
    return (
      <div className="space-y-2">
        <Label htmlFor={examId}>{t('project.examStyle')}</Label>
        <Select
          value={examStyle}
          onValueChange={(value) => onExamStyleChange(value as ExamStyleChoice)}
          disabled={disabled}
        >
          <SelectTrigger id={examId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXAM_STYLE_OPTIONS.map(([value, key]) => (
              <SelectItem key={value} value={value}>
                {t(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hint && <p className="text-xs text-muted-foreground">{t(hint)}</p>}
      </div>
    )
  }

  return null
}
