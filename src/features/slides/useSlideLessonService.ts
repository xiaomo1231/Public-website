import { useEffect, useState } from 'react'
import { buildSlideLessonService } from '@/services/aiServices'
import type { SlideLessonService } from '@/services/slideLessonService'

/**
 * Build the slide-lesson service once per mount. The service always exists —
 * the AI inside it is `null` when no provider is configured — so reading slide
 * material, cached explanations and Q&A keeps working offline.
 */
export function useSlideLessonService(): SlideLessonService | null {
  const [service, setService] = useState<SlideLessonService | null>(null)

  useEffect(() => {
    let alive = true
    void buildSlideLessonService().then((next) => {
      if (alive) setService(next)
    })
    return () => {
      alive = false
    }
  }, [])

  return service
}
