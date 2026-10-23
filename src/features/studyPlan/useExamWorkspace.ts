import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExamWorkspaceView } from '@/services/studyPlanService'
import { NotFoundError } from '@/infrastructure/errors/AppError'
import { useStudyPlanChanged, useStudyPlanService } from './useStudyPlan'

/**
 * The 考试工作台 data of one exam, re-read whenever the plan changes (a task
 * done / moved, the exam edited) and when the tab becomes visible again.
 * `missing` = no such exam (deleted, or a stale link).
 */
export function useExamWorkspace(examId: string): {
  view: ExamWorkspaceView | null
  missing: boolean
  error: string | null
  refresh: () => void
} {
  const service = useStudyPlanService()
  const [view, setView] = useState<ExamWorkspaceView | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const seq = useRef(0)

  const refresh = useCallback(() => {
    const mine = ++seq.current
    void (async () => {
      try {
        await service.replanIfStale()
        const next = await service.examWorkspace(examId)
        if (!alive.current || mine !== seq.current) return
        setView(next)
        setMissing(false)
        setError(null)
      } catch (err) {
        if (!alive.current || mine !== seq.current) return
        if (err instanceof NotFoundError) {
          setMissing(true)
          setView(null)
        } else setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [service, examId])

  useEffect(() => {
    alive.current = true
    setView(null)
    setMissing(false)
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
  return { view, missing, error, refresh }
}
