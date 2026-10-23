import { useEffect, useState } from 'react'
import { buildAIServices } from '@/services/aiServices'
import { aiConcurrency, type AIService } from '@/services/aiService'
import { ExamScheduleImportService } from '@/services/examScheduleImportService'
import { ExamReviewService, type ExamReviewAIPort } from '@/services/examReviewService'

function reviewPort(ai: AIService): ExamReviewAIPort {
  return {
    chatJSON: ai.chatJSON.bind(ai),
    testConnection: () => ai.testConnection(),
    concurrency: aiConcurrency(ai),
  }
}

/**
 * 粘贴识别 and 复习提纲 services. Without an AI provider both still load:
 * the local paste parser works, and a review sheet can be read; anything
 * that needs the AI explains what is missing.
 */
export function useExamTools(): {
  schedule: ExamScheduleImportService
  review: ExamReviewService
  hasAI: boolean
  loaded: boolean
} {
  const [state, setState] = useState(() => ({
    schedule: new ExamScheduleImportService(null),
    review: new ExamReviewService({ ai: null }),
    hasAI: false,
    loaded: false,
  }))
  useEffect(() => {
    let alive = true
    void buildAIServices()
      .catch(() => null)
      .then((bundle) => {
        if (!alive) return
        const ai = bundle ? bundle.ai.withKind('other') : null
        setState({
          schedule: new ExamScheduleImportService(ai),
          review: new ExamReviewService({
            ai: bundle ? reviewPort(bundle.ai.withKind('tutor')) : null,
          }),
          hasAI: !!bundle,
          loaded: true,
        })
      })
    return () => {
      alive = false
    }
  }, [])
  return state
}
