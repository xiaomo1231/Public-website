import type { LookupInput } from '@/services/courseVocabService'
import { logger } from '@/infrastructure/logger/logger'

/**
 * A word looked up in a course (划词翻译, or 解释 on a single term) goes into
 * that course's word book. Fire and forget: a failure never disturbs the
 * lookup itself, and nothing is sent to the AI. The vocabulary code loads on
 * first use, so the selection popup (on every page) stays light.
 */
export function recordVocabLookup(input: LookupInput): void {
  void Promise.all([import('@/services/courseVocabService'), import('@/services/projectService')])
    .then(([{ CourseVocabService }, { ProjectService }]) =>
      new CourseVocabService({ projects: new ProjectService() }).recordLookup(input),
    )
    .catch((err: unknown) =>
      logger.warn('Saving a looked-up word failed', { error: (err as Error)?.message }),
    )
}
