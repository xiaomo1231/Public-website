import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@/entities/project/types'
import { HomeOverviewService, type HomeOverview } from '@/services/homeOverviewService'

/**
 * Loads the homepage summary for the given projects. Re-runs when the project
 * list changes (create / rename / delete / touch) and whenever `refresh()` is
 * called (e.g. after an upload or analysis on the same page). A failed load
 * leaves `overview` null so the page can fall back to the plain project list.
 * A refresh keeps the previous overview on screen until the new one arrives.
 */
export function useHomeOverview(projects: readonly Project[], enabled: boolean) {
  const [overview, setOverview] = useState<HomeOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    if (version === 0) setLoading(true)
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
  }, [projects, enabled, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  return { overview, loading, error, refresh }
}
