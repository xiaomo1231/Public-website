import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ReferenceImage, ReferenceImageBlobRow } from './types'
import { logger } from '@/infrastructure/logger/logger'

/** Locally cached web reference images, scoped by project and topic. */
export class ReferenceImageRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private table() {
    return this.db.table<ReferenceImage, string>('referenceImages')
  }

  private blobTable() {
    return this.db.table<ReferenceImageBlobRow, string>('referenceImageBlobs')
  }

  async listByTopic(projectId: string, topicId: string): Promise<ReferenceImage[]> {
    return this.table().where('[projectId+topicId]').equals([projectId, topicId]).sortBy('createdAt')
  }

  async save(image: ReferenceImage, bytes: ArrayBuffer): Promise<void> {
    await this.db.transaction('rw', this.table(), this.blobTable(), async () => {
      await this.table().put(image)
      await this.blobTable().put({ id: image.id, projectId: image.projectId, bytes, mimeType: image.mimeType })
    })
  }

  async getImage(id: string): Promise<Blob | null> {
    const row = await this.blobTable().get(id)
    if (!row) return null
    return new Blob([row.bytes], { type: row.mimeType })
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction('rw', this.table(), this.blobTable(), async () => {
      await this.table().delete(id)
      await this.blobTable().delete(id)
    })
  }

  async deleteByProject(projectId: string): Promise<number> {
    const count = await this.table().where('projectId').equals(projectId).delete()
    await this.blobTable().where('projectId').equals(projectId).delete()
    if (count > 0) logger.warn('Reference images deleted', { projectId, count })
    return count
  }
}
