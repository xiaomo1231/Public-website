import { useCallback, useEffect, useRef, useState } from 'react'
import { SyllabusService, type SyllabusOverview } from '@/services/syllabusService'
import { logger } from '@/infrastructure/logger/logger'

/**
 * The exam-topic list of a course with its coverage. Reloads when `version`
 * changes (the caller passes something that moves with the documents, so a
 * syllabus that finishes processing shows up). Local only — no AI.
 */
export function useSyllabusOverview(
  projectId: string,
  version: unknown,
): {
  overview: SyllabusOverview | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
} {
  const [overview, setOverview] = useState<SyllabusOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Only the latest request may land: a slow read for the previous course (or
  // an older version) must never overwrite the current one.
  const request = useRef(0)
  const [shownProject, setShownProject] = useState(projectId)
  if (shownProject !== projectId) {
    // Another course: never show (or edit) the previous course's list.
    setShownProject(projectId)
    setOverview(null)
    setLoading(true)
    setError(null)
  }

  const reload = useCallback(async () => {
    const id = ++request.current
    try {
      const next = await new SyllabusService().overview(projectId)
      if (id !== request.current) return
      setOverview(next)
      setError(null)
    } catch (err) {
      if (id !== request.current) return
      logger.warn('Exam topic overview failed', { error: (err as Error)?.message })
      setError((err as Error)?.message ?? String(err))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  return { overview, loading, error, reload }
}
