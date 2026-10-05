import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReferenceImage } from '@/entities/referenceImage/types'
import type { TutorLesson } from '@/entities/tutorLesson/types'
import { buildReferenceImageService } from '@/services/aiServices'
import type { ReferenceImageService } from '@/services/referenceImageService'
import { friendlyTutorError } from '@/shared/lib/aiErrors'

export interface UseReferenceImagesState {
  /** The setting is on and the course subject gets web images. */
  available: boolean
  images: ReferenceImage[]
  searching: boolean
  /** True after a search that found nothing new. */
  searchedEmpty: boolean
  error?: string
  search: () => Promise<void>
  remove: (id: string) => Promise<void>
  loadImage: (id: string) => Promise<Blob | null>
}

/**
 * Cached web reference images for a lesson's topic, plus an explicit search.
 * Nothing is fetched from the web until the student asks.
 */
export function useReferenceImages(
  lesson: TutorLesson | undefined,
  topic: { name: string; description?: string },
): UseReferenceImagesState {
  const [service, setService] = useState<ReferenceImageService | null>(null)
  const [available, setAvailable] = useState(false)
  const [images, setImages] = useState<ReferenceImage[]>([])
  const [searching, setSearching] = useState(false)
  const [searchedEmpty, setSearchedEmpty] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const abort = useRef<AbortController | null>(null)

  const projectId = lesson?.projectId
  const topicId = lesson?.topicId

  useEffect(() => {
    if (!projectId || !topicId) return
    let cancelled = false
    setImages([])
    setSearchedEmpty(false)
    setError(undefined)
    void (async () => {
      try {
        const svc = await buildReferenceImageService()
        const [cached, subjectOk] = await Promise.all([svc.list(projectId, topicId), svc.availableFor(projectId)])
        if (cancelled) return
        setService(svc)
        setImages(cached)
        setAvailable(svc.enabled && subjectOk)
      } catch {
        if (!cancelled) setAvailable(false)
      }
    })()
    return () => {
      cancelled = true
      abort.current?.abort()
    }
  }, [projectId, topicId])

  const search = useCallback(async () => {
    if (!service || !lesson) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setSearching(true)
    setError(undefined)
    setSearchedEmpty(false)
    try {
      const before = images.length
      const next = await service.search({
        projectId: lesson.projectId,
        topicId: lesson.topicId,
        topicName: topic.name,
        topicDescription: topic.description ?? '',
        language: lesson.language,
        lessonContent: lesson.content,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setImages(next)
      setSearchedEmpty(next.length <= before)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(friendlyTutorError(err))
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }, [service, lesson, topic.name, topic.description, images.length])

  const remove = useCallback(
    async (id: string) => {
      if (!service) return
      await service.remove(id)
      setImages((list) => list.filter((image) => image.id !== id))
    },
    [service],
  )

  const loadImage = useCallback(
    async (id: string) => (service ? service.getImage(id) : null),
    [service],
  )

  return { available, images, searching, searchedEmpty, error, search, remove, loadImage }
}
