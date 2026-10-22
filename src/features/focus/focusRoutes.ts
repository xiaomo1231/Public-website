import { matchPath } from 'react-router-dom'
import type { FocusKind } from '@/entities/focus/types'

/**
 * 专注子页面: deep "doing" pages where the course navigation steps aside (the
 * lecture course bar is replaced by a back header, the lab side rail shrinks
 * to icons) so the learning area gets the room. Order matters: the more
 * specific pattern comes first.
 */
const FOCUS_ROUTES: ReadonlyArray<{ pattern: string; kind: FocusKind }> = [
  { pattern: '/projects/:id/homework/:assignmentId/exam', kind: 'mock_exam' },
  { pattern: '/projects/:id/homework/:assignmentId', kind: 'homework' },
  { pattern: '/projects/:id/quiz/:quizId', kind: 'quiz' },
  { pattern: '/projects/:id/tutor/:topicId/interactive', kind: 'interactive_tutor' },
  { pattern: '/projects/:id/tutor/:topicId', kind: 'tutor' },
  { pattern: '/projects/:id/interview/:sessionId', kind: 'interview' },
]

/** Literal segments that sit where a focus route has an id. */
const NOT_AN_ID = new Set(['exam-analysis', 'result'])

export interface FocusRoute {
  kind: FocusKind
  projectId: string
}

/** The focus page at `pathname`, or null for an ordinary page. */
export function focusRouteOf(pathname: string): FocusRoute | null {
  for (const { pattern, kind } of FOCUS_ROUTES) {
    const match = matchPath({ path: pattern, end: true }, pathname)
    if (!match) continue
    const ids = Object.entries(match.params).filter(([key]) => key !== 'id')
    if (ids.some(([, value]) => !value || NOT_AN_ID.has(value))) continue
    return { kind, projectId: match.params.id ?? '' }
  }
  return null
}

export function isFocusPath(pathname: string): boolean {
  return focusRouteOf(pathname) !== null
}

/** Exam pages known from the address alone (others announce themselves with `useExamMode`). */
export function isExamPath(pathname: string): boolean {
  return focusRouteOf(pathname)?.kind === 'mock_exam'
}

/** Where a focus phase that starts now is being spent. */
export function focusContextOf(pathname: string): {
  projectId?: string
  kind: FocusKind
  route: string
} {
  const focus = focusRouteOf(pathname)
  if (focus) return { projectId: focus.projectId, kind: focus.kind, route: pathname }
  const course = matchPath({ path: '/projects/:id/*', end: false }, pathname)
  const projectId = course?.params.id
  if (projectId) return { projectId, kind: 'course', route: pathname }
  return { kind: 'other', route: pathname }
}
