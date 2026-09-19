import { useCallback, useEffect, useRef, useState } from 'react'
import type { TutorLesson } from '@/entities/tutorLesson/types'
import { buildAIServices } from '@/services/aiServices'
import { friendlyTutorError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'

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
  /** Set when a refresh failed but a stored lesson is still on screen. */
  refreshError?: string
  /** True while an explicit regenerate is running. */
  regenerating: boolean
  regenerate: () => Promise<void>
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
  const { t } = useTranslation()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [lesson, setLesson] = useState<TutorLesson | undefined>()
  const [fromCache, setFromCache] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [refreshError, setRefreshError] = useState<string | undefined>()
  const [regenerating, setRegenerating] = useState(false)

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
    setError(undefined)
    setRefreshError(undefined)

    void (async () => {
      try {
        const services = await buildAIServices()
        if (cancelled || id !== requestId.current) return
        if (!services) {
          setError(t('tutor.noProvider'))
          setStatus('error')
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
          { projectId, topicId, topicName, topicDescription, language },
          { onDelta: stored ? undefined : () => setStreaming(true) },
        )
        if (cancelled || id !== requestId.current) return

        setLesson(result.lesson)
        setFromCache(result.fromCache)
        if (result.refreshError) setRefreshError(friendlyTutorError(result.refreshError))
        setStatus('ready')
      } catch (err) {
        if (cancelled || id !== requestId.current) return
        setError(friendlyTutorError(err))
        setStatus('error')
      } finally {
        if (!cancelled && id === requestId.current) setStreaming(false)
      }
    })()

    return () => {
      cancelled = true
    }
    // `t` is intentionally excluded: it is stable per language and including it
    // would re-run the effect on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, topicId, language, topicName, topicDescription])

  const regenerate = useCallback(async () => {
    setRegenerating(true)
    setRefreshError(undefined)
    try {
      const services = await buildAIServices()
      if (!services) {
        setError(t('tutor.noProvider'))
        setStatus('error')
        return
      }
      const result = await services.tutorLesson.regenerate({
        projectId,
        topicId,
        topicName,
        topicDescription,
        language,
      })
      setLesson(result.lesson)
      setFromCache(false)
      setError(undefined)
      setStatus('ready')
    } catch (err) {
      // Keep whatever is on screen; only report that the refresh failed.
      setRefreshError(friendlyTutorError(err))
    } finally {
      setRegenerating(false)
    }
  }, [projectId, topicId, topicName, topicDescription, language, t])

  return {
    status,
    ...(lesson ? { lesson } : {}),
    fromCache,
    streaming,
    ...(error ? { error } : {}),
    ...(refreshError ? { refreshError } : {}),
    regenerating,
    regenerate,
  }
}
