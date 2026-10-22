import { useEffect, useState } from 'react'
import { getDb } from '@/infrastructure/db/database'
import { AIService } from '@/services/aiService'
import { SettingsService } from '@/services/settingsService'
import { PracticeSetService } from '@/services/practiceSetService'

/** The practice-set service; its AI is `null` when no provider is configured. */
export async function buildPracticeSetService(): Promise<PracticeSetService> {
  const settings = await new SettingsService().get()
  const ai = settings.apiKey.trim()
    ? new AIService({ config: settings, usageKind: 'walkthrough' })
    : null
  return new PracticeSetService({ ai, db: getDb() })
}

export function usePracticeSetService(): PracticeSetService | null {
  const [service, setService] = useState<PracticeSetService | null>(null)
  useEffect(() => {
    let alive = true
    void buildPracticeSetService().then((next) => {
      if (alive) setService(next)
    })
    return () => {
      alive = false
    }
  }, [])
  return service
}
