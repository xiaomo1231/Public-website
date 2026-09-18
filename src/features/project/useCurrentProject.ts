import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useProjects } from './useProjects'
import type { Project } from '@/entities/project/types'

/**
 * Returns the currently active project derived from the URL `:id` param.
 * Falls back to the first project in the list when no id is in the URL.
 */
export function useCurrentProject(): Project | null {
  const { id } = useParams<{ id?: string }>()
  const { projects, loaded } = useProjects()
  const [active, setActive] = useState<Project | null>(null)

  useEffect(() => {
    if (!loaded) return
    if (id) {
      const match = projects.find((p) => p.id === id) ?? null
      setActive(match)
      return
    }
    setActive(projects[0] ?? null)
  }, [id, projects, loaded])

  return active
}