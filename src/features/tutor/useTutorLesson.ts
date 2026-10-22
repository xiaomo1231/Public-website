import { useCallback, useEffect, useRef, useState } from 'react'
import type { TutorLesson } from '@/entities/tutorLesson/types'
import { buildAIServices } from '@/services/aiServices'
import { loadStoredLesson } from '@/services/tutorLessonService'
import { isAbortError, type GenerationRunState } from '@/shared/lib/generationControl'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { noProviderInfo, tutorErrorInfo, type TutorErrorInfo } from './tutorErrors'

export interface UseTutorLessonInput {
  projectId: string
  topicId: string
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
}

export interface UseTutorLessonState {
  /** `loading` covers both "reading the cache" and "generating". */
  status: 'loading' | 'ready' | 'error'
  lesson?: TutorLesson
  /** True once the lesson on screen came from local storage. */
  fromCache: boolean
  /** True while the AI is actively producing the first version. */
  streaming: boolean
  /** Set when generation failed outright (no previous lesson to fall back on). */
  error?: string
  /** The fix for `error` lives in Settings (no provider, bad key, quota…). */
  errorNeedsSettings?: boolean
  /** Set when a refresh failed but a stored lesson is still on screen. */
  refreshError?: string
  /** The fix for `refreshError` lives in Settings. */
  refreshNeedsSettings?: boolean
  /**
   * No AI provider is configured: the stored lesson is shown as-is (it may be
   * out of date) and generating / refreshing needs Settings first.
   */
  noProvider?: boolean
  /** True while an explicit regenerate is running. */
  regenerating: boolean
  regenerate: () => Promise<void>
  /** The AI request's run state (`running` while it can be stopped). */
  generation: GenerationRunState | null
  /** Stop the running request; whatever was stored stays as it was. */
  stop: () => void
  /** True when the student stopped the first generation (nothing to show yet). */
  stopped: boolean
}

/**
 * Loads a topic's lesson, cache-first.
 *
 * The service it delegates to guarantees the important property: a second
 * visit, a remount, a page refresh or a language switch back all resolve from
 * IndexedDB without touching the AI. Only the first visit — or an explicit
 * `regenerate()` — spends tokens.
 */
export function useTutorLesson(input: UseTutorLessonInput): UseTutorLessonState {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [lesson, setLesson] = useState<TutorLesson | undefined>()
  const [fromCache, setFromCache] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [error, setErrorInfo] = useState<TutorErrorInfo | undefined>()
  const [refreshError, setRefreshInfo] = useState<TutorErrorInfo | undefined>()
  const [noProvider, setNoProvider] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [stopped, setStopped] = useState(false)
  // Not aborted on unmount: a lesson the student navigated away from still
  // finishes and is cached. Only the Stop button aborts.
  const generation = useGenerationRun()
  const { start: startRun } = generation

  // Guards against a slow response for topic A landing after the user switched
  // to topic B.
  const requestId = useRef(0)

  const { projectId, topicId, topicName, topicDescription, language } = input

  useEffect(() => {
    // Nothing to load yet (the page is still resolving the project / topic).
    // Bailing out here prevents a spurious request with empty ids.
    if (!projectId || !topicId) return

    const id = ++requestId.current
    let cancelled = false

    setStatus('loading')
    setLesson(undefined)
    setFromCache(false)
    setStreaming(false)
    setErrorInfo(undefined)
    setRefreshInfo(undefined)
    setNoProvider(false)
    setStopped(false)
    // A regenerate for the previous topic may still be running; its result is
    // discarded by the request id, so its spinner must not stick either.
    setRegenerating(false)

    const run = startRun()
    void (async () => {
      try {
        const services = await buildAIServices()
        if (cancelled || id !== requestId.current) return
        if (!services) {
          // Reading a stored lesson needs no AI: show it, and say that only
          // generating or refreshing requires a provider.
          setNoProvider(true)
          const stored = await loadStoredLesson({ projectId, topicId, language })
          if (cancelled || id !== requestId.current) return
          if (stored) {
            setLesson(stored)
            setFromCache(true)
            setStatus('ready')
          } else {
            setErrorInfo(noProviderInfo())
            setStatus('error')
          }
          return
        }

        // Paint the stored lesson immediately so a revisit is instant, then let
        // the service decide whether it is still current.
        const stored = await services.tutorLesson.load({ projectId, topicId, language })
        if (cancelled || id !== requestId.current) return
        if (stored) {
          setLesson(stored)
          setFromCache(true)
        }

        const result = await services.tutorLesson.getOrGenerate(
          { projectId, topicId, topicName, topicDescription, language, signal: run.signal },
          { onDelta: stored ? undefined : () => setStreaming(true) },
        )
        if (cancelled || id !== requestId.current) return

        setLesson(result.lesson)
        setFromCache(result.fromCache)
        if (result.refreshError) setRefreshInfo(tutorErrorInfo(result.refreshError))
        setStatus('ready')
      } catch (err) {
        if (cancelled || id !== requestId.current) return
        if (isAbortError(err, run.signal)) {
          setStopped(true)
        } else {
          setErrorInfo(tutorErrorInfo(err))
        }
        setStatus('error')
      } finally {
        run.finish()
        if (!cancelled && id === requestId.current) setStreaming(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, topicId, language, topicName, topicDescription])

  const regenerate = useCallback(async () => {
    // Same guard as the load effect: a regenerate for topic A must never land
    // on topic B if the student navigated while it was running.
    const id = ++requestId.current
    const isCurrent = () => id === requestId.current
    setRegenerating(true)
    setRefreshInfo(undefined)
    setStopped(false)
    const run = startRun()
    try {
      const services = await buildAIServices()
      if (!isCurrent()) return
      if (!services) {
        setNoProvider(true)
        // A lesson on screen stays readable; only the refresh is reported.
        if (lesson) setRefreshInfo(noProviderInfo())
        else {
          setErrorInfo(noProviderInfo())
          setStatus('error')
        }
        return
      }
      setNoProvider(false)
      const result = await services.tutorLesson.regenerate({
        projectId,
        topicId,
        topicName,
        topicDescription,
        language,
        signal: run.signal,
      })
      if (!isCurrent()) return
      setLesson(result.lesson)
      setFromCache(false)
      setStreaming(false)
      setErrorInfo(undefined)
      setStatus('ready')
    } catch (err) {
      if (!isCurrent()) return
      if (isAbortError(err, run.signal)) {
        // Stopped: the stored lesson (if any) stays on screen untouched.
        if (!lesson) {
          setStopped(true)
          setStatus('error')
        }
        return
      }
      // Keep whatever is on screen; only report that the refresh failed.
      if (lesson) setRefreshInfo(tutorErrorInfo(err))
      else {
        setErrorInfo(tutorErrorInfo(err))
        setStatus('error')
      }
    } finally {
      run.finish()
      if (isCurrent()) setRegenerating(false)
    }
  }, [projectId, topicId, topicName, topicDescription, language, startRun, lesson])

  return {
    status,
    ...(lesson ? { lesson } : {}),
    fromCache,
    streaming,
    ...(error ? { error: error.message } : {}),
    errorNeedsSettings: error?.needsSettings ?? false,
    ...(refreshError ? { refreshError: refreshError.message } : {}),
    refreshNeedsSettings: refreshError?.needsSettings ?? false,
    noProvider,
    regenerating,
    regenerate,
    generation: generation.state,
    stop: generation.stopNow,
    stopped,
  }
}
