import { useCallback, useEffect, useState } from 'react'
import { buildHomeworkWalkthroughService } from '@/services/aiServices'
import {
  subscribeWalkthroughRuns,
  walkthroughRunProgress,
  type HomeworkWalkthroughService,
  type WalkthroughProgress,
  type WalkthroughRunResult,
  type WalkthroughState,
} from '@/services/homeworkWalkthroughService'
import { WalkthroughNoteService } from '@/services/walkthroughNoteService'
import type { WalkthroughNote } from '@/entities/homework/walkthrough'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { subscribeNoteChanges } from './floatingQA'

export interface UseWalkthrough {
  state: WalkthroughState | null
  notes: WalkthroughNote[]
  progress: WalkthroughProgress | undefined
  loading: boolean
  error: string | null
  generate: (force?: boolean) => Promise<WalkthroughRunResult | null>
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
        void reload()
      }),
    [reload, setId],
  )

  useEffect(() => subscribeNoteChanges(() => void reloadNotes()), [reloadNotes])

  const generate = useCallback(
    async (force = false) => {
      if (!service) return null
      setError(null)
      try {
        return await service.generate(setId, { force })
      } catch (err) {
        setError(friendlyAIError(err))
        return null
      } finally {
        await reload()
      }
    },
    [service, setId, reload],
  )

  return { state, notes, progress, loading: loading || !service, error, generate }
}
