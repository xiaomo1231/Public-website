import type { LearningMaterialType } from '@/entities/document/types'
import type { TranslationKey } from '@/i18n'

/** Display label of each learning-material role. */
export const MATERIAL_LABEL_KEY: Record<LearningMaterialType, TranslationKey> = {
  textbook: 'materialType.textbook',
  user_notes: 'materialType.user_notes',
  lecture_transcript: 'materialType.lecture_transcript',
  professor_practice: 'materialType.professor_practice',
  homework: 'materialType.homework',
  homework_answer: 'materialType.homework_answer',
  syllabus: 'materialType.syllabus',
  walkthrough_import: 'materialType.walkthrough_import',
  past_exam: 'materialType.past_exam',
}
