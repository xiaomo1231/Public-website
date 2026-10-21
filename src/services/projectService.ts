import type { AppDatabase } from '@/infrastructure/db/database'
import { ProjectRepository } from '@/entities/project/repository'
import type { CreateProjectInput, Project, UpdateProjectInput } from '@/entities/project/types'
import { logger } from '@/infrastructure/logger/logger'
import { DataManagementService } from './dataManagementService'

export class ProjectService {
  private repo: ProjectRepository
  private db?: AppDatabase

  constructor(db?: AppDatabase) {
    this.repo = new ProjectRepository(db)
    this.db = db
  }

  list(): Promise<Project[]> {
    return this.repo.list()
  }

  get(id: string): Promise<Project> {
    return this.repo.get(id)
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const project = await this.repo.create(input)
    return project
  }

  rename(id: string, name: string): Promise<Project> {
    return this.repo.update(id, { name })
  }

  update(id: string, patch: UpdateProjectInput): Promise<Project> {
    return this.repo.update(id, patch)
  }

  /** Delete the project and every row that belongs to it, in one transaction. */
  async delete(id: string): Promise<void> {
    await new DataManagementService(this.db).deleteProject(id)
    logger.info('Project removed via service', { id })
  }

  count(): Promise<number> {
    return this.repo.count()
  }
}