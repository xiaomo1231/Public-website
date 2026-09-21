import type { AIService } from './aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { normalizeExtractedText } from '@/infrastructure/files/textEncoding'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

export interface ContextualTutorInput {
  projectId: string
  topicId: string
  topicTitle?: string
  sectionHeading?: string
  selectedText: string
  surroundingContext: string
  question: string
  language: string
  signal?: AbortSignal
}

export interface ContextualTutorAnswer {
  question: string
  answer: string
}

/**
 * Concurrent identical questions share one request.
 *
 * Module scope: `buildAIServices()` hands out a new service on every call, so a
 * per-instance map would never see the other caller. A double click, a React
 * StrictMode re-invocation or a remount must not spend tokens twice.
 */
const inFlight = new Map<string, Promise<ContextualTutorAnswer>>()

function keyOf(input: ContextualTutorInput): string {
  return [input.projectId, input.topicId, input.selectedText, input.question].join('\u0000')
}

/**
 * The contextual tutor: a temporary, read-only Q&A about a passage.
 *
 * Deliberately does not touch any repository — no Tutor lesson cache, no
 * translation history. The lesson stays the stable teaching artifact; this is
 * an ephemeral conversation layered on top of it.
 */
export class ContextualTutorService {
  private ai: AIService

  constructor(deps: { ai: AIService }) {
    this.ai = deps.ai
  }

  async ask(input: ContextualTutorInput): Promise<ContextualTutorAnswer> {
    const key = keyOf(input)
    const existing = inFlight.get(key)
    if (existing) return existing

    const run = this.run(input).finally(() => inFlight.delete(key))
    inFlight.set(key, run)
    return run
  }

  private async run(input: ContextualTutorInput): Promise<ContextualTutorAnswer> {
    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.contextualTutor.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.contextualTutor.buildUserPrompt({
          ...(input.topicTitle ? { topicTitle: input.topicTitle } : {}),
          ...(input.sectionHeading ? { sectionHeading: input.sectionHeading } : {}),
          selectedText: input.selectedText,
          surroundingContext: input.surroundingContext,
          question: input.question,
          language: input.language,
        }),
      },
    ]

    const response = await this.ai.chat(messages, {
      ...(input.signal ? { signal: input.signal } : {}),
    })

    // Same canonicalisation as the rest of the tutor: recover/convert maths and
    // make sure no Private Use Area glyph reaches the answer.
    const answer = normalizeMathNotation(normalizeExtractedText(response.content ?? '')).text.trim()
    if (!answer) {
      throw new AppError(t('errors.aiNoAnswer'), 'EMPTY_CONTEXTUAL_ANSWER')
    }

    logger.debug('Contextual tutor answered', {
      projectId: input.projectId,
      topicId: input.topicId,
      chars: answer.length,
    })
    return { question: input.question, answer }
  }
}
