import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  currentTranslation,
  translationSourceHash,
  type QuestionTranslation,
} from '@/entities/homework/questionTranslation'
import {
  buildQuestionTranslationService,
  type QuestionTranslationService,
} from '@/services/questionTranslationService'

/**
 * 原文 / 中文翻译 state shared by every view of a question during the visit
 * (the inline text and its floating 原题 window): the tab chosen, the
 * translations received, and the request in flight.
 */

export type QuestionTab = 'original' | 'zh'

/** The tab each question showed during this visit (not stored). */
export const chosenTabs = new Map<string, QuestionTab>()

/**
 * Translations received during this visit, so a second view of the same
 * question shows it without asking again even when its own copy of the
 * question row predates the translation.
 */
const visitTranslations = new Map<string, QuestionTranslation>()

/**
 * One request per question at a time, shared by every view of it: opening the
 * floating window while the inline view is translating waits for the same
 * reply. Stopping it stops it for all of them.
 */
export interface TranslationRun {
  controller: AbortController
  promise: Promise<QuestionTranslation>
  waiters: number
}
const runs = new Map<string, TranslationRun>()

/** Built per request, so a changed AI setting applies to the next one. */
function translationService(): Promise<QuestionTranslationService> {
  return buildQuestionTranslationService()
}

/** The request for this question in flight, or a new one. */
export function startRun(questionId: string): TranslationRun {
  const existing = runs.get(questionId)
  if (existing) return existing
  const controller = new AbortController()
  const promise = translationService().then((service) =>
    service.translate(questionId, { signal: controller.signal }),
  )
  const run: TranslationRun = { controller, promise, waiters: 0 }
  runs.set(questionId, run)
  promise.then(
    (translation) => {
      visitTranslations.set(questionId, translation)
      if (runs.get(questionId) === run) runs.delete(questionId)
    },
    () => {
      if (runs.get(questionId) === run) runs.delete(questionId)
    },
  )
  return run
}

/** Stop a request (for every view waiting for it). */
export function abortRun(questionId: string, run: TranslationRun): void {
  run.controller.abort()
  if (runs.get(questionId) === run) runs.delete(questionId)
}

/** The translation known for this text: on the row, or received this visit. */
export function knownTranslation(
  question: Pick<HomeworkQuestion, 'id' | 'prompt' | 'translation'>,
): QuestionTranslation | undefined {
  const cached = currentTranslation(question)
  if (cached) return cached
  const seen = visitTranslations.get(question.id)
  return seen && seen.sourceHash === translationSourceHash(question.prompt) ? seen : undefined
}

/** Test hook: forget what this visit translated and any request in flight. */
export function resetQuestionTranslationsForTests(): void {
  for (const run of runs.values()) run.controller.abort()
  runs.clear()
  visitTranslations.clear()
  chosenTabs.clear()
}
