import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { Quiz, QuizConfig, QuizDifficulty } from '@/entities/quiz/types'
import type { QuestionType } from '@/entities/question/types'
import type { Mistake } from '@/entities/mistake/types'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { QuizService } from './quizService'
import type { MistakeService } from './mistakeService'
import { WeaknessService } from './weaknessService'
import { stepDifficulty } from './adaptiveDifficulty'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'

export type PracticeMistakeMode = 'same_concept' | 'similar' | 'easier' | 'harder' | 'weakness'

const DEFAULT_REVIEW_TYPES: QuestionType[] = ['multiple_choice', 'short_answer', 'numeric']

export interface ReviewSessionOptions {
  count?: number
  difficulty?: QuizDifficulty
  types?: QuestionType[]
  /** Restrict to mistakes created within this many days (default: all). */
  withinDays?: number
  onProgress?: (stage: string, progress: number) => void
  signal?: AbortSignal
}

/**
 * Builds review quizzes from the mistake book.
 *
 * Two entry points:
 *   - `createReviewSession` — "Review my recent mistakes", weighted toward
 *     the project's weakest knowledge points.
 *   - `practiceMistake` — a focused set from a single mistake.
 *
 * Both delegate generation and grading to `QuizService`, so adaptive
 * difficulty and mastery tracking work exactly as in a normal quiz.
 */
export class ReviewSessionService {
  private db: AppDatabase
  private quiz: QuizService
  private mistakes: MistakeService
  private weakness: WeaknessService

  constructor(deps: {
    quiz: QuizService
    mistakes: MistakeService
    weakness?: WeaknessService
    db?: AppDatabase
  }) {
    this.db = deps.db ?? getDb()
    this.quiz = deps.quiz
    this.mistakes = deps.mistakes
    this.weakness = deps.weakness ?? new WeaknessService(this.db)
  }

  /** "Review my recent mistakes" — 10 questions, adaptive, weak points first. */
  async createReviewSession(projectId: string, options: ReviewSessionOptions = {}): Promise<Quiz> {
    const all = await this.mistakes.list(projectId, { status: 'all' })
    const cutoff = options.withinDays ? Date.now() - options.withinDays * 86_400_000 : 0
    const candidates = all.filter((m) => m.status !== 'archived' && m.createdAt >= cutoff)
    if (candidates.length === 0) {
      throw new AppError('No mistakes to review yet. Take a quiz first.', 'NO_MISTAKES')
    }

    const report = await this.weakness.analyze(projectId, { limit: 5 })
    const weakPoints = report.areas.map((a) => a.knowledgePoint)
    const fromMistakes = rankKnowledgePointsByMistake(candidates)
    // Weakness report first, then any remaining mistake-derived points.
    const focus = dedupe([...weakPoints, ...fromMistakes]).slice(0, 6)

    const config: QuizConfig = {
      mode: 'review',
      count: options.count ?? 10,
      difficulty: options.difficulty ?? 'adaptive',
      types: options.types ?? DEFAULT_REVIEW_TYPES,
      topicName: `Review: ${focus.slice(0, 3).join(', ')}${focus.length > 3 ? '…' : ''}`,
      focusKnowledgePoints: focus,
    }
    logger.info('Creating review session', { projectId, focus, count: config.count })
    return this.quiz.generateQuiz(projectId, config, {
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }

  /** Generate practice focused on a single mistake. */
  async practiceMistake(mistakeId: string, mode: PracticeMistakeMode, options: ReviewSessionOptions = {}): Promise<Quiz> {
    const mistake = await this.mistakes.get(mistakeId)
    if (!mistake) throw new AppError('Mistake not found', 'NOT_FOUND')

    const baseDifficulty: DifficultyLevel =
      options.difficulty === 'adaptive' || options.difficulty === undefined
        ? mistake.difficulty
        : options.difficulty

    const focus =
      mode === 'weakness'
        ? (await this.weakness.weakKnowledgePoints(mistake.projectId, 4))
        : [mistake.knowledgePoint]

    const difficulty: QuizDifficulty =
      mode === 'harder'
        ? stepDifficulty(baseDifficulty, +1)
        : mode === 'easier'
          ? stepDifficulty(baseDifficulty, -1)
          : options.difficulty ?? 'adaptive'

    const config: QuizConfig = {
      mode: mode === 'weakness' ? 'weakness' : 'review',
      count: options.count ?? (mode === 'weakness' ? 8 : 3),
      difficulty,
      types: options.types ?? DEFAULT_REVIEW_TYPES,
      topicName:
        mode === 'weakness'
          ? 'Weakness training'
          : mode === 'similar'
            ? `Similar to: ${mistake.knowledgePoint}`
            : mode === 'same_concept'
              ? `Practice: ${mistake.knowledgePoint}`
              : mode === 'harder'
                ? `Harder: ${mistake.knowledgePoint}`
                : `Easier: ${mistake.knowledgePoint}`,
      focusKnowledgePoints: focus,
      sourceMistakeId: mistake.id,
    }
    return this.quiz.generateQuiz(mistake.projectId, config, {
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }
}

export function rankKnowledgePointsByMistake(mistakes: Mistake[]): string[] {
  const counts = new Map<string, number>()
  for (const m of mistakes) {
    counts.set(m.knowledgePoint, (counts.get(m.knowledgePoint) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([kp]) => kp)
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}