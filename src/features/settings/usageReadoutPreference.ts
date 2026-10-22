import { useCallback } from 'react'
import { useAuthStore } from '@/features/auth/authStore'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Whether the AI usage / balance readout is shown in the lab side rail and the
 * lecture account menu. Off unless the student turned it on (设置 → AI 用量与余额).
 * When hidden the readout is not mounted, so no balance is fetched; usage is
 * still recorded and the settings breakdown is always available.
 */
export function useUsageReadoutVisible(): boolean {
  return useAuthStore((s) => s.profile?.showUsageReadout === true)
}

export function useUsageReadoutPreference(): {
  visible: boolean
  setVisible: (visible: boolean) => void
} {
  const visible = useUsageReadoutVisible()
  const persist = useAuthStore((s) => s.setShowUsageReadout)
  const setVisible = useCallback(
    (next: boolean) => {
      void persist(next).catch((err: unknown) => {
        logger.warn('Failed to persist usage readout preference', { visible: next })
        logger.debug('Usage readout preference error', { error: String(err) })
      })
    },
    [persist],
  )
  return { visible, setVisible }
}
