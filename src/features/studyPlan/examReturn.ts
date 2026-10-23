import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { StudyPlanService } from '@/services/studyPlanService'
import { ProjectRepository } from '@/entities/project/repository'
import { logger } from '@/infrastructure/logger/logger'

/**
 * 考试工作台 → focus pages and back. A page opened from an exam workspace
 * carries `?fromExam=<examId>`; its header then returns to the workspace
 * (「← 期中 · ECON 111」) instead of its usual parent. Pages that move on to
 * another page (quiz setup → the quiz) pass the parameter along.
 */
export const EXAM_RETURN_PARAM = 'fromExam'

/** The 考试工作台 of an exam. */
export function examWorkspacePath(examId: string, tab?: string): string {
  const base = `/plan/exams/${encodeURIComponent(examId)}`
  return tab && tab !== 'overview' ? `${base}?tab=${encodeURIComponent(tab)}` : base
}

/** `path` with extra query parameters (keeps an existing query and hash). */
export function withParams(path: string, params: Record<string, string | undefined>): string {
  const hashAt = path.indexOf('#')
  const hash = hashAt >= 0 ? path.slice(hashAt) : ''
  const bare = hashAt >= 0 ? path.slice(0, hashAt) : path
  const queryAt = bare.indexOf('?')
  const pathname = queryAt >= 0 ? bare.slice(0, queryAt) : bare
  const search = new URLSearchParams(queryAt >= 0 ? bare.slice(queryAt + 1) : '')
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, value)
  }
  const query = search.toString()
  return `${pathname}${query ? `?${query}` : ''}${hash}`
}

/** `path` opened from the exam's workspace (its back link returns there). */
export function withExamReturn(path: string, examId: string | null | undefined): string {
  return examId ? withParams(path, { [EXAM_RETURN_PARAM]: examId }) : path
}

/** The exam a page was opened from (`?fromExam=`), if any. */
export function examReturnId(search: string): string | null {
  const id = new URLSearchParams(search).get(EXAM_RETURN_PARAM)
  return id && id.trim() ? id : null
}

/** The current page's `?fromExam=`, to pass along when navigating onward. */
export function useExamReturnId(): string | null {
  const location = useLocation()
  return examReturnId(location.search)
}

export interface ExamReturn {
  examId: string
  to: string
  /** 「期中 · ECON 111」 */
  label: string
}

/**
 * Where the header of a page opened from an exam workspace leads back to.
 * `null` without `?fromExam=` or when the exam no longer exists.
 */
export function useExamReturn(): ExamReturn | null {
  const examId = useExamReturnId()
  const [found, setFound] = useState<ExamReturn | null>(null)
  useEffect(() => {
    if (!examId) {
      setFound(null)
      return
    }
    let alive = true
    void (async () => {
      try {
        const exam = await new StudyPlanService().getExam(examId)
        if (!exam) {
          if (alive) setFound(null)
          return
        }
        const project = await new ProjectRepository().get(exam.projectId).catch(() => undefined)
        if (alive)
          setFound({
            examId,
            to: examWorkspacePath(examId),
            label: project ? `${exam.name} · ${project.name}` : exam.name,
          })
      } catch (err) {
        logger.warn('Exam return link not loaded', { error: String(err) })
        if (alive) setFound(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [examId])
  return found
}
