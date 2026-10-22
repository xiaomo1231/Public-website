import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildGuidedStepsService,
  type GuidedQuestionState,
  type GuidedStepsService,
} from '@/services/guidedStepsService'
import type { GuidedProgress } from '@/entities/homework/guided'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { useGenerationRun, type UseGenerationRunResult } from '@/shared/lib/useGenerationRun'

const SAVE_DELAY_MS = 400

export interface UseGuidedQuestion {
  state: GuidedQuestionState | null
  loading: boolean
  error: string | null
  progress: GuidedProgress | null
  /** Change the progress; saved shortly after (and when leaving the question). */
  update: (change: (progress: GuidedProgress) => GuidedProgress) => void
  /** 准备引导练习: the one AI request for non-matrix questions (stoppable). */
  prepare: () => Promise<void>
  preparing: UseGenerationRunResult
  restart: () => Promise<void>
}

/**
 * One question's guided practice: its steps (from the walkthrough), the saved
 * progress (restored on reload) and the request that prepares blank steps.
 * `serviceOverride` is for tests.
 */
export function useGuidedQuestion(
  setId: string,
  questionId: string,
  serviceOverride?: GuidedStepsService,
): UseGuidedQuestion {
  const [service, setService] = useState<GuidedStepsService | null>(serviceOverride ?? null)
  const [state, setState] = useState<GuidedQuestionState | null>(null)
  const [progress, setProgress] = useState<GuidedProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const preparing = useGenerationRun({ abortOnUnmount: true })
  const pending = useRef<GuidedProgress | null>(null)
  const timer = useRef<number | null>(null)
  /** The save in flight, so 重新开始 can wait for it instead of racing it. */
  const saving = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (serviceOverride) return
    let alive = true
    void buildGuidedStepsService().then((next) => {
      if (alive) setService(next)
    })
    return () => {
      alive = false
    }
  }, [serviceOverride])

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    if (next && service)
      saving.current = service.saveProgress(questionId, next).catch(() => undefined)
  }, [questionId, service])

  // Save what is pending when the question changes or the page closes.
  useEffect(() => flush, [flush])

  const reload = useCallback(async () => {
    if (!service) return
    const next = await service.load(setId, questionId)
    setState(next)
    setProgress(next.progress)
  }, [service, setId, questionId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void reload()
      .catch((err) => {
        if (alive) setError(friendlyAIError(err))
      })
      .finally(() => {
        if (alive) setLoading(Boolean(!service))
      })
    return () => {
      alive = false
    }
  }, [reload, service])

  const update = useCallback(
    (change: (progress: GuidedProgress) => GuidedProgress) => {
      setProgress((previous) => {
        if (!previous) return previous
        const next = { ...change(previous), updatedAt: Date.now() }
        pending.current = next
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
        return next
      })
    },
    [flush],
  )

  const { start } = preparing
  const prepare = useCallback(async () => {
    if (!service) return
    setError(null)
    const run = start()
    try {
      const next = await service.prepareSteps(setId, questionId, { signal: run.signal })
      setState(next)
      setProgress(next.progress)
    } catch (err) {
      if (!isGenerationInterruption(err, run)) setError(friendlyAIError(err))
    } finally {
      run.finish()
    }
  }, [service, setId, questionId, start])

  const restart = useCallback(async () => {
    if (!service) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    // A save already sent would otherwise land after the reset and bring the
    // progress back.
    await saving.current
    await service.resetProgress(questionId)
    await reload()
  }, [service, questionId, reload])

  return { state, loading, error, progress, update, prepare, preparing, restart }
}
