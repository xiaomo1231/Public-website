import { withLightModel, withUsageKind, type AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { prompts } from '@/infrastructure/ai/prompts'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { HomeworkQuestion } from '@/entities/homework/types'
import { cleanProfessorAnswerText } from '@/entities/homework/answerMatching'
import {
  currentProfessorMap,
  mapAnswerHash,
  mapQuestionHash,
  mapSubparts,
  mappableAnswer,
  segmentHints,
  segmentProfessorAnswer,
  validateProfessorMap,
  withProfessorMapEdit,
  type ProfessorAnswerMap,
  type ProfessorCoverage,
} from '@/entities/homework/professorMap'
import { isAbortError } from '@/shared/lib/generationControl'
import { loadProjectSubjectContext } from './projectSubject'
import { t } from '@/i18n'

/**
 * Maps that failed in this page session (unusable reply, provider error):
 * the writers do not ask again for the same answer and question until the
 * page is reloaded or the student asks (「按内容对应」), so a model that cannot
 * do it does not cost a request before every section.
 */
const failedMaps = new Set<string>()

function mapKey(question: HomeworkQuestion): string {
  return `${question.id}:${mapAnswerHash(question.answerText ?? '')}:${mapQuestionHash(question.prompt)}`
}

/** Tests only: forget the failures above. */
export function resetProfessorMapFailures(): void {
  failedMaps.clear()
}

export function professorMapPromptVersion(): string {
  return `professor-answer-map/${prompts.professorAnswerMap.VERSION}`
}

/**
 * 小题 ⇄ 教授答案对应: one small request per (answer, question), checked
 * locally (`validateProfessorMap`) and cached on the question. Used before
 * answer-based hints / solutions, before a walkthrough section written from
 * the professor answer, and by the comparison; shown and editable in the
 * professor-answer dialog. The 轻量模型 goes first when one is set; when its
 * reply is unusable, the main model.
 */
export class ProfessorAnswerMapService {
  private ai: AIService | null
  private db: AppDatabase
  private repo: HomeworkRepository

  constructor(deps: { ai: AIService | null; db?: AppDatabase }) {
    this.ai = deps.ai
    this.db = deps.db ?? getDb()
    this.repo = new HomeworkRepository(this.db)
  }

  /**
   * The question with a current AI map when one can be made: the cached one,
   * else a new request. Never throws but for a stop: without AI, a question
   * without sub-parts, or a failed / unusable reply the question comes back
   * as it is (the writers then work without a map, as before).
   */
  async ensure(
    question: HomeworkQuestion,
    options: { signal?: AbortSignal } = {},
  ): Promise<HomeworkQuestion> {
    if (!mappableAnswer(question) || currentProfessorMap(question)) return question
    if (!this.ai || typeof (this.ai as Partial<AIService>).chatJSON !== 'function') return question
    if (failedMaps.has(mapKey(question))) return question
    try {
      return await this.request(question, options.signal)
    } catch (err) {
      if (isAbortError(err, options.signal)) throw err
      failedMaps.add(mapKey(question))
      logger.warn('Professor answer map failed; writing without it', {
        error: (err as Error)?.message,
      })
      return question
    }
  }

  /** A new AI map for one question (the dialog's 「AI 对应小题」). Throws on failure. */
  async remap(
    questionId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<HomeworkQuestion> {
    const question = await this.repo.getQuestion(questionId)
    if (!question) throw new NotFoundError('HomeworkQuestion', questionId)
    if (!mappableAnswer(question))
      throw new AppError(t('homework.answer.map.unavailable'), 'VALIDATION_ERROR')
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'NO_PROVIDER')
    failedMaps.delete(mapKey(question))
    return this.request(question, options.signal)
  }

  /** The student's choice for one sub-part (`null`: back to the AI / local map). */
  async setEdit(
    questionId: string,
    label: string,
    edit: { coverage: ProfessorCoverage; quotes: string[] } | null,
  ): Promise<HomeworkQuestion> {
    const question = await this.repo.getQuestion(questionId)
    if (!question) throw new NotFoundError('HomeworkQuestion', questionId)
    if (!mappableAnswer(question))
      throw new AppError(t('homework.answer.map.unavailable'), 'VALIDATION_ERROR')
    if (edit && edit.coverage !== 'none' && edit.quotes.length === 0)
      throw new AppError(t('homework.answer.map.needExcerpt'), 'VALIDATION_ERROR')
    const professorMapEdits = withProfessorMapEdit(question, label, edit)
    const updated = await this.repo.updateQuestion(questionId, { professorMapEdits })
    return updated ?? { ...question, ...(professorMapEdits ? { professorMapEdits } : {}) }
  }

  private async request(
    question: HomeworkQuestion,
    signal?: AbortSignal,
  ): Promise<HomeworkQuestion> {
    const ai = withUsageKind(this.ai!, 'walkthrough')
    const answer = question.answerText ?? ''
    const subject = await loadProjectSubjectContext(question.projectId, this.db).catch(
      () => undefined,
    )
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.professorAnswerMap.buildSystemPrompt(),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.professorAnswerMap.buildUserPrompt({
          question: question.prompt,
          parts: mapSubparts(question.prompt),
          professorAnswer: cleanProfessorAnswerText(answer),
          segments: segmentHints(segmentProfessorAnswer(answer, question.prompt)),
        }),
      },
    ]
    const light = withLightModel(ai)
    const models = light !== ai ? [light, ai] : [ai]
    let lastError: unknown
    for (const model of models) {
      try {
        const { data } = await model.chatJSON<unknown>(messages, {
          ...(signal ? { signal } : {}),
        })
        const raw = prompts.professorAnswerMap.normalizeMapReply(data)
        const checked = raw
          ? validateProfessorMap(raw, { question: question.prompt, answer })
          : null
        if (!checked) {
          lastError = new AppError(t('homework.answer.map.invalid'), 'INVALID_RESPONSE')
          continue
        }
        const map: ProfessorAnswerMap = {
          answerHash: mapAnswerHash(answer),
          questionHash: mapQuestionHash(question.prompt),
          promptVersion: professorMapPromptVersion(),
          entries: checked.entries,
          createdAt: Date.now(),
        }
        return await this.saveIfCurrent(question, map)
      } catch (err) {
        if (isAbortError(err, signal)) throw err
        lastError = err
      }
    }
    throw lastError ?? new AppError(t('homework.answer.map.invalid'), 'INVALID_RESPONSE')
  }

  /** Saved only while the question and its answer are still the ones mapped. */
  private async saveIfCurrent(
    question: HomeworkQuestion,
    map: ProfessorAnswerMap,
  ): Promise<HomeworkQuestion> {
    const latest = await this.repo.getQuestion(question.id)
    if (
      latest &&
      mapAnswerHash(latest.answerText ?? '') === map.answerHash &&
      mapQuestionHash(latest.prompt) === map.questionHash
    ) {
      return (
        (await this.repo.updateQuestion(question.id, { professorMap: map })) ?? {
          ...latest,
          professorMap: map,
        }
      )
    }
    return { ...question, professorMap: map }
  }
}
