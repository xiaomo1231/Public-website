import { AIService, aiConcurrency, asTruncatedAtCap, withLightModel } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { prompts } from '@/infrastructure/ai/prompts'
import { AbortedError, OutputTruncatedError } from '@/infrastructure/ai/errors'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  checkTranslation,
  currentTranslation,
  joinTranslationBlocks,
  splitTranslationBlocks,
  translationSourceHash,
  type QuestionTranslation,
} from '@/entities/homework/questionTranslation'
import { createAdaptivePool } from '@/shared/lib/concurrency'
import { SettingsService } from './settingsService'
import { t } from '@/i18n'

const isTruncated = (err: unknown): err is OutputTruncatedError =>
  err instanceof OutputTruncatedError ||
  (err as { code?: unknown } | null)?.code === 'OUTPUT_TRUNCATED'

/**
 * A reply cut off at the output cap, in the translation's own words:
 * whose limit stopped it and what to do (instead of the generic 「请重试本题」).
 */
export function translationTruncatedError(cause: unknown): AppError {
  const atCap = cause instanceof OutputTruncatedError ? cause.atCap : undefined
  const key = !atCap
    ? 'homework.translation.truncated'
    : atCap.by === 'model'
      ? 'homework.translation.truncatedModel'
      : atCap.by === 'unknown'
        ? 'homework.translation.truncatedUnknown'
        : 'homework.translation.truncatedSetting'
  return new AppError(t(key, { limit: atCap?.limit ?? 0 }), 'TRANSLATION_TRUNCATED', cause)
}

/**
 * 查看原题 → 中文翻译: one request per question, made only when the student
 * asks; the result is checked locally (formulas, sub-part labels and numbers
 * unchanged) and cached on the question until its text changes.
 *
 * Budget: the resolved output cap (AIService), never a smaller first try; a
 * reply cut off there is not asked again — a question with sub-parts is
 * translated block by block (stem + each sub-part, in parallel) and joined. The 轻量模型 goes first when one is set;
 * cut off there, the main model does it.
 */
export class QuestionTranslationService {
  private ai: AIService | null
  private repo: HomeworkRepository

  constructor(deps: { ai: AIService | null; db?: AppDatabase }) {
    this.ai = deps.ai
    this.repo = new HomeworkRepository(deps.db ?? getDb())
  }

  hasAI(): boolean {
    return this.ai !== null
  }

  /** The cached translation, or a new one. A stop throws `ABORTED`. */
  async translate(
    questionId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<QuestionTranslation> {
    const question = await this.repo.getQuestion(questionId)
    if (!question) throw new NotFoundError('HomeworkQuestion', questionId)
    const cached = currentTranslation(question)
    if (cached) return cached
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'NO_PROVIDER')
    const { signal } = options
    // A plain translation: the 轻量模型 when one is set, the main model when
    // the light one's reply does not fit.
    const light = withLightModel(this.ai)
    const models = light !== this.ai ? [light, this.ai] : [this.ai]
    let text = ''
    for (let i = 0; i < models.length; i++) {
      try {
        text = await translateWith(models[i]!, question.prompt, signal)
        break
      } catch (err) {
        if (signal?.aborted) throw new AbortedError()
        if (!isTruncated(err)) throw err
        if (i + 1 < models.length) continue
        throw translationTruncatedError(err)
      }
    }
    const check = checkTranslation(question.prompt, text)
    if (!check.ok)
      throw new AppError(
        t('homework.translation.changed', {
          items: [...check.missingFormulas, ...check.missingLabels, ...check.missingNumbers]
            .slice(0, 3)
            .join('、'),
        }),
        'TRANSLATION_CHANGED',
      )
    const translation: QuestionTranslation = {
      language: 'zh',
      sourceHash: translationSourceHash(question.prompt),
      promptVersion: `question-translate/${prompts.questionTranslate.VERSION}`,
      text,
      createdAt: Date.now(),
    }
    // Saved only while the question text is still the one translated.
    await this.saveIfCurrent(question, translation)
    return translation
  }

  private async saveIfCurrent(
    question: HomeworkQuestion,
    translation: QuestionTranslation,
  ): Promise<void> {
    const latest = await this.repo.getQuestion(question.id)
    if (latest && translationSourceHash(latest.prompt) === translation.sourceHash)
      await this.repo.updateQuestion(question.id, { translation })
  }
}

/**
 * The whole question in one reply; cut off and with sub-parts, block by
 * block. Throws `OutputTruncatedError` when it does
 * not fit either way.
 */
async function translateWith(
  ai: AIService,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  try {
    return await requestTranslation(ai, prompt, undefined, signal)
  } catch (err) {
    if (!isTruncated(err) || signal?.aborted) throw err
    const blocks = splitTranslationBlocks(prompt)
    if (blocks.length < 2) throw err
    const outcomes = await createAdaptivePool({ max: aiConcurrency(ai) }).run(
      blocks,
      (block, ctx) =>
        requestTranslation(ai, block.text, { index: ctx.index + 1, total: blocks.length }, signal),
    )
    const texts: string[] = []
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') texts.push(outcome.value)
      else if (signal?.aborted) throw new AbortedError()
      else throw outcome.status === 'rejected' ? outcome.reason : err
    }
    return joinTranslationBlocks(blocks, texts)
  }
}

/**
 * One translation request (plain text between markers, so LaTeX is not
 * escaped), sent at the output cap. A reply cut off there throws
 * `OutputTruncatedError.atCap` at once (no larger budget exists).
 */
async function requestTranslation(
  ai: AIService,
  source: string,
  part: { index: number; total: number } | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const messages = [
    { role: 'system' as const, content: prompts.questionTranslate.buildSystemPrompt() },
    {
      role: 'user' as const,
      content: prompts.questionTranslate.buildUserPrompt({
        question: source,
        ...(part ? { part } : {}),
      }),
    },
  ]
  if (signal?.aborted) throw new AbortedError()
  const res = await ai.chat(messages, {
    ...(signal ? { signal } : {}),
    // Translating a question: little thinking needed.
    reasoning: 'low',
  })
  if (res.finishReason === 'length') throw asTruncatedAtCap(ai, null)
  const text = prompts.questionTranslate.readTranslation(res.content)
  if (!text) throw new AppError(t('homework.translation.invalid'), 'INVALID_RESPONSE')
  return text
}

/** The translation service with the configured AI (or none: translating then fails clearly). */
export async function buildQuestionTranslationService(): Promise<QuestionTranslationService> {
  const settings = await new SettingsService().get()
  const ai = settings.apiKey.trim()
    ? new AIService({ config: settings, usageKind: 'walkthrough' })
    : null
  return new QuestionTranslationService({ ai, db: getDb() })
}
