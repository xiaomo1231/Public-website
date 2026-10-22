import { isHeldOut } from '@/entities/evaluation/evalRole'
import type { AppDatabase } from '@/infrastructure/db/database'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { HomeworkAnswerCheck } from '@/entities/homework/answerCheck'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import type { MistakeOrigin } from '@/entities/mistake/followUp'
import { logger } from '@/infrastructure/logger/logger'
import { MistakeService } from './mistakeService'
import { CHECKED_ANSWER_TYPE, MasteryService } from './masteryService'

/**
 * A checked answer outside a quiz — a practice-set question, a mock-exam
 * question or a 错题跟进 re-test / variant — counts like other practice, the
 * same way for all of them: a wrong (or partly right) answer goes to the
 * mistake book (re-tests update their own mistake instead) and every decided
 * check adds one mastery observation. Local checks count fully, AI readings
 * half (`observationFromAttempt`), exactly like quiz short answers. Undecided
 * checks (`uncertain`) change neither. Mastery stays an estimate.
 */
export interface CheckedAnswerInput {
  projectId: string
  /** The question's id (the mistake book merges repeated wrong answers on it). */
  questionId: string
  prompt: string
  solution?: string
  knowledgePoint: string
  topicId?: string
  difficulty?: DifficultyLevel
  /** What the student wrote. */
  answer: string
  /** The reference answer shown in the mistake book. */
  correctAnswer: string
  check: Pick<HomeworkAnswerCheck, 'verdict' | 'method' | 'similarityPercent'>
  hintsUsed?: number
  origin: MistakeOrigin
  homeworkSetId?: string
  /** Lecture citations for the mistake book (e.g. the matched topic's sources). */
  sourceRefs?: SourceReference[]
  /** Record mastery only (re-tests and variants: the mistake already exists). */
  skipMistake?: boolean
  /** Independent evaluation items: no follow-up is scheduled. */
  noFollowUp?: boolean
}

/** The attempt a checked answer stands for (not stored; it feeds mistakes and mastery). */
export function checkedAnswerAttempt(input: CheckedAnswerInput): QuestionAttempt | null {
  const { check } = input
  if (check.verdict === 'uncertain') return null
  return {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    questionId: input.questionId,
    knowledgePoint: input.knowledgePoint,
    ...(input.topicId ? { topicId: input.topicId } : {}),
    questionType: CHECKED_ANSWER_TYPE,
    difficulty: input.difficulty ?? 'basic',
    userAnswer: input.answer,
    evaluation: {
      isCorrect: check.verdict === 'correct',
      method: check.method === 'local' ? 'exact' : 'ai',
      confidence: check.method === 'local' ? 1 : 0.8,
      expected: input.correctAnswer,
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
    hintsUsed: input.hintsUsed ?? 0,
    createdAt: Date.now(),
  }
}

export async function recordCheckedAnswer(
  db: AppDatabase,
  input: CheckedAnswerInput,
): Promise<QuestionAttempt | null> {
  const attempt = checkedAnswerAttempt(input)
  if (!attempt) return null
  const question: Question = {
    id: input.questionId,
    projectId: input.projectId,
    knowledgePoint: input.knowledgePoint,
    ...(input.topicId ? { topicId: input.topicId } : {}),
    type: 'short_answer',
    difficulty: attempt.difficulty as DifficultyLevel,
    prompt: input.prompt,
    correctAnswer: input.correctAnswer,
    ...(input.solution ? { solution: input.solution } : {}),
    hints: [],
    sourceRefs: [],
    promptVersion: 'checked-answer',
    createdAt: attempt.createdAt,
  }
  try {
    if (!input.skipMistake)
      await new MistakeService(db).recordFromAttempt(attempt, question, {
        origin: input.origin,
        ...(input.homeworkSetId ? { homeworkSetId: input.homeworkSetId } : {}),
        ...(input.sourceRefs?.length ? { sourceRefs: input.sourceRefs } : {}),
        ...(input.noFollowUp ? { noFollowUp: true } : {}),
      })
    await new MasteryService(db).record(attempt)
  } catch (err) {
    logger.warn('Could not record a checked answer', {
      questionId: input.questionId,
      origin: input.origin,
      error: (err as Error)?.message,
    })
  }
  return attempt
}

/**
 * A checked answer to a practice-set question. Ordinary assignments are not
 * recorded (they have no verified reference of their own).
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
  await recordCheckedAnswer(db, {
    projectId: question.projectId,
    questionId: question.id,
    prompt: question.prompt,
    ...(question.solution ? { solution: question.solution } : {}),
    knowledgePoint: info.knowledgePoints[0]?.trim() || setTitle,
    answer: draft,
    correctAnswer:
      check.expectedAnswer ??
      info.parts
        .map((part) => (part.label ? `(${part.label}) ${part.answer}` : part.answer))
        .join('; '),
    check,
    hintsUsed: question.revealedHints,
    origin: 'homework_practice',
    homeworkSetId: question.setId,
    ...(isHeldOut(question) ? { noFollowUp: true } : {}),
  })
}
