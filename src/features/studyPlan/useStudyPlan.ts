import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STUDY_PLAN_CHANGED, StudyPlanService, type TodayView } from '@/services/studyPlanService'
import type { PlannedExam } from '@/entities/studyPlan/types'
import { logger } from '@/infrastructure/logger/logger'

/** Run `callback` whenever the plan changes (exams, calendar, weights, tasks). */
export function useStudyPlanChanged(callback: () => void): void {
  const ref = useRef(callback)
  ref.current = callback
  useEffect(() => {
    const handler = () => ref.current()
    window.addEventListener(STUDY_PLAN_CHANGED, handler)
    return () => window.removeEventListener(STUDY_PLAN_CHANGED, handler)
  }, [])
}

export function useStudyPlanService(): StudyPlanService {
  return useMemo(() => new StudyPlanService(), [])
}

/** Planned exams (all, or one course's), kept current. */
export function useExams(projectId?: string): {
  exams: PlannedExam[]
  loaded: boolean
  refresh: () => void
} {
  const service = useStudyPlanService()
  const [exams, setExams] = useState<PlannedExam[]>([])
  const [loaded, setLoaded] = useState(false)
  const alive = useRef(true)
  const refresh = useCallback(() => {
    void service
      .listExams(projectId)
      .then((rows) => {
        if (!alive.current) return
        setExams(rows)
        setLoaded(true)
      })
      .catch((err) => {
        logger.warn('Study plan: exams not loaded', { error: String(err) })
        if (alive.current) setLoaded(true)
      })
  }, [service, projectId])
  useEffect(() => {
    alive.current = true
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])
  useStudyPlanChanged(refresh)
  return { exams, loaded, refresh }
}

/** Today's tasks (re-planned first when the layout is stale). */
export function useToday(projectId?: string): {
  today: TodayView | null
  refresh: () => void
  error: string | null
} {
  const service = useStudyPlanService()
  const [today, setToday] = useState<TodayView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const refresh = useCallback(() => {
    void (async () => {
      try {
        await service.replanIfStale()
        const view = await service.today(Date.now(), projectId)
        if (alive.current) {
          setToday(view)
          setError(null)
        }
      } catch (err) {
        if (alive.current) setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [service, projectId])
  useEffect(() => {
    alive.current = true
    refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])
  useStudyPlanChanged(refresh)
  return { today, refresh, error }
}
