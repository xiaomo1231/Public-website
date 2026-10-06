import { createContext, useContext } from 'react'

/**
 * The lesson a figure is shown in. Figures that act on the course (e.g. an
 * anatomy table that adds flashcards) read it; outside a lesson it is null
 * and those actions are hidden.
 */
export interface LessonFigureContextValue {
  projectId: string
  topicId: string
}

export const LessonFigureContext = createContext<LessonFigureContextValue | null>(null)

export function useLessonFigureContext(): LessonFigureContextValue | null {
  return useContext(LessonFigureContext)
}
