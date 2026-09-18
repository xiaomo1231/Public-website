import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ProcessingJob, ProcessingStage } from './types'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

export class ProcessingJobRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async create(documentId: string, projectId: string): Promise<ProcessingJob> {
    const now = Date.now()
    const job: ProcessingJob = {
      id: crypto.randomUUID(),
      documentId,
      projectId,
      stage: 'queued',
      progress: 0,
      startedAt: now,
      updatedAt: now,
    }
    await this.db.processingJobs.add(job)
    return job
  }

  async getActiveByDocument(documentId: string): Promise<ProcessingJob | undefined> {
    return this.db.processingJobs
      .where('documentId')
      .equals(documentId)
      .filter((j) => j.stage !== 'done' && j.stage !== 'failed')
      .first()
  }

  async update(
    id: string,
    patch: Partial<Pick<ProcessingJob, 'stage' | 'progress' | 'message' | 'finishedAt' | 'errorMessage'>>,
  ): Promise<ProcessingJob> {
    const existing = await this.db.processingJobs.get(id)
    if (!existing) throw new StorageError(t('errors.jobNotFound'))
    const next: ProcessingJob = { ...existing, ...patch, updatedAt: Date.now() }
    await this.db.processingJobs.put(next)
    return next
  }

  async listByProject(projectId: string, limit = 20): Promise<ProcessingJob[]> {
    const rows = await this.db.processingJobs
      .where('projectId')
      .equals(projectId)
      .reverse()
      .sortBy('updatedAt')
    return rows.slice(0, limit)
  }

  async deleteByDocument(documentId: string): Promise<number> {
    return this.db.processingJobs.where('documentId').equals(documentId).delete()
  }

  async setStage(id: string, stage: ProcessingStage, progress = 0, message?: string): Promise<void> {
    await this.update(id, { stage, progress, message })
    logger.debug('Processing stage', { id, stage, progress })
  }
}