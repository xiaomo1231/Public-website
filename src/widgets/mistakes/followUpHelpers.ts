import { useEffect, useState } from 'react'
import type { Mistake } from '@/entities/mistake/types'
import { ERROR_DIMENSION_REASON_KEYS } from '@/entities/mistake/followUp'
import type { MistakeFollowUpService } from '@/services/mistakeFollowUpService'
import { buildMistakeFollowUpService } from '@/services/aiServices'
import type { TranslationKey } from '@/i18n/types'

/** The 错题跟进 service (the AI part is null without a configured provider). */
export function useFollowUpService(): MistakeFollowUpService | null {
  const [service, setService] = useState<MistakeFollowUpService | null>(null)
  useEffect(() => {
    let alive = true
    void buildMistakeFollowUpService().then((next) => {
      if (alive) setService(next)
    })
    return () => {
      alive = false
    }
  }, [])
  return service
}

/** Why this re-test was scheduled (「上次单位写错」), or a plain reason. */
export function followUpReasonKey(mistake: Mistake): TranslationKey {
  const reason = mistake.followUp?.reason ?? mistake.errorDimension
  return reason ? ERROR_DIMENSION_REASON_KEYS[reason] : 'followUp.reason.generic'
}
