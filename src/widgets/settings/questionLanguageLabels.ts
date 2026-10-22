import type { QuestionLanguage } from '@/entities/user/types'
import type { TranslationKey } from '@/i18n'

/** Labels of the 讲解与题目语言 options (quiz settings, settings page, course page). */
export const QUESTION_LANGUAGE_LABEL_KEYS: Record<QuestionLanguage, TranslationKey> = {
  zh_terms: 'questionLanguage.zh_terms',
  source: 'questionLanguage.source',
  en: 'questionLanguage.en',
  exam: 'questionLanguage.exam',
}
