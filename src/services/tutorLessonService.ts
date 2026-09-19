import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { Topic } from '@/entities/courseAnalysis/types'
import { ChunkRepository } from '@/entities/chunk/repository'
import { TutorLessonRepository } from '@/entities/tutorLesson/repository'
import type { TutorLesson, TutorLessonKey } from '@/entities/tutorLesson/types'
import { TUTOR_LESSON_VERSION } from '@/entities/tutorLesson/types'
import { collectTopicSources, formatTopicSources } from './topicSources'
import type { AIService } from './aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { extractSymbolsFromMarkdown } from '@/shared/lib/latexSymbols'
import { normalizeExtractedText } from '@/infrastructure/files/textEncoding'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

const MAX_LESSON_SOURCES = 8

/**
 * Concurrent callers for the same lesson share one request.
 *
 * Module scope, not instance scope: `buildAIServices()` constructs a new
 * `TutorLessonService` on every call, so a per-instance map would never see the
 * other caller. Two components mounting together, React StrictMode
 * double-invoking an effect, or a rapid topic switch back and forth would each
 * start their own generation. Entries are removed as soon as the request
 * settles, so this never grows unbounded.
 */
const inFlight = new Map<string, Promise<TutorLessonResult>>()

export interface TutorLessonInput extends TutorLessonKey {
  topicName: string
  topicDescription: string
  signal?: AbortSignal
}

export interface TutorLessonResult {
  lesson: TutorLesson
  /** True when a stored lesson was reused and the AI was never called. */
  fromCache: boolean
  /**
   * Set when a refresh was attempted, failed, and an older lesson is being
   * shown instead. The lesson is still readable; the header explains why it
   * may be out of date.
   */
  refreshError?: string
}

export interface TutorLessonOptions {
  onDelta?: (delta: string) => void
}

/**
 * Stable fingerprint of the topic a lesson was generated from.
 *
 * Changing the course analysis changes the topic (or its citations), which
 * changes the hash, which invalidates the cached lesson. The prompt version is
 * folded in so a prompt change also invalidates.
 */
export function computeLessonContentHash(
  topic: Pick<Topic, 'name' | 'description' | 'sourceRefs'>,
  promptVersion: string,
): string {
  const payload = JSON.stringify({
    promptVersion,
    name: topic.name,
    description: topic.description,
    refs: (topic.sourceRefs ?? []).map((ref) => [
      ref.documentId,
      ref.page,
      ref.section,
      ref.quote,
      ref.chunkId,
    ]),
  })
  return fnv1a(payload)
}

/** Small, dependency-free, deterministic hash. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function keyOf(input: TutorLessonKey): string {
  return `${input.projectId}::${input.topicId}::${input.language}`
}

/**
 * Cache-first lesson generation.
 *
 * Reading a topic must never cost tokens twice: the first visit generates and
 * stores the lesson, every later visit (and every remount, refresh or language
 * switch back) is served from IndexedDB.
 */
export class TutorLessonService {
  private db: AppDatabase
  private lessons: TutorLessonRepository
  private analyses: CourseAnalysisRepository
  private chunks: ChunkRepository
  private ai: AIService

  constructor(deps: {
    ai: AIService
    db?: AppDatabase
    lessons?: TutorLessonRepository
    analyses?: CourseAnalysisRepository
    chunks?: ChunkRepository
  }) {
    this.db = deps.db ?? getDb()
    this.lessons = deps.lessons ?? new TutorLessonRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.ai = deps.ai
  }

  /** Any stored lesson for this topic + language, ignoring freshness. */
  async load(key: TutorLessonKey): Promise<TutorLesson | undefined> {
    return this.lessons.find(key)
  }

  /**
   * Return the cached lesson when it is still valid, otherwise generate one.
   *
   * Concurrent calls for the same key are coalesced into a single AI request.
   */
  async getOrGenerate(
    input: TutorLessonInput,
    options: TutorLessonOptions = {},
  ): Promise<TutorLessonResult> {
    const key = keyOf(input)
    const existing = inFlight.get(key)
    if (existing) return existing

    const run = this.resolve(input, options).finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, run)
    return run
  }

  /** Force a fresh generation, replacing whatever is stored. */
  async regenerate(
    input: TutorLessonInput,
    options: TutorLessonOptions = {},
  ): Promise<TutorLessonResult> {
    return this.generate(input, options)
  }

  private async resolve(
    input: TutorLessonInput,
    options: TutorLessonOptions,
  ): Promise<TutorLessonResult> {
    const topic = await this.analyses.getTopic(input.topicId)
    if (!topic) throw new AppError(t('errors.topicNotFound'), 'NOT_FOUND')

    const promptVersion = prompts.tutorLesson.VERSION
    const contentHash = computeLessonContentHash(topic, promptVersion)

    const stored = await this.lessons.find(input)
    if (
      stored &&
      stored.contentHash === contentHash &&
      stored.promptVersion === promptVersion &&
      stored.content.trim().length > 0
    ) {
      logger.debug('Tutor lesson cache hit', { topicId: input.topicId, language: input.language })
      return { lesson: stored, fromCache: true }
    }

    try {
      return await this.generate(input, options)
    } catch (err) {
      // Never surface a failed refresh as a blank page when we already have
      // something readable on disk.
      if (stored && stored.content.trim().length > 0) {
        logger.warn('Tutor lesson refresh failed; serving the stored lesson', {
          topicId: input.topicId,
          error: (err as Error)?.message,
        })
        return {
          lesson: stored,
          fromCache: true,
          refreshError: (err as Error)?.message ?? t('tutor.lessonRefreshFailed'),
        }
      }
      throw err
    }
  }

  private async generate(
    input: TutorLessonInput,
    options: TutorLessonOptions,
  ): Promise<TutorLessonResult> {
    const topic = await this.analyses.getTopic(input.topicId)
    if (!topic) throw new AppError(t('errors.topicNotFound'), 'NOT_FOUND')

    const sources = await collectTopicSources(
      { analyses: this.analyses, chunks: this.chunks },
      input.projectId,
      input.topicId,
      MAX_LESSON_SOURCES,
    )

    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.tutorLesson.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.tutorLesson.buildUserPrompt({
          topicName: input.topicName,
          topicDescription: input.topicDescription,
          language: input.language,
          sourceSnippets: formatTopicSources(sources),
        }),
      },
    ]

    logger.debug('Tutor lesson request started', {
      topicId: input.topicId,
      language: input.language,
      sources: sources.length,
      streaming: Boolean(options.onDelta),
    })

    const response = options.onDelta
      ? await this.ai.streamChat(messages, options.onDelta, {
          ...(input.signal ? { signal: input.signal } : {}),
        })
      : await this.ai.chat(messages, {
          ...(input.signal ? { signal: input.signal } : {}),
        })

    // Lossless cleanup, then canonical maths: recover/convert Unicode maths to
    // LaTeX and mark anything unrecoverable so no Private Use Area character
    // can reach the reader or the symbols panel.
    const normalized = normalizeMathNotation(normalizeExtractedText(response.content ?? ''))
    const content = normalized.text.trim()
    if (!content) {
      // A failed generation must never be stored as if it were a lesson.
      throw new AppError(t('tutor.emptyResponse'), 'EMPTY_TUTOR_RESPONSE')
    }
    if (normalized.unresolved > 0) {
      logger.warn('Tutor lesson contained unrecoverable characters', {
        topicId: input.topicId,
        language: input.language,
        unresolved: normalized.unresolved,
      })
    }

    const now = Date.now()
    const lesson: TutorLesson = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      topicId: input.topicId,
      language: input.language,
      content,
      // Symbols come from the lesson text itself, so the panel can never
      // disagree with what the student read. Only real maths is scanned, so
      // code samples and prose cannot inject fake symbols.
      symbols: extractSymbolsFromMarkdown(content),
      sourceChunkIds: sources.map((source) => source.chunkId),
      contentHash: computeLessonContentHash(topic, prompts.tutorLesson.VERSION),
      promptVersion: prompts.tutorLesson.VERSION,
      ...(response.model ? { model: response.model } : {}),
      generatedAt: now,
      updatedAt: now,
      version: TUTOR_LESSON_VERSION,
    }

    // Replace any previous lesson for this topic + language.
    const previous = await this.lessons.find(input)
    if (previous) await this.lessons.deleteByTopic(input)
    await this.lessons.upsert(lesson)

    logger.debug('Tutor lesson stored', {
      topicId: input.topicId,
      language: input.language,
      chars: content.length,
      symbols: lesson.symbols.length,
    })

    return { lesson, fromCache: false }
  }
}
