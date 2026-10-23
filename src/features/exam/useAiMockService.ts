import { useEffect, useState } from 'react'
import { getDb } from '@/infrastructure/db/database'
import { AIService } from '@/services/aiService'
import { SettingsService } from '@/services/settingsService'
import { AiMockPaperService } from '@/services/aiMockPaperService'
import { econMockFigureEngine } from '@/services/econMockFigureEngine'
import { createGenerationRun, type GenerationRun } from '@/shared/lib/generationControl'
import { useGenerationRun, type UseGenerationRunResult } from '@/shared/lib/useGenerationRun'

/** The AI 模拟卷 service; its AI is `null` when no provider is configured. */
export async function buildAiMockPaperService(): Promise<AiMockPaperService> {
  const settings = await new SettingsService().get()
  const ai = settings.apiKey.trim() ? new AIService({ config: settings, usageKind: 'quiz' }) : null
  // Economics papers: figure groups get a shared, locally computed market
  // diagram (the engine returns null for other subjects).
  return new AiMockPaperService({ ai, db: getDb(), figureEngine: econMockFigureEngine })
}

export function useAiMockService(): AiMockPaperService | null {
  const [service, setService] = useState<AiMockPaperService | null>(null)
  useEffect(() => {
    let alive = true
    void buildAiMockPaperService().then((next) => {
      if (alive) setService(next)
    })
    return () => {
      alive = false
    }
  }, [])
  return service
}

/**
 * The pausable run of each AI mock paper, by set id. Module scope: the run
 * outlives the dialog that started it, so the landing page can still pause it.
 */
const runs = new Map<string, GenerationRun>()

function isActive(run: GenerationRun | undefined): run is GenerationRun {
  return run?.state === 'running' || run?.state === 'pausing'
}

export function startAiMockRun(setId: string): GenerationRun {
  const existing = runs.get(setId)
  if (isActive(existing)) return existing
  const run = createGenerationRun()
  runs.set(setId, run)
  return run
}

/** Follow a paper's run (re-rendering on its state), if there is one. */
export function useAiMockRun(setId: string | undefined): UseGenerationRunResult {
  const handle = useGenerationRun()
  const { attach } = handle
  const run = setId ? runs.get(setId) : undefined
  useEffect(() => {
    attach(run ?? null)
  }, [attach, run])
  return handle
}
