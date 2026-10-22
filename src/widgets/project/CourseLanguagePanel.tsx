import { useId, useState } from 'react'
import { SectionHeading } from '@/shared/ui/Section'
import { Label } from '@/shared/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { QUESTION_LANGUAGES, type QuestionLanguage } from '@/entities/user/types'
import { useCourseLanguage } from '@/features/project/useCourseLanguage'
import { QUESTION_LANGUAGE_LABEL_KEYS } from '@/widgets/settings/questionLanguageLabels'
import { languageName } from '@/shared/lib/language'
import { useTranslation } from '@/i18n'

const FOLLOW = 'follow'

/**
 * 「讲解与题目语言」 of one course: follow the global preference or choose a
 * mode for this course only (e.g. 跟随考试语言（中文辅助） for a course
 * examined in German). Saved at once; nothing is generated from here.
 */
export function CourseLanguagePanel({ projectId }: { projectId: string }): JSX.Element {
  const { t, language: uiLanguage } = useTranslation()
  const id = useId()
  const course = useCourseLanguage(projectId)
  const [message, setMessage] = useState<string | null>(null)
  const value = course.courseMode ?? FOLLOW

  const choose = (next: string) => {
    setMessage(null)
    const mode = next === FOLLOW ? null : (next as QuestionLanguage)
    course.saveCourseMode(mode).then(
      () => setMessage(t('courseLanguage.saved')),
      (err: unknown) => setMessage(err instanceof Error ? err.message : String(err)),
    )
  }

  const exam = course.examLanguage
  const examNote =
    course.mode !== 'exam'
      ? null
      : !exam
        ? t('courseLanguage.examUnknown')
        : exam === 'zh'
          ? t('courseLanguage.examChinese')
          : t('courseLanguage.examDetected', {
              language: languageName(exam, uiLanguage === 'zh-CN' ? 'zh' : 'en'),
            })

  return (
    <section
      className="max-w-[70ch] space-y-4"
      aria-labelledby={`${id}-title`}
      data-course-language-panel
    >
      <SectionHeading
        title={<span id={`${id}-title`}>{t('courseLanguage.title')}</span>}
        description={t('courseLanguage.description')}
      />
      <div className="space-y-2">
        <Label htmlFor={`${id}-select`}>{t('quizConfig.questionLanguage')}</Label>
        <Select value={value} onValueChange={choose} disabled={!course.loaded}>
          <SelectTrigger id={`${id}-select`} className="max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FOLLOW}>
              {t('courseLanguage.followGlobal', {
                mode: t(QUESTION_LANGUAGE_LABEL_KEYS[course.globalMode]),
              })}
            </SelectItem>
            {QUESTION_LANGUAGES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(QUESTION_LANGUAGE_LABEL_KEYS[mode])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('questionLanguage.examHint')}</p>
        {examNote && (
          <p className="text-sm" data-course-exam-language>
            {examNote}
          </p>
        )}
        {message && (
          <p className="text-xs text-muted-foreground" role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  )
}
