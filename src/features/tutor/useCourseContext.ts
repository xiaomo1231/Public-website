import { useEffect, useState } from 'react'
import { CourseContextService } from '@/services/courseContextService'
import { buildAIServices } from '@/services/aiServices'
import type { CourseContext } from '@/entities/courseContext/types'

export interface CourseContextState {
  loading: boolean
  context: CourseContext | null
}

/**
 * Derived course context for a project: class progress and the professor's
 * teaching profile.
 *
 * Kept entirely separate from the tutor lesson cache — progress changing never
 * regenerates teaching content.
 */
export function useCourseContext(projectId: string | undefined): CourseContextState {
  const [loading, setLoading] = useState(true)
  const [context, setContext] = useState<CourseContext | null>(null)

  useEffect(() => {
    if (!projectId) {
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const service = new CourseContextService()
        const next = await service.syncDerived(projectId)
        if (cancelled) return
        setContext(next)

        // Professor style is a one-time AI extraction and must never block the
        // progress display.
        if (!next.professorProfile) {
          const services = await buildAIServices()
          if (services) void service.ensureProfessorProfile(projectId, services.ai)
        }
      } catch {
        if (!cancelled) setContext(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return { loading, context }
}
