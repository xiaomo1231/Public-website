import Dexie, { type Transaction } from 'dexie'
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
import { ReferenceImageRepository } from '@/entities/referenceImage/repository'
import { ReviewCardRepository } from '@/entities/reviewCard/repository'
import { VocabRepository } from '@/entities/vocab/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { TranslationRepository } from '@/entities/translation/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { PracticeRepository } from '@/entities/practice/repository'
import { TutorLessonRepository } from '@/entities/tutorLesson/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { SlideLessonRepository } from '@/entities/slideLesson/repository'
import { InterviewSessionRepository } from '@/entities/interview/repository'
import { SettingsService } from './settingsService'
import { clearCachedDeviceKey } from '@/infrastructure/crypto/deviceKey'

import { AppError, BackupError } from '@/infrastructure/errors/AppError'
import { ensureStorageFor, isQuotaError } from '@/infrastructure/files/storageSpace'
import {
  BackupFormatError,
  scanBackup,
  type BackupBlobEntry,
} from '@/infrastructure/backup/backupReader'
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
  kind: 'document' | 'visualSource' | 'homeworkAnswerImage'
  mimeType: string
  /**
   * The stored row's other fields (currently `projectId`). Added after
   * V0.7.0; older backups only carry id / kind / mimeType / bytes.
   */
  projectId?: string
  bytesBase64: string
}

/** Counts shown before a restore; nothing has been written yet. */
export interface BackupSummary {
  exportedAt: string | null
  schemaVersion: number
  counts: {
    projects: number
    documents: number
    /** Stored files and page images that will be restored. */
    files: number
    fileBytes: number
    quizzes: number
    mistakes: number
    vocabWords: number
    reviewCards: number
  }
  /** Rows per restored table. */
  tableRows: Record<string, number>
  /** Rows without a usable primary key, per table; they are left out. */
  droppedRows: Record<string, number>
  /** Keys of `json` that are not restorable tables; they are ignored. */
  ignoredTables: string[]
  /** Stored files that cannot be restored (unknown kind, no data, owner unknown). */
  skippedFiles: number
  /** Approximate size of the table data in the file. */
  jsonBytes: number
}

export type RestoreStage = 'checking' | 'writing' | 'files'

export interface RestoreProgress {
  stage: RestoreStage
  /** Bytes for checking / writing, files for the files stage. */
  done: number
  total: number
}

export interface BackupReadOptions {
  /** Bytes per file read; tests use a tiny value. */
  chunkSize?: number
  /** Bytes of the file read so far. */
  onBytes?: (read: number, total: number) => void
}

export interface RestoreOptions {
  /** Bytes per file read; tests use a tiny value. */
  chunkSize?: number
  onProgress?: (progress: RestoreProgress) => void
}

/**
 * Base64 of `bytes` as consecutive pieces of at most ~11 MB each. Every
 * non-final segment is divisible by three, so only the final segment needs
 * padding and the pieces concatenate into the full encoding.
 */
function encodeBytesParts(bytes: ArrayBuffer): string[] {
  const view = new Uint8Array(bytes)
  const pieces: string[] = []
  let segments: string[] = []
  for (let i = 0; i < view.length; i += 8190) {
    segments.push(btoa(String.fromCharCode(...view.subarray(i, i + 8190))))
    if (segments.length === 1024) {
      pieces.push(segments.join(''))
      segments = []
    }
  }
  if (segments.length) pieces.push(segments.join(''))
  return pieces
}

function encodeBytes(bytes: ArrayBuffer): string {
  return encodeBytesParts(bytes).join('')
}

/** Stored binary tables in export order, with the `kind` each row is exported as. */
const BINARY_TABLES = [
  { table: 'documentBlobs', kind: 'document' },
  { table: 'visualSourceImages', kind: 'visualSource' },
  // Images of handwritten homework working; each row carries its own
  // projectId / setId / questionId / order, exported as the entry's fields.
  { table: 'homeworkAnswerImages', kind: 'homeworkAnswerImage' },
] as const

/** Tables exported as rows in `json` (binary tables go to `blobs`). */
export const EXPORTED_TABLES = [
  'projects',
  'documents',
  'chunks',
  'processingJobs',
  'courseAnalyses',
  'topics',
  'concepts',
  'formulas',
  'symbols',
  'examples',
  'courseExercises',
  'prerequisites',
  'tutorSessions',
  'tutorLessons',
  'visualSources',
  'courseContexts',
  'courseStructures',
  'courseStructureNodes',
  'practiceSets',
  'practiceQuestions',
  'practiceAttempts',
  'homeworkSets',
  'homeworkQuestions',
  'homeworkWalkthroughs',
  'walkthroughNotes',
  'interviewSessions',
  'slideLessons',
  'translations',
  'reviewCards',
  'vocabCards',
  'vocabBooks',
  'vocabEntries',
  'vocabReviews',
  'questions',
  'questionAttempts',
  'quizzes',
  'knowledgeMastery',
  'mistakes',
  'inviteKeys',
  'user',
  'settings',
] as const

/**
 * Tables deliberately left out of the export:
 * - `cryptoKeys`: the device key never leaves the device (and is kept on restore).
 * - `referenceImages` / `referenceImageBlobs`: a re-fetchable web image cache.
 */
export const NOT_EXPORTED_TABLES = ['cryptoKeys', 'referenceImages', 'referenceImageBlobs'] as const

/** Tables whose only row is `singleton`. */
const SINGLETON_TABLES = new Set(['user', 'settings'])

/** Rows written per bulkPut while restoring. */
const RESTORE_BATCH = 500

/** The stored row's fields other than the bytes, id / kind / mimeType first. */
function blobHead(row: Record<string, unknown>, kind: string): Record<string, unknown> {
  const { id, mimeType, bytes, kind: ignored, ...rest } = row
  void bytes
  void ignored
  return { id, kind, mimeType, ...rest }
}

function stripSecrets(row: Record<string, unknown>): Record<string, unknown> {
  const { apiKey, apiKeyEncrypted, adminApiKeyEncrypted, ...safe } = row
  void apiKey
  void apiKeyEncrypted
  void adminApiKeyEncrypted
  return safe
}

function isUsableKey(value: unknown): boolean {
  return (
    (typeof value === 'string' && value.length > 0) ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

interface RestoreWriter {
  putRows(table: string, rows: Record<string, unknown>[]): Promise<void>
  putBlob(table: string, row: Record<string, unknown>): Promise<void>
}

interface ScanOptions extends BackupReadOptions {
  decode: boolean
  wait?: <T>(promise: Promise<T>) => Promise<T>
  writer?: RestoreWriter
  onJsonEnd?: () => void
  onFile?: () => void
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
    // Sum the recorded sizes instead of loading every stored file into memory.
    let blobBytes = 0
    await db.table('documents').each((doc: { hasBlob?: boolean; sizeBytes?: number }) => {
      if (doc.hasBlob) blobBytes += doc.sizeBytes ?? 0
    })
    // Page images kept from course files and cached reference images also
    // occupy storage; count their bytes too.
    for (const name of ['visualSourceImages', 'referenceImageBlobs', 'homeworkAnswerImages']) {
      await db.table(name).each((row: { bytes?: ArrayBuffer; sizeBytes?: number }) => {
        blobBytes += row.bytes?.byteLength ?? row.sizeBytes ?? 0
      })
    }
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
    const json = await this.exportTables()
    const blobs: ExportBlob[] = []
    for (const { table, kind } of BINARY_TABLES) {
      const rows = await this.db.table(table).toArray()
      for (const row of rows)
        blobs.push({
          ...blobHead(row, kind),
          bytesBase64: encodeBytes(row.bytes),
        } as ExportBlob)
    }
    return { json, blobs }
  }

  /**
   * The export as a downloadable file: the same JSON as
   * `JSON.stringify(await exportAll())`, but built one stored file at a time
   * from Blob parts, so large course files never become one giant string
   * (browsers cap a string near 512 MB) or sit in memory all at once.
   */
  async exportFile(): Promise<Blob> {
    const json = await this.exportTables()
    let file = new Blob([`{"json":${JSON.stringify(json)},"blobs":[`])
    let first = true
    for (const { table, kind } of BINARY_TABLES) {
      const keys = await this.db.table(table).toCollection().primaryKeys()
      for (const key of keys) {
        const row = await this.db.table(table).get(key)
        if (!row) continue
        const head = JSON.stringify(blobHead(row, kind)).slice(0, -1)
        file = new Blob([
          file,
          first ? '' : ',',
          head,
          ',"bytesBase64":"',
          ...encodeBytesParts(row.bytes),
          '"}',
        ])
        first = false
      }
    }
    return new Blob([file, ']}'], { type: 'application/json' })
  }

  private async exportTables(): Promise<Record<string, unknown>> {
    const db = this.db
    const json: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      schemaVersion: this.db.verno,
      blobEncoding: 'base64',
    }
    for (const name of EXPORTED_TABLES) {
      const rows = await db.table(name).toArray()
      if (name === 'settings') {
        json[name] = rows.map(stripSecrets)
      } else {
        json[name] = rows
      }
    }
    return json
  }

  /**
   * Read a backup file and describe what restoring it would do, without
   * writing anything. Throws `BackupError` for unreadable or too-new files.
   */
  async inspectBackup(file: Blob, options: BackupReadOptions = {}): Promise<BackupSummary> {
    try {
      return await this.scanFile(file, { ...options, decode: false })
    } catch (err) {
      throw toBackupError(err)
    }
  }

  /**
   * Replace every local table (except the device key) with the backup's
   * contents, in one transaction: on any failure nothing changes.
   *
   * The backup has no API key, so the key is empty afterwards. Cached web
   * reference images belong to the replaced data and are cleared.
   */
  async restoreFromFile(file: Blob, options: RestoreOptions = {}): Promise<BackupSummary> {
    const { onProgress, chunkSize } = options
    const summary = await this.inspectBackup(file, {
      chunkSize,
      onBytes: (read, total) => onProgress?.({ stage: 'checking', done: read, total }),
    })
    try {
      await ensureStorageFor(summary.counts.fileBytes + summary.jsonBytes)
    } catch (err) {
      throw toBackupError(err)
    }

    const tables = this.db.tables.filter((table) => table.name !== 'cryptoKeys')
    let jsonDone = false
    let filesDone = 0
    try {
      await this.db.transaction('rw', tables, async () => {
        // The scan awaits many plain (non-Dexie) promises, after which Dexie's
        // implicit transaction zone is no longer reliable. Every write and
        // wait therefore goes through the transaction object itself.
        const tx = Dexie.currentTransaction as Transaction & {
          waitFor?: <T>(promise: Promise<T>) => Promise<T>
        }
        const writer: RestoreWriter = {
          putRows: async (table, rows) => {
            await tx.table(table).bulkPut(rows)
          },
          putBlob: async (table, row) => {
            await tx.table(table).put(row)
          },
        }
        for (const table of tables) await tx.table(table.name).clear()
        await this.scanFile(file, {
          chunkSize,
          decode: true,
          // File reads are not IndexedDB requests; waiting through the
          // transaction keeps it alive across them (Dexie.waitFor's mechanism).
          wait: (promise) => (tx.waitFor ? tx.waitFor(promise) : Dexie.waitFor(promise)),
          writer,
          onBytes: (read, total) => {
            if (!jsonDone) onProgress?.({ stage: 'writing', done: read, total })
          },
          onJsonEnd: () => {
            jsonDone = true
            onProgress?.({ stage: 'files', done: 0, total: summary.counts.files })
          },
          onFile: () => {
            filesDone++
            onProgress?.({ stage: 'files', done: filesDone, total: summary.counts.files })
          },
        })
      })
    } catch (err) {
      logger.error('Backup restore failed; local data unchanged', {
        error: err instanceof Error ? err.name : 'unknown',
      })
      throw toBackupError(err)
    }
    logger.warn('Local data replaced from a backup', {
      schemaVersion: summary.schemaVersion,
      tables: Object.keys(summary.tableRows).length,
      files: summary.counts.files,
      skippedFiles: summary.skippedFiles,
      ignoredTables: summary.ignoredTables.length,
    })
    return summary
  }

  /** One pass over a backup file: validate, count and (with a writer) write. */
  private async scanFile(file: Blob, options: ScanOptions): Promise<BackupSummary> {
    const db = this.db
    const restorable = new Set<string>(EXPORTED_TABLES)
    const keyPaths = new Map<string, string>()
    for (const name of restorable) {
      keyPaths.set(name, db.table(name).schema.primKey.keyPath as string)
    }
    const summary: BackupSummary = {
      exportedAt: null,
      schemaVersion: 0,
      counts: {
        projects: 0,
        documents: 0,
        files: 0,
        fileBytes: 0,
        quizzes: 0,
        mistakes: 0,
        vocabWords: 0,
        reviewCards: 0,
      },
      tableRows: {},
      droppedRows: {},
      ignoredTables: [],
      skippedFiles: 0,
      jsonBytes: 0,
    }
    // Owners of stored files, for older backups whose file entries lack projectId.
    const owners: Record<string, Map<string, string>> = {
      documents: new Map(),
      visualSources: new Map(),
    }
    let bytesRead = 0
    let pending: Record<string, unknown>[] = []
    const flush = async (table: string) => {
      if (options.writer && pending.length) await options.writer.putRows(table, pending)
      pending = []
    }

    await scanBackup(
      file,
      {
        meta: (key, value) => {
          if (key === 'schemaVersion') {
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
              throw new BackupFormatError('schemaVersion is not a version number')
            }
            if (value > db.verno) {
              throw new BackupError(
                t('backup.errors.newerVersion', { backup: value, current: db.verno }),
                'BACKUP_NEWER_VERSION',
              )
            }
            summary.schemaVersion = value
          } else if (key === 'exportedAt') {
            summary.exportedAt = typeof value === 'string' ? value : null
          } else if (key === 'blobEncoding' && value !== 'base64') {
            throw new BackupFormatError('unsupported file encoding')
          }
        },
        tableStart: (table) => {
          if (restorable.has(table)) {
            summary.tableRows[table] ??= 0
            return true
          }
          if (!summary.ignoredTables.includes(table)) summary.ignoredTables.push(table)
          return false
        },
        row: async (table, raw) => {
          const keyPath = keyPaths.get(table)!
          const valid =
            raw !== null &&
            typeof raw === 'object' &&
            !Array.isArray(raw) &&
            isUsableKey((raw as Record<string, unknown>)[keyPath]) &&
            (!SINGLETON_TABLES.has(table) ||
              (raw as Record<string, unknown>)[keyPath] === 'singleton')
          if (!valid) {
            summary.droppedRows[table] = (summary.droppedRows[table] ?? 0) + 1
            return
          }
          let row = raw as Record<string, unknown>
          if (table === 'settings') row = stripSecrets(row)
          summary.tableRows[table] = (summary.tableRows[table] ?? 0) + 1
          const owner = owners[table]
          if (owner && typeof row.id === 'string' && typeof row.projectId === 'string') {
            owner.set(row.id, row.projectId)
          }
          if (options.writer) {
            pending.push(row)
            if (pending.length >= RESTORE_BATCH) await flush(table)
          }
        },
        tableEnd: (table) => flush(table),
        jsonEnd: () => {
          if (!summary.schemaVersion) throw new BackupFormatError('no schemaVersion')
          summary.jsonBytes = bytesRead
          options.onJsonEnd?.()
        },
        blob: async (entry) => {
          const resolved = resolveBlob(entry, owners)
          if (!resolved) {
            summary.skippedFiles++
            return
          }
          summary.counts.files++
          summary.counts.fileBytes += entry.size
          if (options.writer) await options.writer.putBlob(resolved.table, resolved.row)
          options.onFile?.()
        },
      },
      {
        chunkSize: options.chunkSize,
        decodeBlobs: options.decode,
        wait: options.wait,
        onBytes: (read, total) => {
          bytesRead = read
          options.onBytes?.(read, total)
        },
      },
    )

    const rows = summary.tableRows
    summary.counts.projects = rows.projects ?? 0
    summary.counts.documents = rows.documents ?? 0
    summary.counts.quizzes = rows.quizzes ?? 0
    summary.counts.mistakes = rows.mistakes ?? 0
    summary.counts.vocabWords = rows.vocabCards ?? 0
    summary.counts.reviewCards = rows.reviewCards ?? 0
    return summary
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
    const referenceRepo = new ReferenceImageRepository(this.db)
    const cardRepo = new ReviewCardRepository(this.db)
    const vocabRepo = new VocabRepository(this.db)
    const contextRepo = new CourseContextRepository(this.db)
    const structureRepo = new CourseStructureRepository(this.db)
    const practiceRepo = new PracticeRepository(this.db)
    const lessonRepo = new TutorLessonRepository(this.db)
    const homeworkRepo = new HomeworkRepository(this.db)
    const slideRepo = new SlideLessonRepository(this.db)
    const interviewRepo = new InterviewSessionRepository(this.db)

    await this.db.transaction('rw', this.db.tables, async () => {
      await projectRepo.get(projectId)
      // If the selected word book is this course's book, fall back to the default.
      const courseBooks = await this.db.vocabBooks
        .where('projectId')
        .equals(projectId)
        .primaryKeys()
      const profile = await this.db.user.get('singleton')
      if (profile?.vocabBookId && courseBooks.includes(profile.vocabBookId)) {
        await this.db.user.put({ ...profile, vocabBookId: '' })
      }
      await docRepo.deleteByProject(projectId)
      await visualRepo.deleteByProject(projectId)
      await referenceRepo.deleteByProject(projectId)
      await cardRepo.deleteByProject(projectId)
      // The course's word book goes; word progress is global and stays.
      await vocabRepo.deleteByProject(projectId)
      await contextRepo.deleteByProject(projectId)
      await structureRepo.deleteByProject(projectId)
      await this.db.table('chunks').where('projectId').equals(projectId).delete()
      await analysesRepo.deleteByProject(projectId)
      await lessonRepo.deleteByProject(projectId)
      await practiceRepo.deleteByProject(projectId)
      await homeworkRepo.deleteByProject(projectId)
      await slideRepo.deleteByProject(projectId)
      await interviewRepo.deleteByProject(projectId)
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

/**
 * The stored row for a backup file entry, or null when it cannot be restored.
 * Older backups lack `projectId`; it is taken from the owning document or
 * visual source row.
 */
function resolveBlob(
  entry: BackupBlobEntry,
  owners: Record<string, Map<string, string>>,
): { table: string; row: Record<string, unknown> } | null {
  const { kind, ...fields } = entry.fields
  const binary = BINARY_TABLES.find((b) => b.kind === kind)
  const id = fields.id
  if (!binary || !entry.hasBytes || typeof id !== 'string' || !id) return null
  let projectId = fields.projectId
  if ((typeof projectId !== 'string' || !projectId) && binary.kind !== 'homeworkAnswerImage') {
    // Answer images were always exported with their projectId.
    projectId = owners[binary.kind === 'document' ? 'documents' : 'visualSources']!.get(id)
  }
  if (typeof projectId !== 'string') return null
  const mimeType =
    typeof fields.mimeType === 'string' && fields.mimeType
      ? fields.mimeType
      : 'application/octet-stream'
  return {
    table: binary.table,
    // Decoding was skipped only in inspect mode, which has no writer.
    row: { ...fields, id, projectId, mimeType, bytes: entry.bytes ?? new ArrayBuffer(0) },
  }
}

/** Every backup failure as an actionable `BackupError` (data was not changed). */
function toBackupError(err: unknown): AppError {
  if (err instanceof BackupError) return err
  if (err instanceof BackupFormatError) {
    return new BackupError(t('backup.errors.invalid'), 'BACKUP_INVALID', err)
  }
  if (isQuotaError(err)) {
    return new BackupError(t('backup.errors.storageFull'), 'BACKUP_STORAGE_FULL', err)
  }
  // Not enough free space (checked before writing) keeps its own message.
  if (err instanceof AppError) return err
  return new BackupError(
    t('backup.errors.restoreFailed', {
      reason: err instanceof Error ? err.message : String(err),
    }),
    'BACKUP_INVALID',
    err,
  )
}

export function ensureError(err: unknown): AppError {
  if (err instanceof AppError) return err
  return new AppError(err instanceof Error ? err.message : t('errors.unknownError'), 'UNKNOWN')
}
