import type { AIService } from './aiService'
import { TranslationRepository } from '@/entities/translation/repository'
import { prompts } from '@/infrastructure/ai/prompts'
import type { TranslationOutput } from '@/infrastructure/ai/prompts/types'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { TranslationEntry } from '@/entities/translation/types'
import { asStringArray, asTrimmedString } from '@/infrastructure/ai/validation'
import { logger } from '@/infrastructure/logger/logger'
import { AppError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

export interface TranslationInput {
  projectId: string
  selectedText: string
  surroundingContext: string
  sourceLanguage: 'zh' | 'en'
  targetLanguage: 'zh' | 'en'
  topic?: string
  signal?: AbortSignal
}

export class TranslationService {
  private ai: AIService
  private repo: TranslationRepository

  constructor(deps: { ai: AIService; repo?: TranslationRepository }) {
    this.ai = deps.ai
    this.repo = deps.repo ?? new TranslationRepository()
  }

  async translate(input: TranslationInput): Promise<TranslationEntry> {
    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.translator.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.translator.buildUserPrompt({
          selectedText: input.selectedText,
          surroundingContext: input.surroundingContext,
          topic: input.topic,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
        }),
      },
    ]
    const { data, raw } = await this.ai.chatJSON<unknown>(messages, {
      ...(input.signal ? { signal: input.signal } : {}),
    })
    // Validate + sanitise before persisting.
    const output = normalizeTranslation(data)
    logger.debug('Translation completed', { tokens: raw.usage?.totalTokens })
    const entry: TranslationEntry = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      sourceText: input.selectedText,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      translation: output.translation,
      contextNote: output.contextNote,
      alternatives: output.alternatives,
      context: {
        ...(input.topic ? { topic: input.topic } : {}),
        surrounding: input.surroundingContext,
      },
      createdAt: Date.now(),
    }
    await this.repo.add(entry)
    return entry
  }

  listByProject(projectId: string, limit?: number) {
    return this.repo.listByProject(projectId, limit)
  }
}

/**
 * Coerce the model's translation response into the expected shape.
 * Throws when there is no usable translation rather than storing a blank.
 */
export function normalizeTranslation(raw: unknown): TranslationOutput {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const translation = asTrimmedString(record.translation)
  if (!translation) {
    throw new AppError(t('errors.aiNoTranslation'), 'MALFORMED_TRANSLATION')
  }
  return {
    translation,
    contextNote: asTrimmedString(record.contextNote),
    alternatives: asStringArray(record.alternatives).slice(0, 3),
  }
}