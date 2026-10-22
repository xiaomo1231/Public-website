import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/useAuth'
import { DEFAULT_QUESTION_LANGUAGE, type QuestionLanguage } from '@/entities/user/types'
import {
  detectCourseExamLanguage,
  getCourseLanguageMode,
  setCourseLanguageMode,
} from '@/services/courseLanguage'

const CHANGED = 'course-language-changed'

/**
 * 讲解与题目语言 of one course: its own mode (`Project.questionLanguage`) or
 * the global preference, plus the detected exam language for the
 * 「跟随考试语言」 hint. Components showing the same course stay in step.
 */
export function useCourseLanguage(projectId: string | undefined) {
  const { profile, setQuestionLanguage } = useAuth()
  const [courseMode, setCourseMode] = useState<QuestionLanguage | undefined>(undefined)
  const [examLanguage, setExamLanguage] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const load = () => {
      void Promise.all([getCourseLanguageMode(projectId), detectCourseExamLanguage(projectId)])
        .then(([mode, exam]) => {
          if (cancelled) return
          setCourseMode(mode)
          setExamLanguage(exam)
          setLoaded(true)
        })
        .catch(() => {
          if (!cancelled) setLoaded(true)
        })
    }
    load()
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === projectId) load()
    }
    window.addEventListener(CHANGED, onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(CHANGED, onChanged)
    }
  }, [projectId])

  const globalMode = profile?.questionLanguage ?? DEFAULT_QUESTION_LANGUAGE

  /** Set (or with `null` clear) this course's own mode. */
  const saveCourseMode = useCallback(
    async (mode: QuestionLanguage | null) => {
      if (!projectId) return
      await setCourseLanguageMode(projectId, mode)
      setCourseMode(mode ?? undefined)
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: projectId }))
    },
    [projectId],
  )

  return {
    /** The mode in effect for this course. */
    mode: courseMode ?? globalMode,
    courseMode,
    globalMode,
    examLanguage,
    loaded,
    saveCourseMode,
    saveGlobalMode: setQuestionLanguage,
  }
}
