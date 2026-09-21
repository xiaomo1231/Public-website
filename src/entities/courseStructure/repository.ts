import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { CourseStructure, CourseStructureNode } from './types'

/** Persistence for the detected chapter/section hierarchy. */
export class CourseStructureRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  private structures() {
    return this.db.table<CourseStructure, string>('courseStructures')
  }
  private nodes() {
    return this.db.table<CourseStructureNode, string>('courseStructureNodes')
  }

  getByDocument(documentId: string): Promise<CourseStructure | undefined> {
    return this.structures().where('sourceDocumentId').equals(documentId).first()
  }

  listByProject(projectId: string): Promise<CourseStructure[]> {
    return this.structures().where('projectId').equals(projectId).toArray()
  }

  listNodes(structureId: string): Promise<CourseStructureNode[]> {
    return this.nodes().where('structureId').equals(structureId).sortBy('order')
  }

  /** Replace a structure and its nodes atomically. */
  async replace(structure: CourseStructure, nodes: CourseStructureNode[]): Promise<void> {
    await this.db.transaction('rw', this.structures(), this.nodes(), async () => {
      await this.structures().put(structure)
      await this.nodes().where('structureId').equals(structure.id).delete()
      if (nodes.length > 0) await this.nodes().bulkPut(nodes)
    })
  }

  async deleteByDocument(documentId: string): Promise<number> {
    const structures = await this.structures().where('sourceDocumentId').equals(documentId).toArray()
    for (const structure of structures) {
      await this.nodes().where('structureId').equals(structure.id).delete()
      await this.structures().delete(structure.id)
    }
    return structures.length
  }

  async deleteByProject(projectId: string): Promise<number> {
    const structures = await this.structures().where('projectId').equals(projectId).toArray()
    for (const structure of structures) {
      await this.nodes().where('structureId').equals(structure.id).delete()
    }
    return this.structures().where('projectId').equals(projectId).delete()
  }
}
