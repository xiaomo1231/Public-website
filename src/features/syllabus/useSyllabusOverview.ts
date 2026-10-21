import { useCallback, useEffect, useState } from 'react'
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

  const reload = useCallback(async () => {
    try {
      const next = await new SyllabusService().overview(projectId)
      setOverview(next)
      setError(null)
    } catch (err) {
      logger.warn('Exam topic overview failed', { error: (err as Error)?.message })
      setError((err as Error)?.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, version])

  return { overview, loading, error, reload }
}
