import { useEffect, useState } from 'react'
import { buildSlideLessonService } from '@/services/aiServices'
import type { SlideDocumentInfo } from '@/services/slideLessonService'

/**
 * Presentations in a project, used to decide whether "learn by slide" is even
 * offered and to list files. Reads local data only; never calls the AI.
 */
export function useSlideDocuments(projectId: string | undefined): {
  loading: boolean
  documents: SlideDocumentInfo[]
} {
  const [documents, setDocuments] = useState<SlideDocumentInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) {
      setDocuments([])
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void buildSlideLessonService()
      .then((service) => service.listSlideDocuments(projectId))
      .then((docs) => {
        if (alive) {
          setDocuments(docs)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
          setDocuments([])
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [projectId])

  return { loading, documents }
}
