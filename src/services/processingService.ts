import type { DocumentRepository } from '@/entities/document/repository'
import type { ChunkRepository } from '@/entities/chunk/repository'
import type { ProcessingJobRepository } from '@/entities/processingJob/repository'
import type { ProjectService } from './projectService'
import { resolveMaterialType, type Document, type DocumentType } from '@/entities/document/types'
import { CourseStructureService, type PreparedStructure } from './courseStructureService'
import type { DocumentChunk, NewChunkInput } from '@/entities/chunk/types'
import type { VisualSource } from '@/entities/visualSource/types'
import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { fallbackVisualCaption } from '@/entities/visualSource/types'
import {
  classifyVisualType,
  looksLikeUnreliableVisualText,
} from '@/infrastructure/files/visualDetection'
import { extractPdf, renderPdfPageImage, type RenderedPageImage } from '@/infrastructure/files/pdfExtractor'
import { extractDocx } from '@/infrastructure/files/docxExtractor'
import { extractPptx } from '@/infrastructure/files/pptxExtractor'
import { extractOcr } from '@/infrastructure/files/ocrExtractor'
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
import { logger } from '@/infrastructure/logger/logger'
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

const defaultPageImageRenderer: PageImageRenderer = async (input) => {
  if (input.type !== 'pdf') return null
  return renderPdfPageImage(new Blob([input.bytes], { type: input.mimeType }), input.pageNumber, 2)
}

/** A page whose extracted text is shorter than this is treated as figure-dominant. */
const FIGURE_PAGE_MAX_CHARS = 40

export class ProcessingService {
  private db: AppDatabase
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private jobs: ProcessingJobRepository
  private projects: ProjectService
  private visuals: VisualSourceRepository
  private renderPageImage: PageImageRenderer
  private structure: CourseStructureService

  constructor(deps: {
    documents: DocumentRepository
    chunks: ChunkRepository
    jobs: ProcessingJobRepository
    projects: ProjectService
    visuals?: VisualSourceRepository
    renderPageImage?: PageImageRenderer
    structure?: CourseStructureService
    db?: AppDatabase
  }) {
    this.db = deps.db ?? getDb()
    this.documents = deps.documents
    this.chunks = deps.chunks
    this.jobs = deps.jobs
    this.projects = deps.projects
    this.visuals = deps.visuals ?? new VisualSourceRepository()
    this.renderPageImage = deps.renderPageImage ?? defaultPageImageRenderer
    this.structure = deps.structure ?? new CourseStructureService()
  }

  async process(documentId: string, options: ProcessingServiceOptions = {}): Promise<void> {
    const document = await this.documents.get(documentId)
    await this.projects.get(document.projectId) // ensure project exists
    const job = await this.jobs.create(documentId, document.projectId)
    await this.documents.update(documentId, { status: 'processing', errorMessage: undefined })
    await this.run(document, job.id, options)
  }

  private async run(document: Document, jobId: string, options: ProcessingServiceOptions): Promise<void> {
    const { onProgress } = options
    try {
      onProgress?.({ stage: 'extracting', progress: 5 })
      await this.jobs.setStage(jobId, 'extracting', 5)
      const extraction = await this.extract(document)
      onProgress?.({ stage: 'chunking', progress: 50 })
      await this.jobs.setStage(jobId, 'chunking', 50)

      const { chunks: newChunks, report } = this.normalizeChunks(await this.chunk(document, extraction))
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

      const storedChunks = this.chunks.prepareMany(newChunks)

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
      if (extraction.lowConfidence) warnings.push(t('errors.ocrLowConfidence', { value: `${extraction.confidence}%` }))
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
          codePoints: report.codePoints.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`),
        })
      }
      await this.db.transaction('rw', [
        this.db.chunks,
        this.db.courseStructures,
        this.db.courseStructureNodes,
        this.db.visualSources,
        this.db.visualSourceImages,
        this.db.documents,
        this.db.processingJobs,
      ], async () => {
        await this.chunks.deleteByDocument(document.id)
        await this.chunks.addPrepared(storedChunks)
        if (prepared) {
          await this.structure.persist(prepared, storedChunks.map((chunk) => chunk.id))
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
          metadata: extraction.metadata,
        })
        await this.jobs.setStage(jobId, 'done', 100)
      })

      onProgress?.({ stage: 'done', progress: 100 })
      logger.info('Document processed', { id: document.id, chunks: newChunks.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('upload.processingFailed')
      logger.error('Document processing failed', { id: document.id }, err)
      await this.documents.update(document.id, {
        status: document.status === 'ready' ? 'ready' : 'failed',
        errorMessage: message,
      })
      await this.jobs.update(jobId, { stage: 'failed', progress: 100, errorMessage: message, finishedAt: Date.now() })
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
        return {
          textLength: result.textLength,
          metadata: result.metadata,
          warnings: result.warnings,
          raw: { pages: result.pages },
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
          metadata: { title: result.metadata.title, author: result.metadata.author, slideCount: result.slideCount },
          warnings: result.warnings,
          raw: { slides: result.slides },
        }
      }
      case 'image': {
        const result = await extractOcr(blob)
        return {
          textLength: result.text.length,
          metadata: { language: result.language, ocrConfidence: result.confidence },
          warnings: result.warnings,
          raw: { ocr: result },
          lowConfidence: result.confidence < 60,
          confidence: result.confidence,
        }
      }
      default: {
        const exhaustive: never = document.type
        throw new ValidationError(t('errors.unsupportedType', { type: exhaustive as string }))
      }
    }
  }

  /**
   * Normalise every chunk's text and summarise what looks wrong.
   *
   * Normalisation is deliberately lossless (see `normalizeExtractedText`): it
   * never rewrites Private Use Area code points, U+FFFD, `?` or maths symbols.
   * Chunks are normalised *before* storage so that quiz `quote`s — which are
   * verified against stored chunk text — stay consistent.
   */
  private normalizeChunks(chunks: NewChunk[]): { chunks: NewChunk[]; report: SuspiciousUnicodeReport } {
    const normalized = chunks.map((chunk) => ({ ...chunk, text: normalizeExtractedText(chunk.text) }))
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

    for (const page of pages) {
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

      const rendered = await this.renderPageImage({
        documentId: document.id,
        projectId: document.projectId,
        type: document.type,
        bytes: stored.bytes,
        mimeType: stored.mimeType,
        pageNumber: page.pageNumber,
      })

      if (rendered) {
        source.imageMimeType = rendered.mimeType
        source.width = rendered.width
        source.height = rendered.height
        result.push({ source, image: rendered })
      } else {
        // No renderer available (e.g. no canvas). Keep the provenance so the
        // unreliable text is still suppressed and the source is disclosed.
        source.imageMimeType = ''
        result.push({ source })
      }
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
    }>
    blocks?: Array<{ type: 'heading' | 'paragraph' | 'table' | 'list'; text: string; rows?: string[][] }>
    slides?: Array<{ slideNumber: number; title?: string; body: string; notes: string; tables: string[][][]; imageCount: number }>
    ocr?: { text: string; confidence: number; language: string }
  }
  lowConfidence?: boolean
  confidence?: number
}

type NewChunk = NewChunkInput
