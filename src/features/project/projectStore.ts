import { create } from 'zustand'
import type { Project } from '@/entities/project/types'
import { ProjectService } from '@/services/projectService'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

interface ProjectStoreState {
  projects: Project[]
  currentProjectId: string | null
  loading: boolean
  error: string | null
  loaded: boolean
}

interface ProjectStoreActions {
  load: () => Promise<void>
  create: (input: { name: string; subject: Project['subject']; description?: string }) => Promise<Project>
  rename: (id: string, name: string) => Promise<void>
  update: (id: string, patch: Partial<Project>) => Promise<void>
  remove: (id: string) => Promise<void>
  openProject: (id: string | null) => void
  getCurrent: () => Project | null
}

export type ProjectStore = ProjectStoreState & ProjectStoreActions

const service = new ProjectService()

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProjectId: null,
  loading: false,
  error: null,
  loaded: false,

  async load() {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const projects = await service.list()
      set({ projects, loading: false, loaded: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errors.failedToLoadProjects')
      logger.error('ProjectStore.load failed', undefined, err)
      set({ error: msg, loading: false, loaded: true })
    }
  },

  async create(input) {
    const project = await service.create(input)
    set((s) => ({ projects: [project, ...s.projects] }))
    return project
  },

  async rename(id, name) {
    const updated = await service.rename(id, name)
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? updated : p)),
    }))
  },

  async update(id, patch) {
    const updated = await service.update(id, patch)
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? updated : p)),
    }))
  },

  async remove(id) {
    await service.delete(id)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      currentProjectId: s.currentProjectId === id ? null : s.currentProjectId,
    }))
  },

  openProject(id) {
    set({ currentProjectId: id })
  },

  getCurrent() {
    const { projects, currentProjectId } = get()
    if (!currentProjectId) return null
    return projects.find((p) => p.id === currentProjectId) ?? null
  },
}))