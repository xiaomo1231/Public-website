import { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { HomeworkRepository } from '@/entities/homework/repository'
import type { HomeworkQuestion } from '@/entities/homework/types'
import {
  checkTranslation,
  currentTranslation,
  translationSourceHash,
  type QuestionTranslation,
} from '@/entities/homework/questionTranslation'
import { SettingsService } from './settingsService'
import { t } from '@/i18n'

/** Output tokens per character of the question (Chinese + unchanged LaTeX in JSON). */
const TOKENS_PER_CHAR = 1.3
const MIN_BUDGET = 2_048

/**
 * 查看原题 → 中文翻译: one small request per question, made only when the
 * student asks; the result is checked locally (formulas, sub-part labels and
 * numbers unchanged) and cached on the question until its text changes.
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

  /** The cached translation, or a new one (one request). A stop throws `ABORTED`. */
  async translate(
    questionId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<QuestionTranslation> {
    const question = await this.repo.getQuestion(questionId)
    if (!question) throw new NotFoundError('HomeworkQuestion', questionId)
    const cached = currentTranslation(question)
    if (cached) return cached
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'NO_PROVIDER')
    const budget = Math.min(
      this.ai.maxOutputTokens > 0 ? this.ai.maxOutputTokens : Infinity,
      Math.max(MIN_BUDGET, Math.ceil(question.prompt.length * TOKENS_PER_CHAR) + 500),
    )
    const { data } = await this.ai.streamJSON<unknown>(
      [
        { role: 'system', content: prompts.questionTranslate.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.questionTranslate.buildUserPrompt({ question: question.prompt }),
        },
      ],
      undefined,
      { maxTokens: budget, ...(options.signal ? { signal: options.signal } : {}) },
    )
    const text = prompts.questionTranslate.readTranslation(data)
    if (!text) throw new AppError(t('homework.translation.invalid'), 'INVALID_RESPONSE')
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

/** The translation service with the configured AI (or none: translating then fails clearly). */
export async function buildQuestionTranslationService(): Promise<QuestionTranslationService> {
  const settings = await new SettingsService().get()
  const ai = settings.apiKey.trim()
    ? new AIService({ config: settings, usageKind: 'walkthrough' })
    : null
  return new QuestionTranslationService({ ai, db: getDb() })
}
