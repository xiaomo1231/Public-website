import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { ProjectRepository } from '@/entities/project/repository'
import { courseQuestionLanguage, type Project } from '@/entities/project/types'
import { loadExamLanguage } from '@/entities/project/examLanguage'
import { UserRepository } from '@/entities/user/repository'
import {
  DEFAULT_QUESTION_LANGUAGE,
  examModeKey,
  type QuestionLanguage,
} from '@/entities/user/types'
import type { ExamLanguageKey } from '@/infrastructure/ai/prompts/exam-language/v1'

/**
 * 讲解与题目语言 of one course: an explicit choice for this call (a quiz
 * config), else the course's own setting (`Project.questionLanguage`), else
 * the global preference (`UserProfile.questionLanguage`), else the default.
 * For 「跟随考试语言（中文辅助）」 (`exam`) the course's exam language is
 * detected from its papers / materials (`loadExamLanguage`).
 */
export interface CourseLanguage {
  mode: QuestionLanguage
  /** `exam` mode only: the detected exam language (`zh` for a Chinese exam). */
  examLanguage?: string
  /** `exam` mode with a non-Chinese exam: the language key for prompts. */
  examKey?: ExamLanguageKey
}

export async function loadCourseLanguage(
  projectId: string,
  options: { db?: AppDatabase; override?: QuestionLanguage } = {},
): Promise<CourseLanguage> {
  const db = options.db ?? getDb()
  let mode = options.override
  if (!mode) {
    const project = await db
      .table<Project, string>('projects')
      .get(projectId)
      .catch(() => undefined)
    mode = courseQuestionLanguage(project?.questionLanguage)
  }
  if (!mode) {
    const profile = await new UserRepository(db).get().catch(() => undefined)
    mode = profile?.questionLanguage ?? DEFAULT_QUESTION_LANGUAGE
  }
  if (mode !== 'exam') return { mode }
  const examLanguage = await loadExamLanguage(db, projectId).catch(() => undefined)
  const examKey = examModeKey(mode, examLanguage)
  return {
    mode,
    ...(examLanguage ? { examLanguage } : {}),
    ...(examKey ? { examKey } : {}),
  }
}

/** The course's own language mode (`undefined` = follows the global preference). */
export async function getCourseLanguageMode(
  projectId: string,
  db?: AppDatabase,
): Promise<QuestionLanguage | undefined> {
  const project = await (db ?? getDb())
    .table<Project, string>('projects')
    .get(projectId)
    .catch(() => undefined)
  return courseQuestionLanguage(project?.questionLanguage)
}

/** The detected exam language of a course (for the settings hint); undefined when unknown. */
export async function detectCourseExamLanguage(
  projectId: string,
  db?: AppDatabase,
): Promise<string | undefined> {
  return loadExamLanguage(db ?? getDb(), projectId).catch(() => undefined)
}

/**
 * Set (or with `null` clear) a course's language mode. Exposed for the study
 * plan, which may switch a course to the exam language before an exam.
 */
export async function setCourseLanguageMode(
  projectId: string,
  mode: QuestionLanguage | null,
  db?: AppDatabase,
): Promise<Project> {
  return new ProjectRepository(db).update(projectId, { questionLanguage: mode })
}
