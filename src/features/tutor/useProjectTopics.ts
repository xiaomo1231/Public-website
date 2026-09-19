import { useEffect, useState } from 'react'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { CourseAnalysis, Topic } from '@/entities/courseAnalysis/types'

export interface ProjectTopicsState {
  loading: boolean
  analysis: CourseAnalysis | null
  topics: Topic[]
}

/**
 * Load a project's course analysis and its topics.
 *
 * Read-only: this never triggers analysis or generation, so opening a topic
 * page costs nothing when the data is already on disk.
 */
export function useProjectTopics(projectId: string | undefined): ProjectTopicsState {
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState<CourseAnalysis | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!projectId) {
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const repo = new CourseAnalysisRepository()
        const nextAnalysis = await repo.getByProject(projectId)
        if (cancelled) return
        setAnalysis(nextAnalysis ?? null)
        const nextTopics = await repo.listTopics(projectId)
        if (cancelled) return
        setTopics(nextTopics)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return { loading, analysis, topics }
}
