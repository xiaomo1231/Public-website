import type { AIService } from './aiService'
import { prompts } from '@/infrastructure/ai/prompts'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import type {
  TutorVisualization,
  VisualizationDraftOutput,
} from '@/entities/tutorVisualization/types'
import { logger } from '@/infrastructure/logger/logger'

/**
 * Generates the structured 2D visualizations for a finished lesson.
 *
 * Runs as a second, small JSON call *after* the lesson text exists. It is
 * fully isolated: any provider failure, unparseable JSON or invalid maths
 * yields an empty list, and the lesson renders normally without figures.
 */

export interface TutorVisualizationInput {
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
  lessonContent: string
}

/** Graphs are small; a modest cap keeps the call cheap and bounded. */
const MAX_VISUALIZATION_TOKENS = 2048

export class TutorVisualizationService {
  private ai: AIService

  constructor(deps: { ai: AIService }) {
    this.ai = deps.ai
  }

  async generate(input: TutorVisualizationInput): Promise<TutorVisualization[]> {
    // Some embedders/tests supply a minimal AI stub with no JSON helper.
    if (typeof this.ai.chatJSON !== 'function') return []

    const messages = [
      { role: 'system' as const, content: prompts.visualizationGenerator.buildSystemPrompt() },
      {
        role: 'user' as const,
        content: prompts.visualizationGenerator.buildUserPrompt({
          topicName: input.topicName,
          topicDescription: input.topicDescription,
          language: input.language,
          lessonContent: input.lessonContent,
        }),
      },
    ]

    try {
      // Never ask for more tokens than the provider is configured to allow.
      const configured = this.ai.maxOutputTokens
      const maxTokens =
        Number.isFinite(configured) && configured > 0
          ? Math.min(MAX_VISUALIZATION_TOKENS, configured)
          : MAX_VISUALIZATION_TOKENS
      const { data } = await this.ai.chatJSON<VisualizationDraftOutput>(messages, { maxTokens })
      const { visualizations, rejected } = normalizeVisualizations(data)
      if (rejected.length > 0) {
        logger.debug('Tutor visualizations rejected during validation', {
          topicName: input.topicName,
          rejected,
        })
      }
      return visualizations
    } catch (err) {
      // A missing figure must never cost the lesson.
      logger.warn('Tutor visualization generation failed; continuing without graphs', {
        topicName: input.topicName,
        error: (err as Error)?.message,
      })
      return []
    }
  }
}
