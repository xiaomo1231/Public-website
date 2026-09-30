import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { SlideLessonRepository } from '@/entities/slideLesson/repository'
import {
  SLIDE_LESSON_VERSION,
  SLIDE_MAX_SOURCE_CHUNKS,
  SLIDE_MESSAGE_LIMIT,
  slideLessonKeyString,
  type SlideLesson,
  type SlideLessonKey,
  type SlideMessage,
} from '@/entities/slideLesson/types'
import { computeSlideContentHash } from '@/entities/slideLesson/contentHash'
import type { TutorVisual } from '@/entities/tutorLesson/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { Document } from '@/entities/document/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { asRecord, asTrimmedString } from '@/infrastructure/ai/validation'
import { extractSymbolsFromMarkdown } from '@/shared/lib/latexSymbols'
import { normalizeExtractedText } from '@/infrastructure/files/textEncoding'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { t } from '@/i18n'
import { logger } from '@/infrastructure/logger/logger'
import type { AIService } from './aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

/** How many previous Q&A turns are sent back to the model. */
const CHAT_HISTORY_TURNS = 8
/** A short slide borrows the previous slide for context. */
const NEIGHBOR_TEXT_THRESHOLD = 60

/** Coalesce concurrent generations of the same slide lesson. */
const inFlight = new Map<string, Promise<SlideLessonResult>>()

export interface SlideDocumentInfo {
  document: Document
  /** Slides the document declares / chunks it carries. */
  slideCount: number
  /** True when the file finished processing and can be studied. */
  ready: boolean
}

export interface SlideIndexEntry {
  slideNumber: number
  chunkCount: number
  hasText: boolean
  hasImage: boolean
  title?: string
}

export interface SlideIndex {
  document: Document
  slideTotal: number
  slides: SlideIndexEntry[]
}

export interface SlideBlock {
  contentType: DocumentChunk['contentType']
  text: string
}

export interface SlideContent {
  document: Document
  slideNumber: number
  slideTotal: number
  title?: string
  /** Body text (paragraphs, tables, formulas) as plain text. */
  text: string
  /** Speaker notes for this slide. */
  notes: string
  /** The slide's own blocks, in order, for rendering. */
  blocks: SlideBlock[]
  /** Labelled material exactly as it is sent to the model. */
  material: string
  chunkIds: string[]
  visuals: TutorVisual[]
}

export interface SlideLessonResult {
  lesson: SlideLesson
  fromCache: boolean
  /** Actionable reason when a refresh/generation failed but a lesson is shown. */
  error?: string
}

export interface GenerateSlideLessonInput extends SlideLessonKey {
  signal?: AbortSignal
}

/**
 * Learn-by-slide.
 *
 * A presentation's slides are already extracted as chunks (`pageNumber` is the
 * slide number, `contentType` marks headings / notes / tables). This service
 * turns one slide into a cached explanation with one guiding question, plus a
 * free-form Q&A thread. Generation is cache-first and only ever runs from a
 * slide's own material (plus, at most, one clearly-labelled adjacent slide) —
 * never the whole deck.
 */
export class SlideLessonService {
  private db: AppDatabase
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private visuals: VisualSourceRepository
  private lessons: SlideLessonRepository
  private ai: AIService | null

  constructor(deps: {
    ai: AIService | null
    db?: AppDatabase
    documents?: DocumentRepository
    chunks?: ChunkRepository
    visuals?: VisualSourceRepository
    lessons?: SlideLessonRepository
  }) {
    this.db = deps.db ?? getDb()
    this.documents = deps.documents ?? new DocumentRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.visuals = deps.visuals ?? new VisualSourceRepository(this.db)
    this.lessons = deps.lessons ?? new SlideLessonRepository(this.db)
    this.ai = deps.ai
  }

  /** Presentations in this project, with a study-ready flag. */
  async listSlideDocuments(projectId: string): Promise<SlideDocumentInfo[]> {
    const documents = await this.documents.listByProject(projectId)
    const presentations = documents.filter((document) => document.type === 'pptx')
    const out: SlideDocumentInfo[] = []
    for (const document of presentations) {
      let slideCount = document.metadata.slideCount ?? 0
      if (slideCount === 0) {
        const chunks = await this.chunks.listByDocument(document.id)
        slideCount = countSlides(chunks)
      }
      out.push({ document, slideCount, ready: document.status === 'ready' })
    }
    return out
  }

  /** The slide list (table of contents) for one document. */
  async buildIndex(documentId: string): Promise<SlideIndex> {
    const document = await this.getDocument(documentId)
    const chunks = (await this.chunks.listByDocument(documentId)).slice().sort((a, b) => a.order - b.order)
    const visuals = await this.visuals.listByDocument(documentId)
    const imagePages = new Set(visuals.map((visual) => visual.pageNumber))

    const bySlide = new Map<number, DocumentChunk[]>()
    for (const chunk of chunks) {
      if (chunk.pageNumber === undefined) continue
      const list = bySlide.get(chunk.pageNumber) ?? []
      list.push(chunk)
      bySlide.set(chunk.pageNumber, list)
    }

    const declared = document.metadata.slideCount ?? 0
    const numbers = new Set<number>([...bySlide.keys(), ...imagePages])
    if (declared > 0) for (let n = 1; n <= declared; n += 1) numbers.add(n)
    const sorted = [...numbers].sort((a, b) => a - b)
    const slideTotal = declared > 0 ? declared : (sorted[sorted.length - 1] ?? 0)

    const slides: SlideIndexEntry[] = sorted.map((slideNumber) => {
      const slideChunks = bySlide.get(slideNumber) ?? []
      const hasText = slideChunks.some((chunk) => chunk.text.trim().length > 0)
      const heading = slideChunks.find((chunk) => chunk.contentType === 'heading')
      const entry: SlideIndexEntry = {
        slideNumber,
        chunkCount: slideChunks.length,
        hasText,
        hasImage: imagePages.has(slideNumber),
      }
      const title = heading?.text.trim() ?? slideChunks[0]?.section?.trim()
      if (title) entry.title = title
      return entry
    })

    return { document, slideTotal, slides }
  }

  /** The material for one slide, grounded in its real chunks. */
  async getSlideContent(documentId: string, slideNumber: number): Promise<SlideContent> {
    const document = await this.getDocument(documentId)
    const all = await this.chunks.listByDocument(documentId)
    const chunks = all
      .filter((chunk) => chunk.pageNumber === slideNumber)
      .sort((a, b) => a.order - b.order)
      .slice(0, SLIDE_MAX_SOURCE_CHUNKS)
    const visuals = await this.visuals.listByDocumentPage(documentId, slideNumber)
    const { title, text, notes, material } = buildSlideMaterial(chunks)
    const slideTotal = document.metadata.slideCount ?? countSlides(all)

    const content: SlideContent = {
      document,
      slideNumber,
      slideTotal,
      text,
      notes,
      blocks: chunks
        .filter((chunk) => chunk.text.trim().length > 0)
        .map((chunk) => ({ contentType: chunk.contentType, text: chunk.text.trim() })),
      material,
      chunkIds: chunks.map((chunk) => chunk.id),
      visuals: visuals.map(toTutorVisual),
    }
    if (title) content.title = title
    return content
  }

  /** Any stored lesson for a slide + language, ignoring freshness. */
  getLesson(key: SlideLessonKey): Promise<SlideLesson | undefined> {
    return this.lessons.find(key)
  }

  listLessons(documentId: string): Promise<SlideLesson[]> {
    return this.lessons.listByDocument(documentId)
  }

  /**
   * The slide the student last studied in this document, for "resume".
   * Derived from the stored lessons, so mere browsing persists nothing.
   */
  async resumeSlideNumber(documentId: string): Promise<number | undefined> {
    const rows = await this.lessons.listByDocument(documentId)
    const studied = rows.filter(
      (row) => (row.content ?? '').trim().length > 0 || row.messages.length > 0,
    )
    const pool = studied.length > 0 ? studied : rows
    if (pool.length === 0) return undefined
    return [...pool].sort((a, b) => b.updatedAt - a.updatedAt)[0]!.slideNumber
  }

  /**
   * Return the cached lesson when it is still valid, otherwise generate one.
   * Concurrent calls for the same slide share a single request.
   */
  generate(input: GenerateSlideLessonInput): Promise<SlideLessonResult> {
    const runKey = slideLessonKeyString(input)
    const existing = inFlight.get(runKey)
    if (existing) return existing
    const run = this.resolveGenerate(input).finally(() => inFlight.delete(runKey))
    inFlight.set(runKey, run)
    return run
  }

  /** Force a fresh generation, replacing stored content but keeping the Q&A. */
  regenerate(input: GenerateSlideLessonInput): Promise<SlideLessonResult> {
    return this.resolveGenerate(input, true)
  }

  /** One follow-up question answered against this slide. */
  async ask(lessonId: string, message: string): Promise<SlideLesson> {
    const lesson = await this.lessons.get(lessonId)
    if (!lesson) throw new NotFoundError('SlideLesson', lessonId)
    const trimmed = message.trim()
    if (!trimmed) throw new AppError(t('slides.emptyMessage'), 'INVALID_INPUT')
    if (!(lesson.content ?? '').trim()) throw new AppError(t('slides.notGenerated'), 'SLIDE_EMPTY')

    const content = await this.getSlideContent(lesson.documentId, lesson.slideNumber)
    const history = lesson.messages.slice(-CHAT_HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      content: turn.content,
    }))
    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.slideLesson.buildQaSystemPrompt() },
      {
        role: 'user',
        content: prompts.slideLesson.buildQaUserPrompt({
          documentName: lesson.documentName,
          slideNumber: lesson.slideNumber,
          language: lesson.language,
          slideMaterial: content.material,
          explanation: lesson.content ?? '',
          history,
          message: trimmed,
        }),
      },
    ]
    const reply = await this.requireAI().chat(messages)
    const answer = normalizeMathNotation(normalizeExtractedText(reply.content ?? '')).text.trim()
    if (!answer) throw new AppError(t('slides.emptyReply'), 'EMPTY_TUTOR_RESPONSE')

    const now = Date.now()
    const student: SlideMessage = { id: crypto.randomUUID(), role: 'student', content: trimmed, createdAt: now }
    const assistant: SlideMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: answer,
      createdAt: now + 1,
    }
    // Merge from the latest row so a concurrent write cannot drop turns.
    const latest = (await this.lessons.get(lessonId)) ?? lesson
    const next = [...latest.messages, student, assistant].slice(-SLIDE_MESSAGE_LIMIT)
    return (await this.lessons.update(lessonId, { messages: next })) ?? lesson
  }

  // -------------------------------------------------------------------------

  private async resolveGenerate(
    input: GenerateSlideLessonInput,
    force = false,
  ): Promise<SlideLessonResult> {
    const content = await this.getSlideContent(input.documentId, input.slideNumber)
    if (isEmptySlide(content)) {
      throw new AppError(t('slides.emptySlide'), 'SLIDE_EMPTY')
    }

    const promptVersion = prompts.slideLesson.VERSION
    const hasImage = content.visuals.length > 0
    const contentHash = computeSlideContentHash({
      material: content.material,
      promptVersion,
      language: input.language,
      hasImage,
    })
    const stored = await this.lessons.find(input)
    if (
      !force &&
      stored &&
      stored.version === SLIDE_LESSON_VERSION &&
      stored.status === 'ready' &&
      stored.contentHash === contentHash &&
      stored.promptVersion === promptVersion &&
      (stored.content ?? '').trim().length > 0
    ) {
      return { lesson: stored, fromCache: true }
    }

    try {
      return await this.runGenerate(input, content, contentHash, promptVersion)
    } catch (err) {
      if (stored && stored.status === 'ready' && (stored.content ?? '').trim().length > 0) {
        return {
          lesson: stored,
          fromCache: true,
          error: friendlyAIError(err),
        }
      }
      const failed = await this.storeFailure(input, err, content, contentHash, promptVersion)
      return { lesson: failed, fromCache: false, error: friendlyAIError(err) }
    }
  }

  private async runGenerate(
    input: GenerateSlideLessonInput,
    contentIn?: SlideContent,
    contentHashIn?: string,
    promptVersionIn?: string,
  ): Promise<SlideLessonResult> {
    const content = contentIn ?? (await this.getSlideContent(input.documentId, input.slideNumber))
    if (isEmptySlide(content)) throw new AppError(t('slides.emptySlide'), 'SLIDE_EMPTY')
    const promptVersion = promptVersionIn ?? prompts.slideLesson.VERSION
    const hasImage = content.visuals.length > 0
    const contentHash =
      contentHashIn ??
      computeSlideContentHash({
        material: content.material,
        promptVersion,
        language: input.language,
        hasImage,
      })

    const ai = this.requireAI()
    const neighbors = await this.buildNeighborSlides(content)
    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.slideLesson.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.slideLesson.buildUserPrompt({
          documentName: content.document.name,
          slideNumber: content.slideNumber,
          slideTotal: content.slideTotal,
          language: input.language,
          slideMaterial: content.material,
          ...(neighbors.length > 0 ? { neighborSlides: neighbors } : {}),
          ...(hasImage ? { hasImage: true } : {}),
        }),
      },
    ]

    const { data, raw } = await ai.chatJSON<unknown>(messages, {
      ...(input.signal ? { signal: input.signal } : {}),
    })
    const normalized = normalizeSlideLessonOutput(data)
    const explanation = normalizeMathNotation(normalizeExtractedText(normalized.explanation)).text.trim()
    const question = normalizeMathNotation(normalizeExtractedText(normalized.question)).text.trim()
    if (!explanation || !question) {
      throw new AppError(t('slides.incompleteResponse'), 'INVALID_RESPONSE')
    }

    const stored = await this.lessons.find(input)
    const now = Date.now()
    const lesson: SlideLesson = {
      id: stored?.id ?? crypto.randomUUID(),
      projectId: input.projectId,
      documentId: input.documentId,
      documentName: content.document.name,
      slideNumber: input.slideNumber,
      slideTotal: content.slideTotal,
      language: input.language,
      status: 'ready',
      content: explanation,
      question,
      symbols: extractSymbolsFromMarkdown(explanation),
      ...(content.visuals.length > 0 ? { visuals: content.visuals } : {}),
      sourceChunkIds: content.chunkIds,
      sourceRefs: buildSourceRefs(content),
      messages: stored?.messages ?? [],
      contentHash,
      promptVersion,
      ...(raw.model ? { model: raw.model } : {}),
      generatedAt: now,
      createdAt: stored?.createdAt ?? now,
      updatedAt: now,
      version: SLIDE_LESSON_VERSION,
    }
    await this.lessons.upsert(lesson)
    logger.debug('Slide lesson stored', {
      documentId: input.documentId,
      slideNumber: input.slideNumber,
      language: input.language,
      chars: explanation.length,
    })
    return { lesson, fromCache: false }
  }

  private async storeFailure(
    input: GenerateSlideLessonInput,
    err: unknown,
    content: SlideContent,
    contentHash: string,
    promptVersion: string,
  ): Promise<SlideLesson> {
    const stored = await this.lessons.find(input)
    const now = Date.now()
    const failed: SlideLesson = {
      id: stored?.id ?? crypto.randomUUID(),
      projectId: input.projectId,
      documentId: input.documentId,
      documentName: content.document.name,
      slideNumber: input.slideNumber,
      slideTotal: content.slideTotal,
      language: input.language,
      status: 'failed',
      ...(stored?.content ? { content: stored.content } : {}),
      ...(stored?.question ? { question: stored.question } : {}),
      symbols: stored?.symbols ?? [],
      ...(content.visuals.length > 0 ? { visuals: content.visuals } : {}),
      sourceChunkIds: content.chunkIds,
      sourceRefs: buildSourceRefs(content),
      messages: stored?.messages ?? [],
      errorMessage: friendlyAIError(err),
      contentHash,
      promptVersion,
      createdAt: stored?.createdAt ?? now,
      updatedAt: now,
      version: SLIDE_LESSON_VERSION,
    }
    await this.lessons.upsert(failed)
    return failed
  }

  /**
   * A very short slide (a title slide, or "continued") may need the previous
   * slide to make sense. We include at most that one, explicitly labelled, so
   * the request stays about the current page.
   */
  private async buildNeighborSlides(
    content: SlideContent,
  ): Promise<Array<{ slideNumber: number; text: string; purpose: string }>> {
    if (content.slideNumber <= 1) return []
    if (content.text.trim().length >= NEIGHBOR_TEXT_THRESHOLD) return []
    const previous = await this.getSlideContent(content.document.id, content.slideNumber - 1)
    if (!previous.material.trim() || previous.visuals.length > 0) return []
    return [
      {
        slideNumber: previous.slideNumber,
        text: previous.material,
        purpose: 'previous slide; may define a term this slide uses — context only',
      },
    ]
  }

  private getDocument(id: string): Promise<Document> {
    return this.documents.get(id)
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('slides.noProvider'), 'NO_PROVIDER')
    return this.ai
  }
}

function countSlides(chunks: readonly DocumentChunk[]): number {
  let max = 0
  for (const chunk of chunks) {
    if (typeof chunk.pageNumber === 'number' && chunk.pageNumber > max) max = chunk.pageNumber
  }
  return max
}

/** True when the slide has nothing an explanation could be grounded in. */
function isEmptySlide(content: SlideContent): boolean {
  return (
    content.text.trim().length === 0 &&
    content.notes.trim().length === 0 &&
    content.chunkIds.length === 0 &&
    content.visuals.length === 0
  )
}

/**
 * Build the labelled material for one slide from its real chunks.
 *
 * Only chunks that exist in the database are used, and the speaker notes are
 * kept distinct so the model can tell what the student sees from what the
 * presenter said.
 */
export function buildSlideMaterial(chunks: readonly DocumentChunk[]): {
  title?: string
  text: string
  notes: string
  material: string
} {
  const ordered = [...chunks].sort((a, b) => a.order - b.order)
  const titleChunks = ordered.filter((chunk) => chunk.contentType === 'heading' && chunk.text.trim())
  const noteChunks = ordered.filter((chunk) => chunk.contentType === 'note' && chunk.text.trim())
  const bodyChunks = ordered.filter(
    (chunk) => chunk.contentType !== 'heading' && chunk.contentType !== 'note' && chunk.text.trim(),
  )

  const title = titleChunks
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  const text = bodyChunks.map((chunk) => chunk.text.trim()).join('\n\n').trim()
  const notes = noteChunks.map((chunk) => chunk.text.trim()).join('\n\n').trim()

  const lines: string[] = []
  if (title) lines.push(`Title: ${title}`)
  for (const chunk of bodyChunks) {
    const label =
      chunk.contentType === 'table'
        ? 'Table'
        : chunk.contentType === 'formula'
          ? 'Formula'
          : chunk.contentType === 'list'
            ? 'List'
            : 'Content'
    lines.push(`${label}: ${chunk.text.trim()}`)
  }
  if (notes) lines.push(`Speaker notes: ${notes}`)

  return {
    ...(title ? { title } : {}),
    text,
    notes,
    material: lines.join('\n'),
  }
}

/** Validate the model's structured slide output. Throws on an unusable shape. */
export function normalizeSlideLessonOutput(raw: unknown): { explanation: string; question: string } {
  const record = asRecord(raw)
  const explanation = asTrimmedString(record?.explanation)
  const question = asTrimmedString(record?.question)
  if (!explanation || !question) {
    throw new AppError(t('slides.incompleteResponse'), 'INVALID_RESPONSE')
  }
  return { explanation, question }
}

function toTutorVisual(visual: {
  id: string
  documentId: string
  pageNumber: number
  type: TutorVisual['type']
  caption: string
  imageMimeType: string
}): TutorVisual {
  return {
    id: visual.id,
    documentId: visual.documentId,
    pageNumber: visual.pageNumber,
    type: visual.type,
    caption: visual.caption,
    hasImage: visual.imageMimeType.length > 0,
  }
}

/**
 * Real, verifiable citations for the slide (never invented).
 *
 * The slide's full text is shown separately, so one compact citation is enough
 * for the UI — but it always carries a real chunk id from this slide, so the
 * source can be checked against the stored chunk.
 */
function buildSourceRefs(content: SlideContent): SourceReference[] {
  const firstId = content.chunkIds[0]
  if (!firstId) return []
  const ref: SourceReference = {
    documentId: content.document.id,
    documentName: content.document.name,
    page: content.slideNumber,
    quote: (content.text || content.notes).trim().slice(0, 240),
    chunkId: firstId,
  }
  if (content.title) ref.section = content.title
  return [ref]
}
