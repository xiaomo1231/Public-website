import { useEffect, useState } from 'react'
import type { CreateProjectInput, Project, UpdateProjectInput } from '@/entities/project/types'
import { useProjectStore } from './projectStore'

/** Hook providing the project list + operations. Loads on mount. */
export function useProjects() {
  const store = useProjectStore()
  useEffect(() => {
    if (!store.loaded && !store.loading) {
      void store.load()
    }
  }, [store])

  return {
    projects: store.projects,
    loading: store.loading,
    error: store.error,
    loaded: store.loaded,
    create: (input: CreateProjectInput) => store.create(input),
    rename: (id: string, name: string) => store.rename(id, name),
    update: (id: string, patch: UpdateProjectInput) => store.update(id, patch),
    remove: (id: string) => store.remove(id),
  }
}

/** Hook for a single project by id. */
export function useProject(id: string | undefined): {
  project: Project | null
  loading: boolean
  update: (patch: UpdateProjectInput) => Promise<void>
  remove: () => Promise<void>
} {
  const store = useProjectStore()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setProject(null)
      setLoading(false)
      return
    }
    if (!store.loaded) {
      if (!store.loading) void store.load()
      // Stay in the loading state until the list is available. Resolving
      // `project` to null here would make callers briefly believe the project
      // does not exist, and they would redirect away from a valid deep link.
      setLoading(true)
      return
    }
    setProject(store.projects.find((p) => p.id === id) ?? null)
    setLoading(false)
  }, [id, store.projects, store.loaded, store.loading, store])

  return {
    project,
    loading,
    update: async (patch) => {
      if (!id) return
      await store.update(id, patch)
    },
    remove: async () => {
      if (!id) return
      await store.remove(id)
    },
  }
}