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
    let { data, raw } = await this.ai.chatJSON<unknown>(messages, {
      ...(input.signal ? { signal: input.signal } : {}),
    })
    // Validate + sanitise before persisting.
    let output = normalizeTranslation(data)
    if (isIncompleteTranslation(input.selectedText, output.translation)) {
      const retry = await this.ai.chatJSON<unknown>([
        { role: 'system', content: prompts.translator.buildSystemPrompt() },
        { role: 'user', content: `${messages[1]!.content}\nThe previous response omitted most of the selected text. Translate every sentence in full.` },
      ], { ...(input.signal ? { signal: input.signal } : {}) })
      data = retry.data
      raw = retry.raw
      output = normalizeTranslation(data)
      if (isIncompleteTranslation(input.selectedText, output.translation)) {
        throw new AppError(t('translate.incomplete'), 'MALFORMED_TRANSLATION')
      }
    }
    // Notes about terminology are useful for a single term; for a sentence or
    // passage they make the result look like a lesson instead of a translation.
    if (input.selectedText.trim().length > 40) {
      output = { ...output, contextNote: '', alternatives: [] }
    }
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

export function isIncompleteTranslation(source: string, translation: string): boolean {
  const original = source.trim()
  const result = translation.trim()
  return original.length >= 70 && result.length < Math.max(12, original.length * 0.18)
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
