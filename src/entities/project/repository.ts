import type { AppDatabase } from '@/infrastructure/db/database'
import type { CreateProjectInput, Project, UpdateProjectInput } from './types'
import { getDb } from '@/infrastructure/db/database'
import { NotFoundError, StorageError, ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

function normalizeName(name: string): string {
  return name.trim()
}

export class ProjectRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async list(): Promise<Project[]> {
    try {
      const rows = await this.db.projects.orderBy('createdAt').reverse().toArray()
      return rows
    } catch (err) {
      logger.error('ProjectRepository.list failed', undefined, err)
      throw new StorageError(t('storage.failedToListProjects'), err)
    }
  }

  async get(id: string): Promise<Project> {
    const row = await this.db.projects.get(id)
    if (!row) throw new NotFoundError('Project', id)
    return row
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const name = normalizeName(input.name)
    if (!name) throw new ValidationError(t('errors.projectNameRequired'))
    if (name.length > 80) throw new ValidationError(t('errors.projectNameTooLong'))

    const now = Date.now()
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      subject: input.subject,
      createdAt: now,
      updatedAt: now,
    }
    if (input.description !== undefined) project.description = input.description.trim()

    await this.db.projects.add(project)
    logger.info('Project created', { id: project.id, name: project.name })
    return project
  }

  async update(id: string, patch: UpdateProjectInput): Promise<Project> {
    const existing = await this.get(id)
    const next: Project = { ...existing, updatedAt: Date.now() }
    if (patch.name !== undefined) {
      const name = normalizeName(patch.name)
      if (!name) throw new ValidationError(t('errors.projectNameRequired'))
      next.name = name
    }
    if (patch.subject !== undefined) next.subject = patch.subject
    if (patch.description !== undefined) next.description = patch.description.trim()

    await this.db.projects.put(next)
    logger.info('Project updated', { id })
    return next
  }

  async delete(id: string): Promise<void> {
    const count = await this.db.projects.where('id').equals(id).delete()
    if (count === 0) throw new NotFoundError('Project', id)
    logger.warn('Project deleted', { id })
  }

  async count(): Promise<number> {
    return this.db.projects.count()
  }
}