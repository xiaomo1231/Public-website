import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { ProjectRepository } from '@/entities/project/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { MasteryService } from '@/services/masteryService'
import { MistakeService } from '@/services/mistakeService'
import { QuizRepository } from '@/entities/quiz/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { TranslationRepository } from '@/entities/translation/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { SettingsService } from './settingsService'
import { clearCachedDeviceKey } from '@/infrastructure/crypto/deviceKey'

import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

export interface DataInventory {
  projects: number
  documents: number
  chunks: number
  courseAnalyses: number
  questions: number
  questionAttempts: number
  quizzes: number
  tutorSessions: number
  translations: number
  mistakes: number
  knowledgeMastery: number
  inviteKeys: number
  processingJobs: number
  hasApiKey: boolean
  estimatedTotalBytes: number
}

export class DataManagementService {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async inventory(): Promise<DataInventory> {
    const db = this.db
    const [
      projects,
      documents,
      chunks,
      courseAnalyses,
      questions,
      questionAttempts,
      quizzes,
      tutorSessions,
      translations,
      mistakes,
      knowledgeMastery,
      inviteKeys,
      processingJobs,
      settings,
    ] = await Promise.all([
      db.table('projects').count(),
      db.table('documents').count(),
      db.table('chunks').count(),
      db.table('courseAnalyses').count(),
      db.table('questions').count(),
      db.table('questionAttempts').count(),
      db.table('quizzes').count(),
      db.table('tutorSessions').count(),
      db.table('translations').count(),
      db.table('mistakes').count(),
      db.table('knowledgeMastery').count(),
      db.table('inviteKeys').count(),
      db.table('processingJobs').count(),
      db.table('settings').get('singleton'),
    ])
    const blobs = await db.table('documentBlobs').toArray()
    const blobBytes = blobs.reduce((acc, b) => acc + (b.bytes?.byteLength ?? 0), 0)
    return {
      projects,
      documents,
      chunks,
      courseAnalyses,
      questions,
      questionAttempts,
      quizzes,
      tutorSessions,
      translations,
      mistakes,
      knowledgeMastery,
      inviteKeys,
      processingJobs,
      hasApiKey: Boolean(
        (settings as { apiKeyEncrypted?: string } | undefined)?.apiKeyEncrypted ||
          (settings as { apiKey?: string } | undefined)?.apiKey?.trim(),
      ),
      estimatedTotalBytes: blobBytes,
    }
  }

  /** Export everything as a single JSON file plus the raw document blobs. */
  async exportAll(): Promise<{ json: Record<string, unknown>; blobs: Array<{ id: string; bytes: ArrayBuffer; mimeType: string }> }> {
    const db = this.db
    const tables = [
      'projects', 'documents', 'documentBlobs', 'chunks', 'processingJobs',
      'courseAnalyses', 'topics', 'concepts', 'formulas', 'symbols', 'examples',
      'courseExercises', 'prerequisites', 'tutorSessions', 'translations',
      'questions', 'questionAttempts', 'quizzes', 'knowledgeMastery', 'mistakes',
      'inviteKeys', 'user', 'settings',
    ] as const
    const json: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      schemaVersion: this.db.verno,
    }
    for (const name of tables) {
      if (name === 'documentBlobs') continue // blobs exported separately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json[name] = await (db as any).table(name).toArray()
    }
    const blobs = await db.table('documentBlobs').toArray()
    return {
      json,
      blobs: blobs.map((b) => ({ id: b.id as string, bytes: b.bytes, mimeType: b.mimeType as string })),
    }
  }

  /** Delete one project and everything that belongs to it. */
  async deleteProject(projectId: string): Promise<void> {
    const projectRepo = new ProjectRepository(this.db)
    const docRepo = new DocumentRepository(this.db)
    const analysesRepo = new CourseAnalysisRepository(this.db)
    const mistakeRepo = new MistakeService(this.db)
    const quizRepo = new QuizRepository(this.db)
    const attemptRepo = new QuestionAttemptRepository(this.db)
    const questionRepo = new QuestionRepository(this.db)
    const mastery = new MasteryService(this.db)
    const sessionRepo = new TutorSessionRepository(this.db)
    const translationRepo = new TranslationRepository(this.db)

    await docRepo.deleteByProject(projectId)
    await this.db.table('chunks').where('projectId').equals(projectId).delete()
    await analysesRepo.deleteByProject(projectId)
    await mastery.deleteByProject(projectId)
    await mistakeRepo.deleteByProject(projectId)
    await quizRepo.deleteByProject(projectId)
    await questionRepo.deleteByProject(projectId)
    await attemptRepo.deleteByProject(projectId)
    await sessionRepo.deleteByProject(projectId)
    await translationRepo.deleteByProject(projectId)
    await projectRepo.delete(projectId)
    logger.warn('Project deleted via Data Management', { projectId })
  }

  /** Delete everything: every table in the database. */
  async deleteAll(): Promise<void> {
    const tableNames = this.db.tables.map((t) => t.name)
    await this.db.transaction('rw', this.db.tables, async () => {
      for (const name of tableNames) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (this.db as any).table(name).clear()
      }
    })
    // The device key was wiped with everything else; drop the in-memory copy
    // so the next write creates a fresh key instead of reusing a stale one.
    clearCachedDeviceKey()
    logger.warn('All local data deleted via Data Management')
  }

  /** Clear only the API key + base URL + model; keep data. */
  async clearAISettings(): Promise<void> {
    await new SettingsService(this.db).update({
      apiKey: '',
      baseURL: '',
      model: '',
    })
  }

  /** Remove only the API key, keeping the endpoint and model configured. */
  async scrubApiKey(): Promise<void> {
    await new SettingsService(this.db).update({ apiKey: '' })
  }
}

export function ensureError(err: unknown): AppError {
  if (err instanceof AppError) return err
  return new AppError(err instanceof Error ? err.message : t('errors.unknownError'), 'UNKNOWN')
}
