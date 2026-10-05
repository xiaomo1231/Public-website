import { useEffect, useState } from 'react'
import type { Project } from '@/entities/project/types'
import { HomeOverviewService, type HomeOverview } from '@/services/homeOverviewService'

/**
 * Loads the homepage summary for the given projects. Re-runs when the project
 * list changes (create / rename / delete / touch). A failed load leaves
 * `overview` null so the page can fall back to the plain project list.
 */
export function useHomeOverview(projects: readonly Project[], enabled: boolean) {
  const [overview, setOverview] = useState<HomeOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    new HomeOverviewService()
      .load(projects)
      .then((data) => {
        if (cancelled) return
        setOverview(data)
        setError(false)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projects, enabled])

  return { overview, loading, error }
}
