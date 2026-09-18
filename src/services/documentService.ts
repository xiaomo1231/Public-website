import type { DocumentRepository } from '@/entities/document/repository'
import type { ProjectService } from './projectService'
import { type CreateDocumentInput, type Document, type UpdateDocumentInput } from '@/entities/document/types'
import { logger } from '@/infrastructure/logger/logger'
import { NotFoundError, ValidationError } from '@/infrastructure/errors/AppError'

export class DocumentService {
  private repo: DocumentRepository
  private projects: ProjectService

  constructor(deps: { documents: DocumentRepository; projects: ProjectService }) {
    this.repo = deps.documents
    this.projects = deps.projects
  }

  listByProject(projectId: string): Promise<Document[]> {
    return this.repo.listByProject(projectId)
  }

  get(id: string): Promise<Document> {
    return this.repo.get(id)
  }

  async create(input: CreateDocumentInput): Promise<Document> {
    await this.projects.get(input.projectId) // verify project exists
    return this.repo.create(input)
  }

  async rename(id: string, name: string): Promise<Document> {
    if (!name.trim()) throw new ValidationError('Document name is required')
    return this.repo.update(id, { name: name.trim() })
  }

  update(id: string, patch: UpdateDocumentInput): Promise<Document> {
    return this.repo.update(id, patch)
  }

  async delete(id: string): Promise<void> {
    const doc = await this.repo.get(id)
    await this.repo.delete(id)
    logger.info('Document removed via service', { id, projectId: doc.projectId })
  }

  async deleteByProject(projectId: string): Promise<number> {
    const n = await this.repo.deleteByProject(projectId)
    logger.warn('All documents removed by project', { projectId, count: n })
    return n
  }

  getBlob(id: string): Promise<Blob | null> {
    return this.repo.getBlob(id)
  }

  async existsInProject(id: string, projectId: string): Promise<boolean> {
    try {
      const doc = await this.repo.get(id)
      return doc.projectId === projectId
    } catch (err) {
      if (err instanceof NotFoundError) return false
      throw err
    }
  }

  countByProject(projectId: string): Promise<number> {
    return this.repo.countByProject(projectId)
  }
}