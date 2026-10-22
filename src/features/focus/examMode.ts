import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { create } from 'zustand'
import { isExamPath } from './focusRoutes'

interface ExamModeState {
  /** How many mounted pages / views currently declare an exam in progress. */
  count: number
}

const useExamModeStore = create<ExamModeState>(() => ({ count: 0 }))

/**
 * Declare that an exam is on screen while `active` (mock exam, 自测, oral exam,
 * an interview in exam mode). While any exam is active the pomodoro timer is
 * not rendered, pauses itself and raises no alert.
 */
export function useExamMode(active: boolean): void {
  useEffect(() => {
    if (!active) return
    useExamModeStore.setState((s) => ({ count: s.count + 1 }))
    return () => useExamModeStore.setState((s) => ({ count: Math.max(0, s.count - 1) }))
  }, [active])
}

/** True while an exam is on screen (declared by a page, or an exam address). */
export function useExamActive(): boolean {
  const declared = useExamModeStore((s) => s.count > 0)
  const { pathname } = useLocation()
  return declared || isExamPath(pathname)
}

/** Non-React read, for alerts fired from timers. */
export function isExamDeclared(): boolean {
  return useExamModeStore.getState().count > 0
}

export function resetExamModeForTesting(): void {
  useExamModeStore.setState({ count: 0 })
}
