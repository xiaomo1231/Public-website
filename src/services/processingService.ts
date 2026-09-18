import type { DocumentRepository } from '@/entities/document/repository'
import type { ChunkRepository } from '@/entities/chunk/repository'
import type { ProcessingJobRepository } from '@/entities/processingJob/repository'
import type { ProjectService } from './projectService'
import type { Document } from '@/entities/document/types'
import type { NewChunkInput } from '@/entities/chunk/types'
import { extractPdf } from '@/infrastructure/files/pdfExtractor'
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
import { logger } from '@/infrastructure/logger/logger'
import { AppError, ValidationError } from '@/infrastructure/errors/AppError'

export interface ProcessingProgress {
  stage: 'extracting' | 'chunking' | 'indexing' | 'done' | 'failed'
  progress: number
  message?: string
}

export type ProgressListener = (progress: ProcessingProgress) => void

export interface ProcessingServiceOptions {
  onProgress?: ProgressListener
}

export class ProcessingService {
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private jobs: ProcessingJobRepository
  private projects: ProjectService

  constructor(deps: {
    documents: DocumentRepository
    chunks: ChunkRepository
    jobs: ProcessingJobRepository
    projects: ProjectService
  }) {
    this.documents = deps.documents
    this.chunks = deps.chunks
    this.jobs = deps.jobs
    this.projects = deps.projects
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

      const newChunks = await this.chunk(document, extraction)
      onProgress?.({ stage: 'indexing', progress: 80 })
      await this.jobs.setStage(jobId, 'indexing', 80)

      // wipe any existing chunks first (re-processing scenario)
      await this.chunks.deleteByDocument(document.id)
      await this.chunks.addMany(newChunks)

      const warnings = (extraction.warnings ?? []).slice()
      if (extraction.lowConfidence) warnings.push(`OCR confidence low: ${extraction.confidence}%`)
      await this.documents.update(document.id, {
        status: 'ready',
        errorMessage: undefined,
        warnings,
        textLength: extraction.textLength,
        chunkCount: newChunks.length,
        processedAt: Date.now(),
        metadata: extraction.metadata,
      })

      onProgress?.({ stage: 'done', progress: 100 })
      await this.jobs.setStage(jobId, 'done', 100)
      logger.info('Document processed', { id: document.id, chunks: newChunks.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Processing failed'
      logger.error('Document processing failed', { id: document.id }, err)
      await this.documents.update(document.id, {
        status: 'failed',
        errorMessage: message,
      })
      await this.jobs.update(jobId, { stage: 'failed', progress: 100, errorMessage: message, finishedAt: Date.now() })
      throw err instanceof AppError ? err : new AppError(message, 'PROCESSING_FAILED', err)
    }
  }

  private async extract(document: Document): Promise<ExtractionOutput> {
    const stored = await this.documents.getBytes(document.id)
    if (!stored) throw new ValidationError('Document content missing')
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
        throw new ValidationError(`Unsupported document type: ${exhaustive as string}`)
      }
    }
  }

  private async chunk(document: Document, extraction: ExtractionOutput): Promise<NewChunk[]> {
    const ctx = {
      documentId: document.id,
      projectId: document.projectId,
      documentName: document.name,
      type: document.type,
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
        throw new ValidationError(`Unsupported chunking for: ${exhaustive as string}`)
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
    pages?: Array<{ pageNumber: number; text: string; headings: Array<{ text: string }> }>
    blocks?: Array<{ type: 'heading' | 'paragraph' | 'table' | 'list'; text: string; rows?: string[][] }>
    slides?: Array<{ slideNumber: number; title?: string; body: string; notes: string; tables: string[][][]; imageCount: number }>
    ocr?: { text: string; confidence: number; language: string }
  }
  lowConfidence?: boolean
  confidence?: number
}

type NewChunk = NewChunkInput