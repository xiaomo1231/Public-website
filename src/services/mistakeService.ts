import { isHeldOut, type EvalRoleCarrier } from '@/entities/evaluation/evalRole'
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
import { displayAnswer, expectedAnswerText, type Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import { ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import { isSigFigOnlyError } from '@/entities/question/answerDimensions'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import { errorDimensionOf, startFollowUp, type MistakeOrigin } from '@/entities/mistake/followUp'

export interface RecordMistakeOptions {
  /** Where the answer was given (default: `quiz` with a quiz id, else `practice`). */
  origin?: MistakeOrigin
  /** Homework-based mistakes: the set the question belongs to. */
  homeworkSetId?: string
  /** Lecture citations to store instead of the question's own (e.g. a past paper's topic). */
  sourceRefs?: SourceReference[]
  /** Independent evaluation items: recorded, but never re-tested or varied. */
  noFollowUp?: boolean
}

export class MistakeService {
  private repo: MistakeRepository
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
    this.repo = new MistakeRepository(this.db)
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
  async recordFromAttempt(
    attempt: QuestionAttempt,
    question: Question,
    options: RecordMistakeOptions = {},
  ): Promise<Mistake | null> {
    // A significant-figure slip on a right value and unit counts as correct
    // under the default course rule (hint only), but is still recorded so the
    // follow-up can practise it.
    if (attempt.evaluation.isCorrect !== false && !isSigFigOnlyError(attempt.evaluation))
      return null

    const errorDimension = errorDimensionOf({ evaluation: attempt.evaluation })
    // 错题跟进: a wrong answer (re)starts the re-test ladder — except for
    // independent evaluation items, which are never practised or re-tested.
    const followUpFor = (previous?: Mistake['followUp']) =>
      options.noFollowUp || isHeldOut(question as EvalRoleCarrier)
        ? undefined
        : startFollowUp(attempt.createdAt, question.prompt, errorDimension, previous)

    const existing = question.id
      ? await this.repo.findByQuestion(attempt.projectId, question.id)
      : undefined
    if (existing) {
      const followUp = followUpFor(existing.followUp)
      return this.repo.update(existing.id, {
        attemptCount: existing.attemptCount + 1,
        attemptIds: [...existing.attemptIds, attempt.id],
        studentAnswer: displayAnswer(question, attempt.userAnswer),
        lastOccurredAt: attempt.createdAt,
        // A re-occurrence resets "understood" back to active.
        status: 'active',
        resolvedAt: undefined,
        analysisStatus: existing.analysis ? 'ready' : 'pending',
        ...(errorDimension ? { errorDimension } : {}),
        ...(followUp ? { followUp } : {}),
      })
    }
    const followUp = followUpFor()

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
      // Stored as the student reads them (option letters, not internal ids).
      studentAnswer: displayAnswer(question, attempt.userAnswer),
      correctAnswer: ['multiple_select', 'matching', 'fill_blank'].includes(question.type)
        ? expectedAnswerText(question)
        : question.correctAnswer,
      ...(question.solution ? { solution: question.solution } : {}),
      // Snapshot the citation so the mistake book can show the course excerpt.
      ...(options.sourceRefs?.length
        ? { sourceRefs: options.sourceRefs }
        : question.sourceRefs?.length
          ? { sourceRefs: question.sourceRefs }
          : {}),
      attemptIds: [attempt.id],
      origin: options.origin ?? (attempt.quizId ? 'quiz' : 'practice'),
      ...(options.homeworkSetId ? { homeworkSetId: options.homeworkSetId } : {}),
      ...(errorDimension ? { errorDimension } : {}),
      ...(followUp ? { followUp } : {}),
    })
  }

  /**
   * Take one attempt back out of the mistake book (a disputed judgement): the
   * mistake is removed when that attempt was its only occurrence, otherwise
   * just this occurrence is dropped and the card shows the latest remaining
   * wrong answer again (not the disputed one).
   */
  async removeAttempt(projectId: string, questionId: string, attemptId: string): Promise<void> {
    // Whatever its status: an archived card holding the occurrence loses it too.
    const existing = await this.repo.findByAttempt(projectId, questionId, attemptId)
    if (!existing) return
    const remaining = existing.attemptIds.filter((id) => id !== attemptId)
    if (remaining.length === 0) {
      await this.repo.delete(existing.id)
      return
    }
    const latest = await this.latestAttempt(remaining)
    await this.repo.update(existing.id, {
      attemptIds: remaining,
      attemptCount: Math.max(1, existing.attemptCount - 1),
      ...(latest ? { studentAnswer: latest.studentAnswer, lastOccurredAt: latest.at } : {}),
      ...(latest?.quizId ? { quizId: latest.quizId } : {}),
    })
  }

  /** The most recent of these attempts (quiz or practice), as the card shows it. */
  private async latestAttempt(
    ids: string[],
  ): Promise<{ studentAnswer: string; quizId?: string; at: number } | null> {
    try {
      const [quizAttempts, practiceAttempts] = await Promise.all([
        this.db.questionAttempts.bulkGet(ids),
        this.db.practiceAttempts.bulkGet(ids),
      ])
      const candidates: Array<{
        at: number
        load: () => Promise<{ studentAnswer: string; quizId?: string }>
      }> = []
      for (const attempt of quizAttempts) {
        if (!attempt) continue
        candidates.push({
          at: attempt.createdAt,
          load: async () => {
            const question = await this.db.questions.get(attempt.questionId)
            return {
              studentAnswer: question
                ? displayAnswer(question, attempt.userAnswer)
                : attempt.userAnswer,
              ...(attempt.quizId ? { quizId: attempt.quizId } : {}),
            }
          },
        })
      }
      for (const attempt of practiceAttempts) {
        if (!attempt) continue
        candidates.push({
          at: attempt.submittedAt,
          load: async () => ({ studentAnswer: attempt.userAnswer }),
        })
      }
      if (candidates.length === 0) return null
      candidates.sort((a, b) => b.at - a.at)
      const newest = candidates[0]!
      return { ...(await newest.load()), at: newest.at }
    } catch (err) {
      logger.warn('Could not read the remaining attempts of a mistake', {
        error: (err as Error)?.message,
      })
      return null
    }
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
    if (!input.knowledgePoint.trim())
      throw new ValidationError(t('errors.mistakeKnowledgePointRequired'))
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

  /** Put back the analysis state a stopped run found (a stop is not a failure). */
  async restoreAnalysisState(
    id: string,
    previous: Pick<Mistake, 'analysisStatus' | 'analysisError'>,
  ): Promise<Mistake> {
    return this.repo.update(id, {
      analysisStatus: previous.analysisStatus,
      analysisError: previous.analysisError,
    })
  }

  async markAnalysisRunning(id: string): Promise<Mistake> {
    return this.repo.update(id, { analysisStatus: 'analyzing', analysisError: undefined })
  }

  /** Recent mistakes for a knowledge point — used to spot patterns. */
  async recentForKnowledgePoint(
    projectId: string,
    knowledgePoint: string,
    limit = 5,
  ): Promise<Mistake[]> {
    const rows = await this.repo.listByProject(projectId, { knowledgePoint })
    return rows.slice(0, limit)
  }
}
