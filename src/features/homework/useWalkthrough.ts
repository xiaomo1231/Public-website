import { useCallback, useEffect, useState } from 'react'
import { buildHomeworkWalkthroughService } from '@/services/aiServices'
import {
  subscribeWalkthroughRuns,
  walkthroughPausedRun,
  walkthroughRunControl,
  walkthroughRunProgress,
  type HomeworkWalkthroughService,
  type WalkthroughPausedRun,
  type WalkthroughProgress,
  type WalkthroughRunResult,
  type WalkthroughState,
} from '@/services/homeworkWalkthroughService'
import { WalkthroughNoteService } from '@/services/walkthroughNoteService'
import type { WalkthroughNote } from '@/entities/homework/walkthrough'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import type { GenerationRun, GenerationRunState } from '@/shared/lib/generationControl'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { subscribeNoteChanges } from './floatingQA'

export interface UseWalkthrough {
  state: WalkthroughState | null
  notes: WalkthroughNote[]
  progress: WalkthroughProgress | undefined
  loading: boolean
  error: string | null
  generate: (force?: boolean) => Promise<WalkthroughRunResult | null>
  /** Continue a paused run with only what is left. */
  resume: () => Promise<WalkthroughRunResult | null>
  /** The run in progress (`running` / `pausing`), or how the last one ended. */
  runState: GenerationRunState | null
  /** An immediate stop was requested for the run in progress. */
  stopRequested: boolean
  /** A run paused during this page visit (finished / planned parts). */
  paused: WalkthroughPausedRun | undefined
  requestPause: () => void
  stopNow: () => void
  /** An AI provider is configured. */
  aiReady: boolean
  /** Rewrite one section, optionally following the student's suggestion. */
  regenerateSection: (
    sectionId: string,
    suggestion?: string,
  ) => Promise<WalkthroughRunResult | null>
  /** Swap a section with the version its last regeneration replaced. */
  restorePrevious: (sectionId: string) => Promise<boolean>
  /** 补充题目分析: write only the analysis of an older question section. */
  addAnalysis: (sectionId: string) => Promise<WalkthroughRunResult | null>
}

/**
 * The walkthrough of one assignment, its saved notes and any run in progress.
 * Sections appear as soon as they are saved: every progress event re-reads.
 */
export function useWalkthrough(setId: string): UseWalkthrough {
  const [service, setService] = useState<HomeworkWalkthroughService | null>(null)
  const [state, setState] = useState<WalkthroughState | null>(null)
  const [notes, setNotes] = useState<WalkthroughNote[]>([])
  const [progress, setProgress] = useState<WalkthroughProgress | undefined>(() =>
    walkthroughRunProgress(setId),
  )
  const [paused, setPaused] = useState<WalkthroughPausedRun | undefined>(() =>
    walkthroughPausedRun(setId),
  )
  const control = useGenerationRun()
  const { attach, start: startRun } = control
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void buildHomeworkWalkthroughService().then((next) => {
      if (alive) setService(next)
    })
    return () => {
      alive = false
    }
  }, [])

  const reload = useCallback(async () => {
    if (!service) return
    try {
      setState(await service.state(setId))
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setLoading(false)
    }
  }, [service, setId])

  const reloadNotes = useCallback(async () => {
    setNotes(await new WalkthroughNoteService().list(setId))
  }, [setId])

  useEffect(() => {
    void reload()
    void reloadNotes()
  }, [reload, reloadNotes])

  useEffect(
    () =>
      subscribeWalkthroughRuns(() => {
        setProgress(walkthroughRunProgress(setId))
        setPaused(walkthroughPausedRun(setId))
        // A run started elsewhere (or before a remount) can still be paused here.
        const running = walkthroughRunControl(setId)
        if (running) attach(running)
        void reload()
      }),
    [attach, reload, setId],
  )

  useEffect(() => {
    const running = walkthroughRunControl(setId)
    if (running) attach(running)
  }, [attach, setId])

  useEffect(() => subscribeNoteChanges(() => void reloadNotes()), [reloadNotes])

  const start = useCallback(
    async (
      launch: (
        service: HomeworkWalkthroughService,
        run: GenerationRun,
      ) => Promise<WalkthroughRunResult>,
    ) => {
      if (!service) return null
      setError(null)
      const run = startRun()
      try {
        const result = await launch(service, run)
        run.finish()
        return result
      } catch (err) {
        run.finish()
        setError(friendlyAIError(err))
        return null
      } finally {
        setPaused(walkthroughPausedRun(setId))
        await reload()
      }
    },
    [service, setId, reload, startRun],
  )

  const generate = useCallback(
    (force = false) => start((svc, run) => svc.generate(setId, { force, control: run })),
    [start, setId],
  )
  const resume = useCallback(
    () => start((svc, run) => svc.resume(setId, { control: run })),
    [start, setId],
  )
  const regenerateSection = useCallback(
    (sectionId: string, suggestion?: string) =>
      start((svc, run) =>
        svc.regenerateSection(setId, sectionId, {
          ...(suggestion?.trim() ? { suggestion } : {}),
          control: run,
        }),
      ),
    [start, setId],
  )
  const addAnalysis = useCallback(
    (sectionId: string) => start((svc, run) => svc.addAnalysis(setId, sectionId, { control: run })),
    [start, setId],
  )
  const restorePrevious = useCallback(
    async (sectionId: string) => {
      if (!service) return false
      setError(null)
      try {
        await service.restorePrevious(setId, sectionId)
        return true
      } catch (err) {
        setError(friendlyAIError(err))
        return false
      } finally {
        await reload()
      }
    },
    [service, setId, reload],
  )

  // The run state shown: the live run, else a paused run of this visit.
  const live = control.state === 'running' || control.state === 'pausing'
  const runState: GenerationRunState | null = live
    ? control.state
    : progress
      ? 'running'
      : paused
        ? paused.stopped
          ? 'stopped'
          : 'paused'
        : null

  return {
    state,
    notes,
    progress,
    loading: loading || !service,
    error,
    generate,
    resume,
    runState,
    stopRequested: control.run?.stopRequested ?? false,
    paused,
    requestPause: control.requestPause,
    stopNow: control.stopNow,
    aiReady: service?.hasAI() ?? false,
    regenerateSection,
    restorePrevious,
    addAnalysis,
  }
}
