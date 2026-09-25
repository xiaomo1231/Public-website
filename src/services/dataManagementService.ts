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
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { TranslationRepository } from '@/entities/translation/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { PracticeRepository } from '@/entities/practice/repository'
import { TutorLessonRepository } from '@/entities/tutorLesson/repository'
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
  visualSources: number
  translations: number
  mistakes: number
  knowledgeMastery: number
  inviteKeys: number
  processingJobs: number
  hasApiKey: boolean
  estimatedTotalBytes: number
}

export interface ExportBlob {
  id: string
  kind: 'document' | 'visualSource'
  mimeType: string
  bytesBase64: string
}

function encodeBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  const parts: string[] = []
  // Every non-final segment is divisible by three, so only the final
  // segment needs base64 padding and the segments can be joined directly.
  for (let i = 0; i < view.length; i += 8190) {
    parts.push(btoa(String.fromCharCode(...view.subarray(i, i + 8190))))
  }
  return parts.join('')
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
      visualSources,
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
      db.table('visualSources').count(),
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
      visualSources,
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

  /** Export restorable content without device secrets. Binary data is base64 encoded for JSON. */
  async exportAll(): Promise<{ json: Record<string, unknown>; blobs: ExportBlob[] }> {
    const db = this.db
    const tables = [
      'projects', 'documents', 'documentBlobs', 'chunks', 'processingJobs',
      'courseAnalyses', 'topics', 'concepts', 'formulas', 'symbols', 'examples',
      'courseExercises', 'prerequisites', 'tutorSessions', 'tutorLessons',
      'visualSources', 'courseContexts', 'courseStructures', 'courseStructureNodes',
      'practiceSets', 'practiceQuestions', 'practiceAttempts', 'translations',
      'questions', 'questionAttempts', 'quizzes', 'knowledgeMastery', 'mistakes',
      'inviteKeys', 'user', 'settings',
    ] as const
    const json: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      schemaVersion: this.db.verno,
      blobEncoding: 'base64',
    }
    for (const name of tables) {
      if (name === 'documentBlobs') continue // blobs exported separately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (db as any).table(name).toArray()
      if (name === 'settings') {
        json[name] = rows.map((row: Record<string, unknown>) => {
          const { apiKey, apiKeyEncrypted, ...safe } = row
          void apiKey
          void apiKeyEncrypted
          return safe
        })
      } else {
        json[name] = rows
      }
    }
    const blobs = await db.table('documentBlobs').toArray()
    const visualImages = await db.table('visualSourceImages').toArray()
    return {
      json,
      blobs: [
        ...blobs.map((b) => ({ id: b.id, kind: 'document' as const, bytesBase64: encodeBytes(b.bytes), mimeType: b.mimeType })),
        ...visualImages.map((b) => ({
          id: b.id,
          kind: 'visualSource' as const,
          bytesBase64: encodeBytes(b.bytes),
          mimeType: b.mimeType,
        })),
      ],
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
    const visualRepo = new VisualSourceRepository(this.db)
    const contextRepo = new CourseContextRepository(this.db)
    const structureRepo = new CourseStructureRepository(this.db)
    const practiceRepo = new PracticeRepository(this.db)
    const lessonRepo = new TutorLessonRepository(this.db)

    await this.db.transaction('rw', this.db.tables, async () => {
      await projectRepo.get(projectId)
      await docRepo.deleteByProject(projectId)
      await visualRepo.deleteByProject(projectId)
      await contextRepo.deleteByProject(projectId)
      await structureRepo.deleteByProject(projectId)
      await this.db.table('chunks').where('projectId').equals(projectId).delete()
      await analysesRepo.deleteByProject(projectId)
      await lessonRepo.deleteByProject(projectId)
      await practiceRepo.deleteByProject(projectId)
      await mastery.deleteByProject(projectId)
      await mistakeRepo.deleteByProject(projectId)
      await quizRepo.deleteByProject(projectId)
      await questionRepo.deleteByProject(projectId)
      await attemptRepo.deleteByProject(projectId)
      await sessionRepo.deleteByProject(projectId)
      await translationRepo.deleteByProject(projectId)
      await projectRepo.delete(projectId)
    })
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
