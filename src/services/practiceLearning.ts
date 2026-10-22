import type { AppDatabase } from '@/infrastructure/db/database'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { HomeworkAnswerCheck } from '@/entities/homework/answerCheck'
import type { Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import { logger } from '@/infrastructure/logger/logger'
import { MistakeService } from './mistakeService'
import { MasteryService } from './masteryService'

/**
 * A checked answer to a practice-set question counts like other practice: a
 * wrong (or partly right) answer goes to the mistake book and every decided
 * check updates mastery of the question's knowledge point. Undecided checks
 * (`uncertain`) change neither. Ordinary assignments are not recorded.
 */
export async function recordPracticeCheck(
  db: AppDatabase,
  question: HomeworkQuestion,
  setTitle: string,
  draft: string,
  check: HomeworkAnswerCheck,
): Promise<void> {
  const info = question.practice
  if (!info || check.verdict === 'uncertain') return
  const knowledgePoint = info.knowledgePoints[0]?.trim() || setTitle
  const correctAnswer =
    check.expectedAnswer ??
    info.parts
      .map((part) => (part.label ? `(${part.label}) ${part.answer}` : part.answer))
      .join('; ')
  const quizQuestion: Question = {
    id: question.id,
    projectId: question.projectId,
    knowledgePoint,
    type: 'short_answer',
    difficulty: 'basic',
    prompt: question.prompt,
    correctAnswer,
    ...(question.solution ? { solution: question.solution } : {}),
    hints: [],
    sourceRefs: [],
    promptVersion: 'practice-set',
    createdAt: question.createdAt,
  }
  const attempt: QuestionAttempt = {
    id: crypto.randomUUID(),
    projectId: question.projectId,
    questionId: question.id,
    knowledgePoint,
    questionType: 'short_answer',
    difficulty: 'basic',
    userAnswer: draft,
    evaluation: {
      isCorrect: check.verdict === 'correct',
      method: check.method === 'local' ? 'exact' : 'ai',
      confidence: check.method === 'local' ? 1 : 0.8,
      expected: correctAnswer,
      // A partly right answer is partial credit for mastery (the AI's coverage
      // estimate, else half), not a full miss.
      ...(check.verdict === 'partial'
        ? {
            score: {
              earned: Math.min(99, Math.max(1, Math.round(check.similarityPercent ?? 50))),
              total: 100,
            },
          }
        : {}),
    },
    hintsUsed: question.revealedHints,
    createdAt: Date.now(),
  }
  try {
    await new MistakeService(db).recordFromAttempt(attempt, quizQuestion)
    await new MasteryService(db).record(attempt)
  } catch (err) {
    logger.warn('Could not record practice-set progress', {
      questionId: question.id,
      error: (err as Error)?.message,
    })
  }
}
