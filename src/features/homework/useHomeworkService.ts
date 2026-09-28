import { useEffect, useState } from 'react'
import { buildHomeworkService } from '@/services/aiServices'
import type { HomeworkService } from '@/services/homeworkService'

/**
 * Build the homework service once per mount. The service always exists — the
 * AI inside it is `null` when no provider is configured — so reading the
 * assignment, drafts, hints and the revealed solution keeps working offline.
 */
export function useHomeworkService(): HomeworkService | null {
  const [service, setService] = useState<HomeworkService | null>(null)

  useEffect(() => {
    let alive = true
    void buildHomeworkService().then((next) => {
      if (alive) setService(next)
    })
    return () => {
      alive = false
    }
  }, [])

  return service
}
