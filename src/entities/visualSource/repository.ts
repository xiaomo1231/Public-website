import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { VisualSource, VisualSourceImageRow } from './types'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Persistence for preserved visual sources and their page images.
 *
 * Lookups are scoped by project (and usually document + page) so one project
 * can never serve another's figures.
 */
export class VisualSourceRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private table() {
    return this.db.table<VisualSource, string>('visualSources')
  }

  private imageTable() {
    return this.db.table<VisualSourceImageRow, string>('visualSourceImages')
  }

  async listByProject(projectId: string): Promise<VisualSource[]> {
    return this.table().where('projectId').equals(projectId).sortBy('createdAt')
  }

  async listByDocument(documentId: string): Promise<VisualSource[]> {
    return this.table().where('documentId').equals(documentId).sortBy('pageNumber')
  }

  async listByDocumentPage(documentId: string, pageNumber: number): Promise<VisualSource[]> {
    return this.table()
      .where('[documentId+pageNumber]')
      .equals([documentId, pageNumber])
      .toArray()
  }

  async get(id: string): Promise<VisualSource | undefined> {
    return this.table().get(id)
  }

  async upsert(source: VisualSource): Promise<VisualSource> {
    await this.table().put(source)
    return source
  }

  /** Store the rendered page image alongside its source. */
  async putImage(source: VisualSource, bytes: ArrayBuffer, mimeType: string): Promise<void> {
    await this.imageTable().put({
      id: source.id,
      projectId: source.projectId,
      bytes,
      mimeType,
    })
  }

  async getImage(id: string): Promise<Blob | null> {
    const row = await this.imageTable().get(id)
    if (!row) return null
    return new Blob([row.bytes], { type: row.mimeType })
  }

  async deleteByDocument(documentId: string): Promise<number> {
    const ids = (await this.listByDocument(documentId)).map((v) => v.id)
    if (ids.length === 0) return 0
    await this.table().where('documentId').equals(documentId).delete()
    await this.imageTable().bulkDelete(ids)
    return ids.length
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    await this.imageTable().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Visual sources deleted', { projectId, count })
    return count
  }
}
