import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { MistakeRepository } from '@/entities/mistake/repository'
import type {
  AddMistakeInput,
  Mistake,
  MistakeFilter,
  MistakeStats,
  MistakeType,
} from '@/entities/mistake/types'
import type { Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import { ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

export class MistakeService {
  private repo: MistakeRepository

  constructor(db?: AppDatabase) {
    this.repo = new MistakeRepository(db ?? getDb())
  }

  list(projectId: string, filter?: MistakeFilter): Promise<Mistake[]> {
    return this.repo.listByProject(projectId, filter)
  }

  get(id: string): Promise<Mistake | undefined> {
    return this.repo.get(id)
  }

  stats(projectId: string): Promise<MistakeStats> {
    return this.repo.stats(projectId)
  }

  /**
   * Record a wrong answer. If the same question already has an active
   * mistake, merge into it (increment the attempt count) instead of
   * creating a duplicate.
   */
  async recordFromAttempt(attempt: QuestionAttempt, question: Question): Promise<Mistake | null> {
    if (attempt.evaluation.isCorrect !== false) return null

    const existing = question.id ? await this.repo.findByQuestion(attempt.projectId, question.id) : undefined
    if (existing) {
      return this.repo.update(existing.id, {
        attemptCount: existing.attemptCount + 1,
        attemptIds: [...existing.attemptIds, attempt.id],
        studentAnswer: attempt.userAnswer,
        // A re-occurrence resets "understood" back to active.
        status: 'active',
        resolvedAt: undefined,
        analysisStatus: existing.analysis ? 'ready' : 'pending',
      })
    }

    return this.repo.add({
      projectId: attempt.projectId,
      questionId: question.id,
      ...(attempt.quizId ? { quizId: attempt.quizId } : {}),
      ...(question.topicId ? { topicId: question.topicId } : {}),
      knowledgePoint: question.knowledgePoint,
      difficulty: question.difficulty,
      questionType: question.type,
      question: question.prompt,
      ...(question.options ? { options: question.options } : {}),
      studentAnswer: attempt.userAnswer,
      correctAnswer: question.correctAnswer,
      ...(question.solution ? { solution: question.solution } : {}),
      // Snapshot the citation so the mistake book can show the course excerpt.
      ...(question.sourceRefs?.length ? { sourceRefs: question.sourceRefs } : {}),
      attemptIds: [attempt.id],
    })
  }

  /** Add a mistake the student enters by hand. */
  async addManual(input: {
    projectId: string
    question: string
    studentAnswer: string
    correctAnswer: string
    knowledgePoint: string
    difficulty?: Mistake['difficulty']
    questionType?: string
    mistakeType?: MistakeType
  }): Promise<Mistake> {
    if (!input.question.trim()) throw new ValidationError(t('errors.mistakeQuestionRequired'))
    if (!input.correctAnswer.trim()) throw new ValidationError(t('errors.mistakeAnswerRequired'))
    if (!input.knowledgePoint.trim()) throw new ValidationError(t('errors.mistakeKnowledgePointRequired'))
    const payload: AddMistakeInput = {
      projectId: input.projectId,
      question: input.question.trim(),
      studentAnswer: input.studentAnswer.trim(),
      correctAnswer: input.correctAnswer.trim(),
      knowledgePoint: input.knowledgePoint.trim(),
      difficulty: input.difficulty ?? 'basic',
      questionType: input.questionType ?? 'multiple_choice',
      ...(input.mistakeType ? { mistakeType: input.mistakeType } : {}),
    }
    return this.repo.add(payload)
  }

  async markUnderstood(id: string): Promise<Mistake> {
    logger.info('Mistake marked understood', { id })
    return this.repo.update(id, { status: 'understood', resolvedAt: Date.now() })
  }

  async archive(id: string): Promise<Mistake> {
    return this.repo.update(id, { status: 'archived', archivedAt: Date.now() })
  }

  async restore(id: string): Promise<Mistake> {
    return this.repo.update(id, { status: 'active', archivedAt: undefined, resolvedAt: undefined })
  }

  async remove(id: string): Promise<void> {
    return this.repo.delete(id)
  }

  async deleteByProject(projectId: string): Promise<number> {
    return this.repo.deleteByProject(projectId)
  }

  async updateMistakeType(id: string, mistakeType: MistakeType): Promise<Mistake> {
    return this.repo.update(id, { mistakeType })
  }

  /** Attach an AI analysis to a mistake. */
  async saveAnalysis(id: string, analysis: Mistake['analysis']): Promise<Mistake> {
    return this.repo.update(id, {
      analysis,
      analysisStatus: 'ready',
      analysisError: undefined,
      ...(analysis ? { mistakeType: analysis.mistakeType } : {}),
    })
  }

  async markAnalysisFailed(id: string, error: string): Promise<Mistake> {
    return this.repo.update(id, { analysisStatus: 'failed', analysisError: error })
  }

  async markAnalysisRunning(id: string): Promise<Mistake> {
    return this.repo.update(id, { analysisStatus: 'analyzing', analysisError: undefined })
  }

  /** Recent mistakes for a knowledge point — used to spot patterns. */
  async recentForKnowledgePoint(projectId: string, knowledgePoint: string, limit = 5): Promise<Mistake[]> {
    const rows = await this.repo.listByProject(projectId, { knowledgePoint })
    return rows.slice(0, limit)
  }
}