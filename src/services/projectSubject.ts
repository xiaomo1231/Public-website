import type { AppDatabase } from '@/infrastructure/db/database'
import { ProjectRepository } from '@/entities/project/repository'
import type { Subject } from '@/entities/project/types'

/**
 * The subject of a project, for prompts. A missing project (deleted mid-run,
 * or a test without a project row) reads as "no subject" rather than failing
 * the AI call around it.
 */
export async function loadProjectSubject(
  projectId: string,
  db?: AppDatabase,
): Promise<Subject | undefined> {
  try {
    return (await new ProjectRepository(db).get(projectId)).subject
  } catch {
    return undefined
  }
}
