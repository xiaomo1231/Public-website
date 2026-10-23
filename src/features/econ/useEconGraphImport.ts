import { useEffect, useState } from 'react'
import { getDb } from '@/infrastructure/db/database'
import { AIService } from '@/services/aiService'
import { SettingsService } from '@/services/settingsService'
import { EconGraphImportService } from '@/services/econGraphImportService'

/**
 * The graph-rebuild service of an economics course, or null in any other
 * course (the action is not offered there). Its AI is null when no provider is
 * configured; the dialog then says so.
 */
export function useEconGraphImport(projectId: string): EconGraphImportService | null {
  const [service, setService] = useState<EconGraphImportService | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      const settings = await new SettingsService().get()
      const ai = settings.apiKey.trim()
        ? new AIService({ config: settings, usageKind: 'quiz' })
        : null
      const next = new EconGraphImportService({ ai, db: getDb() })
      if (alive && (await next.available(projectId))) setService(next)
    })().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [projectId])
  return service
}
