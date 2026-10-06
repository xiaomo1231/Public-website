import type { AIService } from './aiService'
import type { Question } from '@/entities/question/types'
import type { QuestionEvaluation } from '@/entities/questionAttempt/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

/**
 * Second look at fill-in-the-blank answers that did not match locally: the
 * AI decides only whether a term is an exact equivalent (synonym, English
 * term, abbreviation). Matching, scoring and the verdict stay local; if the
 * AI is unavailable the local result stands.
 */
export async function checkBlanksWithAi(
  ai: AIService,
  question: Question,
  evaluation: QuestionEvaluation,
): Promise<QuestionEvaluation> {
  const results = evaluation.blanks ?? []
  const asked = results
    .map((blank, i) => ({ ...blank, index: i + 1 }))
    .filter((blank) => !blank.correct && blank.given.trim())
  if (asked.length === 0) return evaluation
  try {
    const { data } = await ai.chatJSON<unknown>(
      [
        { role: 'system', content: prompts.fillBlankCheck.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.fillBlankCheck.buildUserPrompt({
            question: question.prompt,
            blanks: asked.map((blank) => ({ index: blank.index, accepted: blank.accepted, answer: blank.given })),
          }),
        },
      ],
      { maxTokens: 256 },
    )
    const verdicts = prompts.fillBlankCheck.readEquivalence(data, asked.map((blank) => blank.index))
    if (![...verdicts.values()].some(Boolean)) return evaluation
    const blanks = results.map((blank, i) => (verdicts.get(i + 1) ? { ...blank, correct: true, byAi: true } : blank))
    const earned = blanks.filter((blank) => blank.correct).length
    return {
      ...evaluation,
      blanks,
      score: { earned, total: blanks.length },
      isCorrect: earned === blanks.length,
      note: t('fillBlank.aiAccepted'),
    }
  } catch (err) {
    logger.warn('Fill-blank equivalence check failed; keeping the local result', { error: (err as Error)?.message })
    return evaluation
  }
}
