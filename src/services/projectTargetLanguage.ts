import type { AppDatabase } from '@/infrastructure/db/database'
import { ProjectRepository } from '@/entities/project/repository'
import { targetLanguageOf } from '@/shared/lib/language'

/**
 * The language a project's course is taught in (`Project.targetLanguage`,
 * BCP-47 primary tag such as 'de' or 'hu'), for grading and vocabulary.
 * Undefined when unset, or when the project is missing (deleted mid-run, or
 * a test without a project row).
 */
export async function projectTargetLanguage(
  projectId: string,
  db?: AppDatabase,
): Promise<string | undefined> {
  try {
    return targetLanguageOf(await new ProjectRepository(db).get(projectId))
  } catch {
    return undefined
  }
}
