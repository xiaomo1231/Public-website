import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { ProjectRepository } from '@/entities/project/repository'
import { normalizeLanguageTag, type Subject, type SubjectContext } from '@/entities/project/types'
import { loadSubjectContext } from '@/entities/project/subjectContext'

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

/**
 * The subject plus its project-specific details (`targetLanguage` for a
 * language course, the effective `examStyle` for medicine), for prompts and
 * cache versions: pass it to `withSubject` / `subjectPromptVersion` in place
 * of the bare subject. Missing project → `undefined`, like `loadProjectSubject`.
 */
export async function loadProjectSubjectContext(
  projectId: string,
  db?: AppDatabase,
): Promise<SubjectContext | undefined> {
  try {
    return await loadSubjectContext(db ?? getDb(), projectId)
  } catch {
    return undefined
  }
}

/** The language a `language` course teaches (BCP-47 primary tag), if set. */
export async function loadProjectTargetLanguage(
  projectId: string,
  db?: AppDatabase,
): Promise<string | undefined> {
  try {
    const project = await new ProjectRepository(db).get(projectId)
    return project.subject === 'language' ? normalizeLanguageTag(project.targetLanguage) : undefined
  } catch {
    return undefined
  }
}
