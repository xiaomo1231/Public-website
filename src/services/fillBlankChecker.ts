import { withLightModel, type AIService } from './aiService'
import type { Question } from '@/entities/question/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import { isAbortError } from '@/shared/lib/generationControl'
import { blankCredit } from './answerEvaluationService'

/**
 * Second look at fill-in-the-blank answers that did not match locally: the
 * AI decides only whether a term is an exact equivalent (synonym, English
 * term, abbreviation). Matching, scoring and the verdict stay local; if the
 * AI is unavailable the local result stands. Blanks that are only misspelt
 * in the course language (accents, capitals, ß → ss) are never asked: the
 * spelling is the point, and the AI must not excuse it.
 */
export async function checkBlanksWithAi(
  ai: AIService,
  question: Question,
  evaluation: QuestionEvaluation,
  options: { signal?: AbortSignal } = {},
): Promise<QuestionEvaluation> {
  const results = evaluation.blanks ?? []
  const asked = results
    .map((blank, i) => ({ ...blank, index: i + 1 }))
    .filter((blank) => !blank.correct && !blank.spelling && blank.given.trim())
  if (asked.length === 0) return evaluation
  try {
    // A simple equivalence check: the 轻量模型 when one is set.
    const { data } = await withLightModel(ai).chatJSON<unknown>(
      [
        { role: 'system', content: prompts.fillBlankCheck.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.fillBlankCheck.buildUserPrompt({
            question: question.prompt,
            blanks: asked.map((blank) => ({
              index: blank.index,
              accepted: blank.accepted,
              answer: blank.given,
            })),
          }),
        },
      ],
      { maxTokens: 256, ...(options.signal ? { signal: options.signal } : {}) },
    )
    const verdicts = prompts.fillBlankCheck.readEquivalence(
      data,
      asked.map((blank) => blank.index),
    )
    if (![...verdicts.values()].some(Boolean)) return evaluation
    const blanks = results.map((blank, i) =>
      verdicts.get(i + 1) ? { ...blank, correct: true, byAi: true } : blank,
    )
    const earned = blanks.reduce((sum, blank) => sum + blankCredit(blank), 0)
    return {
      ...evaluation,
      blanks,
      score: { earned, total: blanks.length },
      isCorrect: blanks.every((blank) => blank.correct),
      note: t('fillBlank.aiAccepted'),
    }
  } catch (err) {
    // Stopped by the student: the caller cancels the submission.
    if (isAbortError(err, options.signal)) throw err
    logger.warn('Fill-blank equivalence check failed; keeping the local result', {
      error: (err as Error)?.message,
    })
    return evaluation
  }
}
