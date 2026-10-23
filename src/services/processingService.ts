import type { DocumentRepository } from '@/entities/document/repository'
import type { ChunkRepository } from '@/entities/chunk/repository'
import type { ProcessingJobRepository } from '@/entities/processingJob/repository'
import type { ProjectService } from './projectService'
import { resolveMaterialType, type Document, type DocumentType } from '@/entities/document/types'
import { localSyllabus } from '@/entities/syllabus/parse'
import { CourseStructureService, type PreparedStructure } from './courseStructureService'
import type { DocumentChunk, NewChunkInput } from '@/entities/chunk/types'
import type { VisualSource } from '@/entities/visualSource/types'
import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import {
  fallbackVisualCaption,
  slideVisualCaption,
  textlessPageCaption,
  unsupportedSlideVisualCaption,
} from '@/entities/visualSource/types'
import {
  classifyVisualType,
  looksLikeUnreliableVisualText,
} from '@/infrastructure/files/visualDetection'
import {
  extractPdf,
  openPdfPageRenderer,
  type ExtractedPage as ExtractedPdfPage,
  type RenderedPageImage,
} from '@/infrastructure/files/pdfExtractor'
import { extractDocx } from '@/infrastructure/files/docxExtractor'
import {
  extractPptx,
  extractPptxSlideImages,
  type PptxSlideImage,
} from '@/infrastructure/files/pptxExtractor'
import { extractOcr, extractOcrPages, hasCjk } from '@/infrastructure/files/ocrExtractor'
import {
  chunksFromDocx,
  chunksFromOcr,
  chunksFromPdf,
  chunksFromPptx,
  chunksFromText,
} from '@/infrastructure/files/chunking'
import {
  detectSuspiciousUnicode,
  normalizeExtractedText,
  type SuspiciousUnicodeReport,
} from '@/infrastructure/files/textEncoding'
import { foldMathAlphanumerics } from '@/infrastructure/files/fontGlyphs'
import { needsVisualProofread } from '@/entities/chunk/layoutWarnings'
import { logger } from '@/infrastructure/logger/logger'
import { isQuotaError } from '@/infrastructure/files/storageSpace'
import { AppError, ValidationError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

export interface ProcessingProgress {
  stage: 'extracting' | 'chunking' | 'indexing' | 'done' | 'failed'
  progress: number
  message?: string
}

export type ProgressListener = (progress: ProcessingProgress) => void

export interface ProcessingServiceOptions {
  onProgress?: ProgressListener
}

export interface PageImageRenderInput {
  documentId: string
  projectId: string
  type: DocumentType
  bytes: ArrayBuffer
  mimeType: string
  pageNumber: number
}

/** Renders one page to an image. Injected so tests can supply a fake. */
export type PageImageRenderer = (input: PageImageRenderInput) => Promise<RenderedPageImage | null>

interface PreparedVisualSource {
  source: VisualSource
  image?: RenderedPageImage
}

/**
 * Renders the pages of one file. The default implementation parses the PDF
 * once for all of its figure pages instead of once per page.
 */
export interface PageImageRenderSession {
  render(pageNumber: number): Promise<RenderedPageImage | null>
  close(): Promise<void>
}

export type PageImageRenderSessionOpener = (
  input: Omit<PageImageRenderInput, 'pageNumber'>,
) => Promise<PageImageRenderSession | null>

const defaultPageImageSessionOpener: PageImageRenderSessionOpener = async (input) => {
  if (input.type !== 'pdf') return null
  const renderer = await openPdfPageRenderer(new Blob([input.bytes], { type: input.mimeType }))
  if (!renderer) return null
  return {
    render: (pageNumber) => renderer.render(pageNumber, 2),
    close: () => renderer.close(),
  }
}

/** Adapts an injected per-page renderer (tests) to the session shape. */
function sessionFromPageRenderer(render: PageImageRenderer): PageImageRenderSessionOpener {
  return async (input) => ({
    render: (pageNumber) => render({ ...input, pageNumber }),
    close: async () => undefined,
  })
}

/** A page whose extracted text is shorter than this is treated as figure-dominant. */
const FIGURE_PAGE_MAX_CHARS = 40

/**
 * A PDF page with fewer extractable characters than this has no usable text
 * layer (a scan, or glyphs drawn as vector paths): it is rendered and read
 * with OCR instead.
 */
const TEXTLESS_PAGE_MAX_CHARS = 15

/** OCR of several page images; injected so tests can supply a fake. */
export type PageOcr = (
  blobs: readonly Blob[],
  opts: { preferChinese?: boolean },
) => Promise<Array<{ text: string; confidence: number } | null>>

/** Sentinel: the document vanished before its results were committed. */
class DocumentDeletedDuringProcessing extends AppError {
  constructor() {
    super('Document was deleted during processing', 'DOCUMENT_DELETED')
  }
}

export class ProcessingService {
  private db: AppDatabase
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private jobs: ProcessingJobRepository
  private projects: ProjectService
  private visuals: VisualSourceRepository
  private openPageImages: PageImageRenderSessionOpener
  private structure: CourseStructureService
  private ocrPages: PageOcr

  constructor(deps: {
    documents: DocumentRepository
    chunks: ChunkRepository
    jobs: ProcessingJobRepository
    projects: ProjectService
    visuals?: VisualSourceRepository
    renderPageImage?: PageImageRenderer
    openPageImages?: PageImageRenderSessionOpener
    structure?: CourseStructureService
    ocrPages?: PageOcr
    db?: AppDatabase
  }) {
    this.ocrPages = deps.ocrPages ?? ((blobs, opts) => extractOcrPages(blobs, opts))
    this.db = deps.db ?? getDb()
    this.documents = deps.documents
    this.chunks = deps.chunks
    this.jobs = deps.jobs
    this.projects = deps.projects
    this.visuals = deps.visuals ?? new VisualSourceRepository()
    this.openPageImages =
      deps.openPageImages ??
      (deps.renderPageImage
        ? sessionFromPageRenderer(deps.renderPageImage)
        : defaultPageImageSessionOpener)
    this.structure = deps.structure ?? new CourseStructureService()
  }

  async process(documentId: string, options: ProcessingServiceOptions = {}): Promise<void> {
    const document = await this.documents.get(documentId)
    await this.projects.get(document.projectId) // ensure project exists
    const job = await this.jobs.create(documentId, document.projectId)
    await this.documents.update(documentId, { status: 'processing', errorMessage: undefined })
    await this.run(document, job.id, options)
  }

  private async run(
    document: Document,
    jobId: string,
    options: ProcessingServiceOptions,
  ): Promise<void> {
    const { onProgress } = options
    try {
      onProgress?.({ stage: 'extracting', progress: 5 })
      await this.jobs.setStage(jobId, 'extracting', 5)
      const extraction = await this.extract(document)
      onProgress?.({ stage: 'chunking', progress: 50 })
      await this.jobs.setStage(jobId, 'chunking', 50)

      const { chunks: newChunks, report } = this.normalizeChunks(
        await this.chunk(document, extraction),
      )
      onProgress?.({ stage: 'indexing', progress: 80 })
      await this.jobs.setStage(jobId, 'indexing', 80)

      // Detect the textbook's own chapter/section hierarchy and bind every
      // chunk to it *before* storing, so retrieval can respect chapter
      // boundaries. Notes / transcripts / practice have no course structure.
      let prepared: PreparedStructure | null = null
      if (resolveMaterialType(document.materialType) === 'textbook') {
        try {
          prepared = await this.structure.prepare({
            projectId: document.projectId,
            documentId: document.id,
            documentName: document.name,
            chunks: newChunks.map((chunk) => ({
              text: chunk.text,
              contentType: chunk.contentType,
              ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
            })),
          })
          prepared.assignments.forEach((ref, index) => {
            if (ref) Object.assign(newChunks[index]!, ref)
          })
        } catch (err) {
          if (document.status === 'ready') throw err
          logger.warn('Course structure detection failed', {
            id: document.id,
            error: (err as Error)?.message,
          })
        }
      }

      // A held-out / evaluation role is denormalised onto the chunks.
      const storedChunks = this.chunks
        .prepareMany(newChunks)
        .map((chunk) => (document.evalRole ? { ...chunk, evalRole: document.evalRole } : chunk))

      // A syllabus: read its exam topics from the stored chunks (local parser
      // only; the AI fallback is the student's choice). A list the student
      // edited is kept as it is.
      const syllabus =
        resolveMaterialType(document.materialType) === 'syllabus' && !document.syllabus?.editedAt
          ? localSyllabus(
              storedChunks.map((chunk) => ({
                id: chunk.id,
                text: chunk.text,
                contentType: chunk.contentType,
                ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
              })),
            )
          : undefined

      // New documents tolerate a figure-rendering failure. Re-processing
      // keeps the previous complete result when figure preparation fails.
      let visualSources: PreparedVisualSource[] = []
      try {
        visualSources = await this.prepareVisualSources(document, extraction, storedChunks)
      } catch (err) {
        if (document.status === 'ready') throw err
        logger.warn('Visual source preservation failed', {
          id: document.id,
          error: (err as Error)?.message,
        })
      }

      const warnings = (extraction.warnings ?? []).slice()
      if (extraction.lowConfidence)
        warnings.push(t('errors.ocrLowConfidence', { value: `${extraction.confidence}%` }))
      if (extraction.handwriting) warnings.push(t('errors.ocrHandwriting'))
      // Fractions / tables / exponents kept as raw text: suggest checking the page.
      // (OCR pages are reported once, as pages without a text layer.)
      const uncertainLayout = newChunks.filter(
        (chunk) => chunk.contentType !== 'ocr' && needsVisualProofread(chunk),
      ).length
      if (uncertainLayout > 0)
        warnings.push(t('errors.layoutUncertain', { count: uncertainLayout }))
      if (report.suspicious) {
        // Characters we cannot decode are kept, never guessed at — the user is
        // told the source PDF's font encoding is the problem instead.
        const undecodable = report.privateUse + report.replacement + report.control
        warnings.push(t('errors.undecodableCharacters', { count: undecodable }))
        // Safe diagnostics: counts and code points only, never document text.
        logger.warn('Extracted text contains undecodable characters', {
          id: document.id,
          type: document.type,
          privateUse: report.privateUse,
          replacement: report.replacement,
          control: report.control,
          questionRuns: report.questionRuns,
          missingGlyphBox: report.missingGlyphBox,
          codePoints: report.codePoints.map(
            (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
          ),
        })
      }
      await this.db.transaction(
        'rw',
        [
          this.db.chunks,
          this.db.courseStructures,
          this.db.courseStructureNodes,
          this.db.visualSources,
          this.db.visualSourceImages,
          this.db.documents,
          this.db.processingJobs,
        ],
        async () => {
          // The document may have been deleted while it was being extracted.
          // Writing now would leave orphan chunks / figures / structure behind.
          if (!(await this.db.documents.get(document.id)))
            throw new DocumentDeletedDuringProcessing()
          await this.chunks.deleteByDocument(document.id)
          await this.chunks.addPrepared(storedChunks)
          if (prepared) {
            await this.structure.persist(
              prepared,
              storedChunks.map((chunk) => chunk.id),
            )
          }
          await this.visuals.deleteByDocument(document.id)
          for (const { source, image } of visualSources) {
            await this.visuals.upsert(source)
            if (image) await this.visuals.putImage(source, image.bytes, image.mimeType)
          }
          await this.documents.update(document.id, {
            status: 'ready',
            errorMessage: '',
            warnings,
            textLength: extraction.textLength,
            chunkCount: newChunks.length,
            processedAt: Date.now(),
            // Re-processing replaces any vision-model reading with local text.
            metadata: {
              ...extraction.metadata,
              transcribedPages: undefined,
              transcribedModel: undefined,
            },
            ...(syllabus ? { syllabus } : {}),
          })
          await this.jobs.setStage(jobId, 'done', 100)
        },
      )

      onProgress?.({ stage: 'done', progress: 100 })
      logger.info('Document processed', { id: document.id, chunks: newChunks.length })
    } catch (err) {
      if (err instanceof DocumentDeletedDuringProcessing) {
        // Nothing was written (the transaction aborted); there is no document
        // left to mark as failed.
        logger.info('Document deleted during processing; results discarded', { id: document.id })
        await this.jobs
          .update(jobId, {
            stage: 'failed',
            progress: 100,
            errorMessage: err.message,
            finishedAt: Date.now(),
          })
          .catch(() => undefined)
        return
      }
      // The commit is one transaction, so a full quota leaves the previous
      // chunks in place; tell the user what to do instead of a raw DOM error.
      const quotaFull = isQuotaError(err)
      const message = quotaFull
        ? t('errors.storageFullProcessing')
        : err instanceof Error
          ? err.message
          : t('upload.processingFailed')
      logger.error('Document processing failed', { id: document.id }, err)
      await this.documents.update(document.id, {
        status: document.status === 'ready' ? 'ready' : 'failed',
        errorMessage: message,
      })
      await this.jobs.update(jobId, {
        stage: 'failed',
        progress: 100,
        errorMessage: message,
        finishedAt: Date.now(),
      })
      if (quotaFull) throw new ValidationError(message)
      throw err instanceof AppError ? err : new AppError(message, 'PROCESSING_FAILED', err)
    }
  }

  private async extract(document: Document): Promise<ExtractionOutput> {
    const stored = await this.documents.getBytes(document.id)
    if (!stored) throw new ValidationError(t('errors.documentContentMissing'))
    const blob = new Blob([stored.bytes], { type: stored.mimeType })

    if (document.type === 'text') {
      const text = new TextDecoder().decode(new Uint8Array(stored.bytes))
      return {
        textLength: text.length,
        metadata: { language: 'unknown' },
        warnings: [],
        raw: { text },
      }
    }

    switch (document.type) {
      case 'pdf': {
        const result = await extractPdf(blob)
        const ocr = await this.ocrTextlessPages(document, stored, result.pages)
        const warnings = result.warnings.slice()
        if (ocr.pages.length > 0)
          warnings.push(t('errors.noTextLayerOcr', { pages: ocr.pages.join(', ') }))
        const marked = result.pages.flatMap((page) => page.markedOptions ?? [])
        const ambiguous = result.pages.flatMap((page) => page.ambiguousMarks ?? [])
        if (marked.length > 0)
          warnings.push(t('errors.markedAnswersFound', { count: marked.length }))
        if (ambiguous.length > 0)
          warnings.push(t('errors.markedAnswersAmbiguous', { questions: ambiguous.join(', ') }))
        const textLength = result.pages.reduce((sum, page) => sum + page.text.length, 0)
        return {
          textLength,
          metadata: result.metadata,
          warnings,
          raw: { pages: result.pages },
          ...(ocr.images.size > 0 ? { ocrImages: ocr.images } : {}),
          ...(ocr.lowConfidence ? { lowConfidence: true, confidence: ocr.confidence } : {}),
        }
      }
      case 'docx': {
        const result = await extractDocx(blob)
        return {
          textLength: result.textLength,
          metadata: { title: result.metadata.title, author: result.metadata.author },
          warnings: result.warnings,
          raw: { blocks: result.blocks },
        }
      }
      case 'pptx': {
        const result = await extractPptx(blob)
        return {
          textLength: result.textLength,
          metadata: {
            title: result.metadata.title,
            author: result.metadata.author,
            slideCount: result.slideCount,
          },
          warnings: result.warnings,
          raw: { slides: result.slides },
        }
      }
      case 'image': {
        const result = await extractOcr(blob, {
          preferChinese: await this.prefersChineseOcr(document),
          // Photos of pages: shadows are divided out for a second pass when
          // the first is not confident (the more confident one is kept).
          normalizeLighting: true,
        })
        return {
          textLength: result.text.length,
          metadata: { language: result.language, ocrConfidence: result.confidence },
          warnings: result.warnings,
          raw: { ocr: result },
          lowConfidence: result.confidence < 60,
          confidence: result.confidence,
          ...(result.handwriting ? { handwriting: true } : {}),
        }
      }
      default: {
        const exhaustive: never = document.type
        throw new ValidationError(t('errors.unsupportedType', { type: exhaustive as string }))
      }
    }
  }

  /**
   * Pages without a usable text layer (scans, or glyphs drawn as vector
   * paths — some exam PDFs have no text at all) are rendered and read with
   * local OCR. The page text is replaced by the OCR text, the page is marked
   * (`ocr`), and the rendering is kept to be stored as the page's original
   * picture. Without a canvas (tests, old browsers) nothing changes.
   */
  private async ocrTextlessPages(
    document: Document,
    stored: { bytes: ArrayBuffer; mimeType: string },
    pages: ExtractedPdfPage[],
  ): Promise<{
    pages: number[]
    images: Map<number, RenderedPageImage>
    lowConfidence: boolean
    confidence: number
  }> {
    const empty = { pages: [], images: new Map(), lowConfidence: false, confidence: 0 }
    const textless = pages.filter(
      (page) => page.text.replace(/\s/g, '').length < TEXTLESS_PAGE_MAX_CHARS,
    )
    if (textless.length === 0) return empty
    const images = new Map<number, RenderedPageImage>()
    let session: PageImageRenderSession | null = null
    try {
      session = await this.openPageImages({
        documentId: document.id,
        projectId: document.projectId,
        type: document.type,
        bytes: stored.bytes,
        mimeType: stored.mimeType,
      })
      if (!session) return empty
      for (const page of textless) {
        const rendered = await session.render(page.pageNumber)
        if (rendered) images.set(page.pageNumber, rendered)
      }
    } catch (err) {
      logger.warn('Rendering text-less pages failed', {
        id: document.id,
        error: (err as Error)?.message,
      })
    } finally {
      await session?.close().catch(() => undefined)
    }
    if (images.size === 0) return empty
    const order = [...images.keys()]
    let results: Array<{ text: string; confidence: number } | null> = []
    try {
      results = await this.ocrPages(
        order.map((n) => new Blob([images.get(n)!.bytes], { type: images.get(n)!.mimeType })),
        { preferChinese: await this.prefersChineseOcr(document) },
      )
    } catch (err) {
      logger.warn('OCR of text-less pages failed', {
        id: document.id,
        error: (err as Error)?.message,
      })
    }
    const done: number[] = []
    let confidenceSum = 0
    order.forEach((pageNumber, index) => {
      const result = results[index]
      const page = pages.find((p) => p.pageNumber === pageNumber)
      if (!page || !result || !result.text.trim()) return
      page.text = result.text.trim()
      page.headings = []
      page.tables = []
      delete page.lineFlags
      page.hasContent = true
      page.ocr = { confidence: result.confidence }
      done.push(pageNumber)
      confidenceSum += result.confidence
    })
    const confidence = done.length > 0 ? Math.round(confidenceSum / done.length) : 0
    // A page keeps its rendering when it was read, or when it is a picture
    // page anyway; a blank page keeps nothing.
    for (const pageNumber of order) {
      const page = pages.find((p) => p.pageNumber === pageNumber)
      if (!page?.ocr && !(page?.imageCount && page.imageCount > 0)) images.delete(pageNumber)
    }
    return { pages: done, images, lowConfidence: done.length > 0 && confidence < 60, confidence }
  }

  /**
   * Read an image with Chinese + English straight away when the file or the
   * course is named in Chinese (or the course teaches Chinese). Otherwise OCR
   * reads English first and only retries with Chinese when that looks misread.
   */
  private async prefersChineseOcr(document: Document): Promise<boolean> {
    const project = await this.projects.get(document.projectId).catch(() => undefined)
    if (project?.targetLanguage === 'zh') return true
    return [document.name, project?.name, project?.description].some((text) => hasCjk(text))
  }

  /**
   * Normalise every chunk's text and summarise what looks wrong.
   *
   * Normalisation is deliberately lossless (see `normalizeExtractedText`): it
   * never rewrites Private Use Area code points, U+FFFD, `?` or maths symbols.
   * Chunks are normalised *before* storage so that quiz `quote`s — which are
   * verified against stored chunk text — stay consistent.
   */
  private normalizeChunks(chunks: NewChunk[]): {
    chunks: NewChunk[]
    report: SuspiciousUnicodeReport
  } {
    const normalized = chunks.map((chunk) => ({
      ...chunk,
      // Bold / italic maths letters (Cambria Math exports) become plain text.
      text: normalizeExtractedText(foldMathAlphanumerics(chunk.text)),
    }))
    const report = detectSuspiciousUnicode(normalized.map((chunk) => chunk.text).join('\n'))
    return { chunks: normalized, report }
  }

  /**
   * Preserve figures the extraction pipeline cannot reliably turn into text.
   *
   * A page with an embedded image whose extracted text is unreliable (or is
   * almost empty, i.e. figure-dominant) becomes a `VisualSource`: the page is
   * rendered once, stored, and referenced by the chunks on that page. The
   * student then sees the original picture instead of a broken transcription.
   * OCR text is kept for search/indexing — it just stops being the thing shown.
   */
  private async prepareVisualSources(
    document: Document,
    extraction: ExtractionOutput,
    storedChunks: DocumentChunk[],
  ): Promise<PreparedVisualSource[]> {
    // Presentations: preserve the images each slide embeds. This is the
    // "original picture" we can honestly show for a slide — the app has no PPTX
    // rasteriser, so the slide layout itself is not re-drawn.
    if (document.type === 'pptx') return this.preparePptxVisuals(document, storedChunks)

    if (document.type !== 'pdf') return []

    const pages = extraction.raw.pages ?? []
    if (pages.length === 0) return []

    const chunksByPage = new Map<number, DocumentChunk[]>()
    for (const chunk of storedChunks) {
      if (chunk.pageNumber === undefined) continue
      const list = chunksByPage.get(chunk.pageNumber) ?? []
      list.push(chunk)
      chunksByPage.set(chunk.pageNumber, list)
    }

    const stored = await this.documents.getBytes(document.id)
    if (!stored) return []
    const result: PreparedVisualSource[] = []
    // Opened lazily on the first figure page, then reused for every other one.
    let session: PageImageRenderSession | null | undefined

    try {
      for (const page of pages) {
        // A text-less page read with OCR keeps the rendering it was read from:
        // the proofread page and the vision model compare against it.
        const ocrImage = extraction.ocrImages?.get(page.pageNumber)
        if (ocrImage) {
          const pageChunks = chunksByPage.get(page.pageNumber) ?? []
          const read = !!page.ocr
          result.push({
            source: {
              id: crypto.randomUUID(),
              projectId: document.projectId,
              documentId: document.id,
              pageNumber: page.pageNumber,
              type: read ? 'screenshot' : classifyVisualType('', true),
              caption: read
                ? textlessPageCaption(page.pageNumber)
                : fallbackVisualCaption(page.pageNumber),
              sourceChunkIds: pageChunks.map((c) => c.id),
              imageMimeType: ocrImage.mimeType,
              ...(ocrImage.width > 0 ? { width: ocrImage.width } : {}),
              ...(ocrImage.height > 0 ? { height: ocrImage.height } : {}),
              createdAt: Date.now(),
            },
            image: ocrImage,
          })
          continue
        }
        if (!page.imageCount || page.imageCount <= 0) continue
        const pageChunks = chunksByPage.get(page.pageNumber) ?? []
        const pageText = pageChunks.map((c) => c.text).join('\n')
        const compact = pageText.replace(/\s/g, '')
        const unreliable = looksLikeUnreliableVisualText(pageText)
        // A page that is almost all picture (little or no extractable text) is a
        // figure page, even when its text was not garbled.
        const figureDominant = compact.length < FIGURE_PAGE_MAX_CHARS
        if (!unreliable && !figureDominant) continue

        const source: VisualSource = {
          id: crypto.randomUUID(),
          projectId: document.projectId,
          documentId: document.id,
          pageNumber: page.pageNumber,
          type: classifyVisualType(pageText, true),
          caption: fallbackVisualCaption(page.pageNumber),
          sourceChunkIds: pageChunks.map((c) => c.id),
          imageMimeType: 'image/png',
          createdAt: Date.now(),
        }

        if (session === undefined) {
          session = await this.openPageImages({
            documentId: document.id,
            projectId: document.projectId,
            type: document.type,
            bytes: stored.bytes,
            mimeType: stored.mimeType,
          })
        }
        const rendered = session ? await session.render(page.pageNumber) : null

        if (rendered) {
          source.imageMimeType = rendered.mimeType
          if (rendered.width > 0) source.width = rendered.width
          if (rendered.height > 0) source.height = rendered.height
          result.push({ source, image: rendered })
        } else {
          // No renderer available (e.g. no canvas). Keep the provenance so the
          // unreliable text is still suppressed and the source is disclosed.
          source.imageMimeType = ''
          result.push({ source })
        }
      }
    } finally {
      await session?.close().catch(() => undefined)
    }
    return result
  }

  /**
   * Preserve the images embedded in a presentation's slides.
   *
   * Only bytes already inside the user's .pptx are copied; nothing is invented.
   * The slide's own text is still the primary reading material — the images
   * supplement it and are shown next to it in the slide study view.
   */
  private async preparePptxVisuals(
    document: Document,
    storedChunks: DocumentChunk[],
  ): Promise<PreparedVisualSource[]> {
    const stored = await this.documents.getBytes(document.id)
    if (!stored) return []

    let images: PptxSlideImage[]
    try {
      images = await extractPptxSlideImages(new Blob([stored.bytes], { type: stored.mimeType }))
    } catch (err) {
      logger.warn('Slide image extraction failed', {
        id: document.id,
        error: (err as Error)?.message,
      })
      return []
    }
    if (images.length === 0) return []

    const chunksBySlide = new Map<number, DocumentChunk[]>()
    for (const chunk of storedChunks) {
      if (chunk.pageNumber === undefined) continue
      const list = chunksBySlide.get(chunk.pageNumber) ?? []
      list.push(chunk)
      chunksBySlide.set(chunk.pageNumber, list)
    }

    const result: PreparedVisualSource[] = []
    for (const image of images) {
      const slideChunks = chunksBySlide.get(image.slideNumber) ?? []
      const displayable = image.bytes.byteLength > 0 && image.mimeType.length > 0
      const source: VisualSource = {
        id: crypto.randomUUID(),
        projectId: document.projectId,
        documentId: document.id,
        pageNumber: image.slideNumber,
        type: 'illustration',
        caption: image.unsupportedFormat
          ? unsupportedSlideVisualCaption(
              image.slideNumber,
              image.unsupportedFormat,
              image.substitute === 'thumbnail',
            )
          : slideVisualCaption(image.slideNumber),
        sourceChunkIds: slideChunks.map((chunk) => chunk.id),
        imageMimeType: displayable ? image.mimeType : '',
        ...(image.unsupportedFormat ? { unsupportedFormat: image.unsupportedFormat } : {}),
        createdAt: Date.now(),
      }
      // An EMF / WMF picture without a displayable fallback keeps only its
      // provenance: the figure says the format cannot be shown.
      result.push(
        displayable
          ? {
              source,
              image: { bytes: image.bytes, mimeType: image.mimeType, width: 0, height: 0 },
            }
          : { source },
      )
    }
    return result
  }

  private async chunk(document: Document, extraction: ExtractionOutput): Promise<NewChunk[]> {
    const ctx = {
      documentId: document.id,
      projectId: document.projectId,
      documentName: document.name,
      type: document.type,
      materialType: document.materialType,
    }
    switch (document.type) {
      case 'pdf':
        return chunksFromPdf(ctx, extraction.raw.pages ?? [])
      case 'docx':
        return chunksFromDocx(ctx, extraction.raw.blocks ?? [])
      case 'pptx':
        return chunksFromPptx(ctx, extraction.raw.slides ?? [])
      case 'image':
        return chunksFromOcr(ctx, {
          text: extraction.raw.ocr?.text ?? '',
          confidence: extraction.confidence ?? 0,
          language: extraction.metadata.language ?? 'unknown',
        })
      case 'text':
        return chunksFromText(ctx, extraction.raw.text ?? '')
      default: {
        const exhaustive: never = document.type
        throw new ValidationError(t('errors.unsupportedChunking', { type: exhaustive as string }))
      }
    }
  }
}

interface ExtractionOutput {
  textLength: number
  metadata: Document['metadata']
  warnings: string[]
  raw: {
    text?: string
    pages?: Array<{
      pageNumber: number
      text: string
      headings: Array<{ text: string }>
      /** Image-painting operators on the page; 0/absent means text-only. */
      imageCount?: number
      /** The page had no text layer; `text` is OCR of its rendering. */
      ocr?: { confidence: number }
      /** Options marked over their letter (an MC answer key). */
      markedOptions?: ExtractedPdfPage['markedOptions']
    }>
    blocks?: Array<{
      type: 'heading' | 'paragraph' | 'table' | 'list'
      text: string
      rows?: string[][]
    }>
    slides?: Array<{
      slideNumber: number
      title?: string
      body: string
      notes: string
      tables: string[][][]
      imageCount: number
    }>
    ocr?: { text: string; confidence: number; language: string }
  }
  lowConfidence?: boolean
  confidence?: number
  /** An image OCR result that looks hand-written or marked (see ocrExtractor). */
  handwriting?: boolean
  /** Renderings of text-less PDF pages that were read with OCR, by page. */
  ocrImages?: Map<number, RenderedPageImage>
}

type NewChunk = NewChunkInput
