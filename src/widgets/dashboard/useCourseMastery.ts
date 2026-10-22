import { useEffect, useState } from 'react'
import { MasteryService } from '@/services/masteryService'
import { practicedMasteryAverage } from '@/shared/lib/percent'

export interface CourseMasteryEstimate {
  /** Mean mastery estimate (0..1) over the practised knowledge points. */
  average: number
  /** How many practised knowledge points the mean is based on. */
  points: number
}

/**
 * Read-only per-course mastery estimate, computed exactly like the mastery
 * page's "average": the mean over knowledge points with at least one attempt.
 * A course with no practice has no entry — never a made-up zero.
 */
export function useCourseMastery(
  projectIds: readonly string[],
): Record<string, CourseMasteryEstimate> {
  const [byProject, setByProject] = useState<Record<string, CourseMasteryEstimate>>({})
  const key = projectIds.join('|')

  useEffect(() => {
    if (!key) {
      setByProject({})
      return
    }
    let cancelled = false
    const service = new MasteryService()
    const ids = key.split('|')
    void Promise.all(
      ids.map(async (id) => {
        try {
          const rows = await service.listByProject(id)
          const average = practicedMasteryAverage(rows)
          if (average === null) return null
          const points = rows.filter((row) => row.attempts > 0).length
          return [id, { average, points }] as const
        } catch {
          return null
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      const next: Record<string, CourseMasteryEstimate> = {}
      for (const entry of entries) if (entry) next[entry[0]] = entry[1]
      setByProject(next)
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return byProject
}
