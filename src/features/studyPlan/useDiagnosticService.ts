import { useEffect, useState } from 'react'
import { buildAIServices } from '@/services/aiServices'
import { aiConcurrency } from '@/services/aiService'
import { DiagnosticService } from '@/services/diagnosticService'
import { PlanSummaryService } from '@/services/planSummaryService'

/**
 * The diagnostic and summary services. Without an AI provider they still
 * load (papers can be listed and taken); generating explains what is missing.
 */
export function useDiagnosticServices(): {
  diagnostic: DiagnosticService | null
  summary: PlanSummaryService | null
  hasAI: boolean
} {
  const [state, setState] = useState<{
    diagnostic: DiagnosticService | null
    summary: PlanSummaryService | null
    hasAI: boolean
  }>({ diagnostic: null, summary: null, hasAI: false })
  useEffect(() => {
    let alive = true
    void buildAIServices()
      .catch(() => null)
      .then((bundle) => {
        if (!alive) return
        setState({
          diagnostic: new DiagnosticService({
            quiz: bundle?.quiz ?? null,
            ai: bundle
              ? {
                  testConnection: () => bundle.ai.testConnection(),
                  concurrency: aiConcurrency(bundle.ai),
                }
              : null,
          }),
          summary: new PlanSummaryService(bundle ? bundle.ai.withKind('other') : null),
          hasAI: !!bundle,
        })
      })
    return () => {
      alive = false
    }
  }, [])
  return state
}
