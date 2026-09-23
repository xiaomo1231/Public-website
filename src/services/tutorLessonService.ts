import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { Topic } from '@/entities/courseAnalysis/types'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import { TutorLessonRepository } from '@/entities/tutorLesson/repository'
import type { TutorLesson, TutorLessonKey, TutorVisual } from '@/entities/tutorLesson/types'
import { TUTOR_LESSON_VERSION } from '@/entities/tutorLesson/types'
import { hasGraphableMath } from '@/entities/tutorVisualization/graphable'
import type { TutorVisualization } from '@/entities/tutorVisualization/types'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { TutorVisualizationService } from './tutorVisualizationService'
import { collectTopicSources, rankContextChunks, type TopicSource } from './topicSources'
import { resolveMaterialType } from '@/entities/document/types'
import type { AIService } from './aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { extractSymbolsFromMarkdown } from '@/shared/lib/latexSymbols'
import { normalizeExtractedText } from '@/infrastructure/files/textEncoding'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { looksLikeUnreliableVisualText } from '@/infrastructure/files/visualDetection'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import { fnv1a } from '@/shared/lib/hash'

const MAX_LESSON_SOURCES = 8
/** Notes / transcript excerpts pulled in alongside the textbook for a topic. */
const MAX_CONTEXT_SOURCES = 4

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
  topic: Pick<Topic, 'name' | 'description' | 'sourceRefs'> & {
    chapterId?: string
    sectionId?: string
  },
  promptVersion: string,
  /** Hash of the notes/transcript context actually used for this topic. */
  contextHash = '',
): string {
  const payload = JSON.stringify({
    promptVersion,
    contextHash,
    name: topic.name,
    description: topic.description,
    // A structure change must invalidate the affected lesson, not all of them.
    chapterId: topic.chapterId ?? '',
    sectionId: topic.sectionId ?? '',
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
  private visuals: VisualSourceRepository
  private visualizationService: TutorVisualizationService
  private ai: AIService

  constructor(deps: {
    ai: AIService
    db?: AppDatabase
    lessons?: TutorLessonRepository
    analyses?: CourseAnalysisRepository
    chunks?: ChunkRepository
    visuals?: VisualSourceRepository
    visualizationService?: TutorVisualizationService
  }) {
    this.db = deps.db ?? getDb()
    this.lessons = deps.lessons ?? new TutorLessonRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.visuals = deps.visuals ?? new VisualSourceRepository(this.db)
    this.visualizationService =
      deps.visualizationService ?? new TutorVisualizationService({ ai: deps.ai })
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
    // The hash must include the notes/transcript context this topic would use,
    // otherwise a stored lesson could never match.
    const { contextHash } = await this.topicContext(input, topic)
    const contentHash = computeLessonContentHash(topic, promptVersion, contextHash)

    const stored = await this.lessons.find(input)
    if (
      stored &&
      stored.version === TUTOR_LESSON_VERSION &&
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

    // Figures are attached to the lesson as visual sources. Where a source
    // chunk is an unreliable transcription of one of those figures, the model
    // is told to reference the figure instead of reproducing the broken text.
    const visuals = await this.collectVisuals(sources)

    // Textbook is the primary source; notes and transcript are retrieved
    // separately, ranked by relevance to this topic only.
    const textbookSources = sources.filter((source) => source.materialType === 'textbook')
    const { notesChunks, transcriptChunks, contextHash } = await this.topicContext(input, topic)

    const notesSnippets = notesChunks.map(
      (chunk) => `[${chunk.sourceReference}] ${normalizeMathNotation(chunk.text).text}`,
    )
    const transcriptSnippets = transcriptChunks.map(
      (chunk) => `[${chunk.sourceReference}] ${normalizeMathNotation(chunk.text).text}`,
    )

    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.tutorLesson.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.tutorLesson.buildUserPrompt({
          topicName: input.topicName,
          topicDescription: input.topicDescription,
          language: input.language,
          sourceSnippets: this.buildSourceSnippets(textbookSources, visuals),
          ...(notesSnippets.length > 0 ? { notesSnippets } : {}),
          ...(transcriptSnippets.length > 0 ? { transcriptSnippets } : {}),
          ...(topic.chapterNumber || topic.chapterTitle
            ? { chapterLabel: [topic.chapterNumber, topic.chapterTitle].filter(Boolean).join(' — ') }
            : {}),
          ...(topic.sectionNumber || topic.sectionTitle
            ? { sectionLabel: [topic.sectionNumber, topic.sectionTitle].filter(Boolean).join(' — ') }
            : {}),
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

    // Structured 2D visualizations come from a second, isolated AI call. The
    // local gate skips it entirely when the lesson has nothing plottable, so
    // set theory and prose lessons cost no extra tokens.
    const visualizations = await this.generateVisualizations(content, input, topic)

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
      ...(visuals.length > 0 ? { visuals } : {}),
      ...(visualizations.length > 0 ? { visualizations } : {}),
      sourceChunkIds: [
        ...sources.map((source) => source.chunkId),
        ...notesChunks.map((chunk) => chunk.id),
        ...transcriptChunks.map((chunk) => chunk.id),
      ],
      contentHash: computeLessonContentHash(topic, prompts.tutorLesson.VERSION, contextHash),
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
      visuals: visuals.length,
    })

    return { lesson, fromCache: false }
  }

  /**
   * Optional 2D visualizations for a finished lesson.
   *
   * The cheap local gate avoids a wasted AI call when the lesson has no
   * plottable relation. The service itself never throws: any failure yields an
   * empty list, so the lesson is stored and rendered exactly as before.
   */
  private async generateVisualizations(
    content: string,
    input: TutorLessonInput,
    topic: Pick<Topic, 'name' | 'description'>,
  ): Promise<TutorVisualization[]> {
    if (!hasGraphableMath(content)) return []
    return this.visualizationService.generate({
      topicName: input.topicName,
      topicDescription: input.topicDescription || topic.description || '',
      language: input.language,
      lessonContent: content,
    })
  }

  /**
   * Notes and transcript excerpts relevant to one topic, plus a hash of that
   * context. Shared by the cache check and generation so the two always agree,
   * and so changing a note about a *different* topic cannot invalidate this
   * lesson.
   */
  private async topicContext(
    input: TutorLessonInput,
    topic: Pick<Topic, 'name' | 'description'>,
  ): Promise<{
    notesChunks: DocumentChunk[]
    transcriptChunks: DocumentChunk[]
    contextHash: string
  }> {
    const allChunks = await this.chunks.listByProject(input.projectId)
    const notesChunks = rankContextChunks(
      allChunks.filter((chunk) => resolveMaterialType(chunk.materialType) === 'user_notes'),
      topic.name,
      topic.description ?? '',
      MAX_CONTEXT_SOURCES,
    )
    const transcriptChunks = rankContextChunks(
      allChunks.filter((chunk) => resolveMaterialType(chunk.materialType) === 'lecture_transcript'),
      topic.name,
      topic.description ?? '',
      MAX_CONTEXT_SOURCES,
    )
    const contextHash = fnv1a([...notesChunks, ...transcriptChunks].map((c) => c.id).join('|'))
    return { notesChunks, transcriptChunks, contextHash }
  }

  /**
   * Figures that belong to the topic's source pages.
   *
   * Only provenance is read here — the image bytes stay in IndexedDB and are
   * loaded by the display component, so a cache hit costs no rendering.
   */
  private async collectVisuals(sources: TopicSource[]): Promise<TutorVisual[]> {
    const found = new Map<string, TutorVisual>()
    for (const source of sources) {
      if (source.pageNumber === undefined) continue
      const visuals = await this.visuals.listByDocumentPage(source.documentId, source.pageNumber)
      for (const visual of visuals) {
        if (found.has(visual.id)) continue
        found.set(visual.id, {
          id: visual.id,
          documentId: visual.documentId,
          pageNumber: visual.pageNumber,
          type: visual.type,
          caption: visual.caption,
          hasImage: visual.imageMimeType.length > 0,
        })
      }
    }
    return [...found.values()]
  }

  /**
   * Prompt snippets. A chunk whose text is an unreliable transcription of a
   * figure that we have preserved is replaced by a pointer to that figure, so
   * the model neither reads nor echoes the broken glyphs. Normal text is
   * canonicalised as before.
   */
  private buildSourceSnippets(sources: TopicSource[], visuals: TutorVisual[]): string[] {
    return sources.map((source) => {
      const coveredByVisual =
        source.pageNumber !== undefined &&
        visuals.some(
          (visual) =>
            visual.documentId === source.documentId && visual.pageNumber === source.pageNumber,
        )

      if (coveredByVisual && looksLikeUnreliableVisualText(source.text)) {
        return `[${source.label}] [Figure preserved as a visual source on page ${source.pageNumber}; the original image is shown to the student. Do not reproduce or reconstruct its text.]`
      }

      return `[${source.label}] ${normalizeMathNotation(source.text).text}`
    })
  }
}
