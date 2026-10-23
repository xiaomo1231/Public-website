import type { AIService } from '@/services/aiService'
import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import type { Document, LearningMaterialType } from '@/entities/document/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import { resolveMaterialType } from '@/entities/document/types'
import { chunksFromPdf, MARKED_ANSWERS_SECTION } from '@/infrastructure/files/chunking'
import { openPdfPageRenderer } from '@/infrastructure/files/pdfExtractor'
import { prompts } from '@/infrastructure/ai/prompts'
import type { PageTranscription } from '@/infrastructure/ai/prompts/page-transcribe/v1'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { bytesToDataUrl, isVisionUnsupportedError } from '@/services/answerImagesAI'
import { GenerationPausedError, type GenerationControl } from '@/shared/lib/generationControl'
import { isAbortError } from '@/shared/lib/generationControl'
import { getUILanguage, t } from '@/i18n'

/**
 * 看图识别: a photographed or scanned page is read by the student's own
 * vision model (`page-transcribe/v1`) instead of local OCR. Local OCR stays
 * the offline fallback: the document is processed with tesseract first, and
 * only then — on request, or automatically for photographed exam / homework
 * pages when the 手写识别方式 setting allows online recognition — the page
 * images are sent to the model and the page's chunks replaced.
 *
 * The replaced chunks stay marked low-confidence (`contentType: 'ocr'`,
 * `layoutWarnings: ['ocr']`) so the proofread page still suggests checking
 * them against the picture. Multiple-choice options the model reports as
 * marked on an answer key become `Answer N: (x)` lines, which the answer
 * linking dialog proposes for the student to confirm — never applied silently.
 */

/** Roles whose photographed pages are read by the vision model by default. */
const AUTO_ROLES: readonly LearningMaterialType[] = ['homework', 'past_exam', 'homework_answer']

export interface PageTranscriptionResult {
  /** Pages whose text was replaced by the model's reading. */
  pages: number[]
  /** Pages the model could not read (their local OCR text is kept). */
  failed: number[]
  /** Marked multiple-choice options read from an answer key. */
  marks: number
}

interface PageImage {
  /** 1-based page; image files are page 1 (their chunks carry no page number). */
  page: number
  bytes: ArrayBuffer
  mimeType: string
}

export class PageTranscriptionService {
  private db: AppDatabase
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private visuals: VisualSourceRepository

  constructor(
    private ai: AIService | null,
    deps: {
      db?: AppDatabase
      model?: string
      /** Renders a PDF page when no stored rendering exists (tests inject a fake). */
      renderPage?: (bytes: ArrayBuffer, page: number) => Promise<PageImage | null>
    } = {},
  ) {
    this.db = deps.db ?? getDb()
    this.documents = new DocumentRepository(this.db)
    this.chunks = new ChunkRepository(this.db)
    this.visuals = new VisualSourceRepository(this.db)
    this.model = deps.model
    this.renderPage = deps.renderPage ?? defaultRender
  }

  private model: string | undefined
  private renderPage: (bytes: ArrayBuffer, page: number) => Promise<PageImage | null>

  /**
   * Pages the vision model can read: an image file's single page, or the
   * pages of a PDF that were recognised from a picture (no text layer).
   */
  async candidates(documentId: string): Promise<number[]> {
    const document = await this.documents.get(documentId)
    if (document.type === 'image') return [1]
    if (document.type !== 'pdf') return []
    const chunks = await this.chunks.listByDocument(documentId)
    return [
      ...new Set(
        chunks
          .filter((chunk) => chunk.contentType === 'ocr' && chunk.pageNumber !== undefined)
          .map((chunk) => chunk.pageNumber!),
      ),
    ].sort((a, b) => a - b)
  }

  async transcribe(
    documentId: string,
    options: { control?: GenerationControl; pages?: number[] } = {},
  ): Promise<PageTranscriptionResult> {
    if (!this.ai) throw new AppError(t('handwritingRecognition.noAI'), 'HANDWRITING_UNAVAILABLE')
    const document = await this.documents.get(documentId)
    const pages = options.pages ?? (await this.candidates(documentId))
    if (pages.length === 0) return { pages: [], failed: [], marks: 0 }
    const role = resolveMaterialType(document.materialType)
    const readings = new Map<number, PageTranscription>()
    const failed: number[] = []
    for (const page of pages) {
      if (options.control && !options.control.shouldContinue()) {
        if (readings.size === 0) throw new GenerationPausedError()
        break
      }
      const image = await this.pageImage(document, page)
      if (!image) {
        failed.push(page)
        continue
      }
      try {
        const reading = await this.read(image, role, options.control?.signal)
        if (reading && !reading.blank) readings.set(page, reading)
        else failed.push(page)
      } catch (err) {
        if (isAbortError(err, options.control?.signal)) throw err
        // A model that cannot read images: nothing more to try.
        if ((err as { code?: unknown })?.code === 'VISION_UNSUPPORTED') throw err
        logger.warn('Vision page transcription failed', { documentId, page })
        failed.push(page)
      }
    }
    const marks = await this.commit(document, readings, role === 'homework_answer')
    return { pages: [...readings.keys()].sort((a, b) => a - b), failed, marks }
  }

  private async read(
    image: PageImage,
    role: LearningMaterialType,
    signal?: AbortSignal,
  ): Promise<PageTranscription | null> {
    const messages = [
      { role: 'system' as const, content: prompts.pageTranscribe.buildSystemPrompt() },
      {
        role: 'user' as const,
        content: prompts.pageTranscribe.buildUserPrompt({
          pageNumber: image.page,
          role:
            role === 'homework_answer'
              ? 'answer_key'
              : role === 'homework' || role === 'past_exam'
                ? 'paper'
                : 'other',
          language: getUILanguage() === 'zh-CN' ? 'zh' : 'en',
        }),
        images: [bytesToDataUrl(image.bytes, image.mimeType)],
      },
    ]
    try {
      const { data } = await this.ai!.chatJSON<unknown>(messages, {
        ...(signal ? { signal } : {}),
        usageKind: 'other',
      })
      return prompts.pageTranscribe.readPageTranscription(data)
    } catch (err) {
      if (!signal?.aborted && isVisionUnsupportedError(err))
        throw new AppError(t('handwritingRecognition.visionUnsupported'), 'VISION_UNSUPPORTED', err)
      throw err
    }
  }

  /** The stored rendering of a page (kept at processing), else a fresh one. */
  private async pageImage(document: Document, page: number): Promise<PageImage | null> {
    if (document.type === 'image') {
      const stored = await this.documents.getBytes(document.id)
      return stored ? { page: 1, bytes: stored.bytes, mimeType: stored.mimeType } : null
    }
    for (const visual of await this.visuals.listByDocumentPage(document.id, page)) {
      if (!visual.imageMimeType) continue
      const blob = await this.visuals.getImage(visual.id)
      if (blob) return { page, bytes: await blob.arrayBuffer(), mimeType: blob.type || 'image/png' }
    }
    const stored = await this.documents.getBytes(document.id)
    return stored ? this.renderPage(stored.bytes, page) : null
  }

  /**
   * Replace the read pages' chunks in one transaction. Other chunks keep
   * their ids; the document order is renumbered. Returns the number of
   * marked answers written.
   */
  private async commit(
    document: Document,
    readings: Map<number, PageTranscription>,
    answerKey: boolean,
  ): Promise<number> {
    if (readings.size === 0) return 0
    const pageKey = (chunk: DocumentChunk) => (document.type === 'image' ? 1 : chunk.pageNumber)
    let marks = 0
    await this.db.transaction('rw', this.db.chunks, this.db.documents, async () => {
      const current = (await this.chunks.listByDocument(document.id)).sort(
        (a, b) => a.order - b.order,
      )
      const replaced = (chunk: DocumentChunk) => {
        const page = pageKey(chunk)
        return page !== undefined && readings.has(page)
      }
      const pages = [...readings.entries()].sort(([a], [b]) => a - b)
      const fresh = chunksFromPdf(
        {
          documentId: document.id,
          projectId: document.projectId,
          documentName: document.name,
          type: document.type,
          ...(document.materialType ? { materialType: document.materialType } : {}),
        },
        pages.map(([page, reading]) => ({
          pageNumber: page,
          text: reading.text,
          headings: [],
          ocr: { confidence: Math.round((reading.confidence ?? 0) * 100) },
          ...(answerKey && reading.marks.length > 0
            ? { markedOptions: reading.marks.map((mark) => ({ ...mark, text: '' })) }
            : {}),
        })),
      ).map((chunk) => {
        if (document.type !== 'image') return chunk
        // An image file has no pages: its chunks carry none, as before.
        const { pageNumber: _page, ...rest } = chunk
        return { ...rest, sourceReference: document.name }
      })
      marks = answerKey ? pages.reduce((sum, [, reading]) => sum + reading.marks.length, 0) : 0
      const prepared = this.chunks
        .prepareMany(fresh)
        .map((chunk) => (document.evalRole ? { ...chunk, evalRole: document.evalRole } : chunk))
      // New page text takes the place of the first chunk it replaces; marked
      // answers go last, after every page (see chunksFromPdf), so no page
      // text is read as part of an answer.
      const answers = prepared.filter((chunk) => chunk.section === MARKED_ANSWERS_SECTION)
      const text = prepared.filter((chunk) => chunk.section !== MARKED_ANSWERS_SECTION)
      const ordered: DocumentChunk[] = []
      let inserted = false
      for (const chunk of current) {
        if (replaced(chunk)) {
          if (!inserted) ordered.push(...text)
          inserted = true
          continue
        }
        ordered.push(chunk)
      }
      if (!inserted) ordered.push(...text)
      ordered.push(...answers)
      const renumbered = ordered.map((chunk, order) => ({ ...chunk, order }))
      await this.db.chunks.bulkDelete(current.filter(replaced).map((chunk) => chunk.id))
      await this.db.chunks.bulkPut(renumbered)
      const pageList = pages.map(([page]) => page)
      await this.documents.update(document.id, {
        chunkCount: renumbered.length,
        warnings: [
          ...(document.warnings ?? []),
          t('errors.visionTranscribed', { pages: pageList.join(', ') }),
          ...(marks > 0 ? [t('errors.markedAnswersFound', { count: marks })] : []),
        ],
        metadata: {
          transcribedPages: pageList,
          ...(this.model ? { transcribedModel: this.model } : {}),
        },
      })
    })
    return marks
  }
}

async function defaultRender(bytes: ArrayBuffer, page: number): Promise<PageImage | null> {
  const renderer = await openPdfPageRenderer(new Blob([bytes], { type: 'application/pdf' }))
  if (!renderer) return null
  try {
    const image = await renderer.render(page, 2)
    return image ? { page, bytes: image.bytes, mimeType: image.mimeType } : null
  } finally {
    await renderer.close()
  }
}

/**
 * Whether a freshly processed document should be read by the vision model
 * straight away: a photographed exam / homework page or answer key, an AI
 * key configured, and 手写识别方式 not set to on-device only.
 */
export function shouldAutoTranscribe(
  document: Pick<Document, 'type' | 'materialType' | 'status'>,
  setup: { hasAI: boolean; mode: 'auto' | 'local' | 'online' | undefined },
): boolean {
  return (
    document.type === 'image' &&
    document.status === 'ready' &&
    setup.hasAI &&
    setup.mode !== 'local' &&
    AUTO_ROLES.includes(resolveMaterialType(document.materialType))
  )
}

/**
 * After an upload: read a photographed exam / homework page with the vision
 * model when the settings allow it. Never throws — the local OCR text stays
 * when anything fails (the reason is logged).
 */
export async function autoTranscribeAfterUpload(documentId: string): Promise<void> {
  try {
    const [{ SettingsService }, { UserRepository }, { AIService }] = await Promise.all([
      import('@/services/settingsService'),
      import('@/entities/user/repository'),
      import('@/services/aiService'),
    ])
    const document = await new DocumentRepository().get(documentId)
    const settings = await new SettingsService().get()
    const profile = await new UserRepository().get()
    const hasAI = !!settings.apiKey.trim()
    if (!shouldAutoTranscribe(document, { hasAI, mode: profile.handwritingRecognition })) return
    const ai = new AIService({ config: settings, usageKind: 'other' })
    await new PageTranscriptionService(ai, { model: settings.model }).transcribe(documentId)
  } catch (err) {
    logger.warn('Automatic vision transcription skipped', {
      documentId,
      error: (err as { code?: string })?.code ?? (err as Error)?.message,
    })
  }
}
