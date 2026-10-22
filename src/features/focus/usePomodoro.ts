import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { normalizePomodoroSettings, type PomodoroSettings } from '@/entities/focus/pomodoro'
import { useAuthStore } from '@/features/auth/authStore'
import { toast } from '@/features/toast/toastStore'
import { UserService } from '@/services/userService'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import { useExamActive } from './examMode'
import { focusContextOf } from './focusRoutes'
import { onPomodoroAlert, usePomodoroStore } from './pomodoroStore'
import { playChime } from './beep'

/** The student's pomodoro settings (defaults filled in). */
export function usePomodoroSettings(): PomodoroSettings {
  const stored = useAuthStore((s) => s.profile?.pomodoro)
  return useMemo(() => normalizePomodoroSettings(stored), [stored])
}

/** Save some pomodoro settings on the profile (merged with the others). */
export function useSavePomodoroSettings(): (patch: Partial<PomodoroSettings>) => Promise<void> {
  return useCallback(async (patch) => {
    const current = useAuthStore.getState().profile?.pomodoro
    const merged = normalizePomodoroSettings({ ...current, ...patch })
    const next = await new UserService().update({ pomodoro: merged })
    useAuthStore.setState({ profile: next })
  }, [])
}

/**
 * Mounted once in the app shell: keeps the timer's settings, page context and
 * exam state in sync, ticks it from the wall clock, and turns phase ends into
 * a toast (plus the optional chime). No alert while an exam is on screen.
 */
export function usePomodoroRuntime(): { examActive: boolean } {
  const settings = usePomodoroSettings()
  const examActive = useExamActive()
  const { pathname } = useLocation()
  const setSettings = usePomodoroStore((s) => s.setSettings)
  const setContext = usePomodoroStore((s) => s.setContext)
  const setExamActive = usePomodoroStore((s) => s.setExamActive)
  const running = usePomodoroStore((s) => s.timer.status === 'running')
  const tick = usePomodoroStore((s) => s.tick)

  useEffect(() => setSettings(settings), [settings, setSettings])
  useEffect(() => setContext(focusContextOf(pathname)), [pathname, setContext])

  const wasExam = useRef(false)
  useEffect(() => {
    setExamActive(examActive)
    if (wasExam.current && !examActive && usePomodoroStore.getState().timer.autoPaused) {
      toast({
        variant: 'info',
        title: t('pomodoro.examPaused.title'),
        description: t('pomodoro.examPaused.body'),
      })
    }
    wasExam.current = examActive
  }, [examActive, setExamActive])

  // Tick once at mount (a reload may find the phase already over), then each second while running.
  useEffect(() => {
    tick()
    if (!running) return
    const id = window.setInterval(() => tick(), 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running, tick])

  const soundRef = useRef(settings.sound)
  soundRef.current = settings.sound
  useEffect(
    () =>
      onPomodoroAlert(({ ended, next }) => {
        try {
          const minutes = Math.round(next.durationMs / 60_000)
          if (ended.phase === 'focus') {
            toast({
              variant: 'success',
              title: t('pomodoro.ended.focus.title'),
              description: t(
                next.phase === 'longBreak'
                  ? 'pomodoro.ended.focus.longBody'
                  : 'pomodoro.ended.focus.body',
                { minutes },
              ),
            })
          } else {
            toast({
              variant: 'info',
              title: t('pomodoro.ended.break.title'),
              description: t('pomodoro.ended.break.body', { minutes }),
            })
          }
          if (soundRef.current) playChime()
        } catch (err) {
          logger.warn('Pomodoro alert failed', { error: String(err) })
        }
      }),
    [],
  )

  return { examActive }
}
