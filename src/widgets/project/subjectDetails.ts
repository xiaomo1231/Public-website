import { normalizeLanguageTag, type ExamStyle, type Subject } from '@/entities/project/types'

/** `auto` = no explicit choice: the exam style follows the course materials. */
export type ExamStyleChoice = ExamStyle | 'auto'

/** What a subject's extra fields save: `null` clears the stored value. */
export interface SubjectDetails {
  targetLanguage: string | null
  examStyle: ExamStyle | null
}

/** The stored details for a subject; fields that do not apply are cleared. */
export function subjectDetailsFor(
  subject: Subject,
  targetLanguage: string,
  examStyle: ExamStyleChoice,
): SubjectDetails {
  return {
    targetLanguage: subject === 'language' ? (normalizeLanguageTag(targetLanguage) ?? null) : null,
    examStyle: subject === 'medicine' && examStyle !== 'auto' ? examStyle : null,
  }
}
