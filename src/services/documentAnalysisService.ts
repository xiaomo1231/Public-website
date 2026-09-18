import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { AIService } from './aiService'
import type { ProjectService } from './projectService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { normalizeDocumentAnalysis } from '@/infrastructure/ai/prompts/document-analyzer/normalize'
import type { DocumentAnalysisOutput } from '@/infrastructure/ai/prompts/types'
import type { SourceReference as CourseSourceRef } from '@/entities/courseAnalysis/types'
import { logger } from '@/infrastructure/logger/logger'
import { AppError } from '@/infrastructure/errors/AppError'

const MAX_DOC_CHARS = 50_000
const MAX_CHUNKS_PER_DOC = 200

export interface DocumentAnalysisProgress {
  stage: 'collecting' | 'extracting' | 'analyzing' | 'storing' | 'done' | 'failed'
  progress: number
  message?: string
}

export type AnalysisProgressListener = (p: DocumentAnalysisProgress) => void

export interface DocumentAnalysisServiceOptions {
  onProgress?: AnalysisProgressListener
  ai: AIService
}

export class DocumentAnalysisService {
  private db: AppDatabase
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private analyses: CourseAnalysisRepository
  private projects: ProjectService
  private ai: AIService

  constructor(deps: DocumentAnalysisServiceOptions & { db?: AppDatabase; documents?: DocumentRepository; chunks?: ChunkRepository; analyses?: CourseAnalysisRepository; projects: ProjectService }) {
    this.db = deps.db ?? getDb()
    this.documents = deps.documents ?? new DocumentRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.projects = deps.projects
    this.ai = deps.ai
  }
  // suppress lint</newString>

  /**
   * Analyze all processed documents in a project, extracting structured
   * knowledge. Re-runs overwrite the previous analysis.
   */
  async analyzeProject(projectId: string, options: { onProgress?: AnalysisProgressListener; subject?: string; signal?: AbortSignal } = {}): Promise<CourseAnalysisRepository> {
    await this.projects.get(projectId) // verify project exists
    const { onProgress, subject } = options
    onProgress?.({ stage: 'collecting', progress: 5, message: 'Collecting documents' })

    const documents = await this.documents.listByProject(projectId)
    const readyDocs = documents.filter((d) => d.status === 'ready')
    if (readyDocs.length === 0) {
      throw new AppError('No processed documents found. Upload and process documents first.', 'NO_DOCUMENTS')
    }

    const documentText = await this.collectText(projectId, readyDocs.map((d) => d.id), onProgress)
    const language = await this.detectLanguage(documentText)
    onProgress?.({ stage: 'analyzing', progress: 30, message: 'Asking AI to extract knowledge' })

    const seed = await this.analyses.getByProject(projectId)
    const analysisId = seed?.id ?? crypto.randomUUID()
    const startedAt = seed?.startedAt ?? Date.now()
    await this.analyses.upsert({
      id: analysisId,
      projectId,
      status: 'analyzing',
      language,
      progress: 30,
      documentIds: readyDocs.map((d) => d.id),
      topicCount: 0,
      formulaCount: 0,
      symbolCount: 0,
      startedAt,
      promptVersion: prompts.documentAnalyzer.VERSION,
    })

    let output: DocumentAnalysisOutput
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: prompts.documentAnalyzer.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.documentAnalyzer.buildUserPrompt({
            documentName: readyDocs.map((d) => d.name).join(', '),
            documentText: documentText.slice(0, MAX_DOC_CHARS),
            language,
            subject,
          }),
        },
      ]
      const { data, raw } = await this.ai.chatJSON<unknown>(messages, {
        ...(options.signal ? { signal: options.signal } : {}),
      })
      // Validate + sanitise before anything reaches the database.
      output = normalizeDocumentAnalysis(data)
      logger.info('Document analysis completed', {
        projectId,
        tokens: raw.usage?.totalTokens,
        topics: output.topics.length,
        formulas: output.formulas.length,
        symbols: output.symbols.length,
      })
    } catch (err) {
      await this.analyses.upsert({
        id: analysisId,
        projectId,
        status: 'failed',
        language,
        progress: 60,
        documentIds: readyDocs.map((d) => d.id),
        topicCount: seed?.topicCount ?? 0,
        formulaCount: seed?.formulaCount ?? 0,
        symbolCount: seed?.symbolCount ?? 0,
        startedAt,
        promptVersion: prompts.documentAnalyzer.VERSION,
        errorMessage: err instanceof Error ? err.message : 'Analysis failed',
      })
      throw err
    }

    onProgress?.({ stage: 'storing', progress: 80, message: 'Saving structured knowledge' })

    const topicsByName = new Map<string, string>()
    const topicsPayload = output.topics.map((t, idx) => {
      const id = crypto.randomUUID()
      topicsByName.set(t.name, id)
      return {
        name: t.name,
        description: t.description,
        order: idx,
        sourceRefs: normalizeSourceRefs(t.sourceRefs, readyDocs),
      }
    })

    await this.analyses.reseedProject(
      projectId,
      {
        topics: topicsPayload,
        concepts: output.concepts.map((c) => ({
          name: c.name,
          definition: c.definition,
          ...(c.explanation ? { explanation: c.explanation } : {}),
          topicNames: c.topicNames,
          sourceRefs: normalizeSourceRefs(c.sourceRefs, readyDocs),
        })),
        formulas: output.formulas.map((f) => ({
          name: f.name,
          latex: f.latex,
          description: f.description,
          variables: f.variables,
          topicNames: [],
          sourceRefs: normalizeSourceRefs(f.sourceRefs, readyDocs),
        })),
        symbols: output.symbols.map((s) => ({
          symbol: s.symbol,
          meaning: s.meaning,
          context: s.context,
          ...(s.unit ? { unit: s.unit } : {}),
          topicNames: [],
          sourceRefs: normalizeSourceRefs(s.sourceRefs, readyDocs),
        })),
        examples: output.examples.map((e) => ({
          title: e.title,
          problem: e.problem,
          ...(e.solution ? { solution: e.solution } : {}),
          topicNames: e.topicNames,
          sourceRefs: normalizeSourceRefs(e.sourceRefs, readyDocs),
        })),
        exercises: output.exercises.map((ex) => ({
          prompt: ex.prompt,
          difficulty: ex.difficulty,
          topicNames: ex.topicNames,
          sourceRefs: normalizeSourceRefs(ex.sourceRefs, readyDocs),
        })),
        prerequisites: output.prerequisites.map((p) => ({
          name: p.name,
          description: p.description,
          topicNames: p.topicNames,
        })),
        topicsByName,
        documentIds: readyDocs.map((d) => d.id),
      },
      output.language ?? language,
      analysisId,
    )

    onProgress?.({ stage: 'done', progress: 100, message: 'Analysis complete' })
    return this.analyses
  }

  /**
   * Stitch together up to MAX_CHUNKS_PER_DOC chunks per document into a
   * single representative string, preserving page/section markers.
   */
  private async collectText(_projectId: string, docIds: string[], onProgress?: AnalysisProgressListener): Promise<string> {
    const lines: string[] = []
    let processed = 0
    for (const id of docIds) {
      const chunks = await this.chunks.listByDocument(id)
      const sliced = chunks.slice(0, MAX_CHUNKS_PER_DOC)
      const heading = `=== ${id} ===`
      const body = sliced
        .map((c) => {
          const prefix = c.pageNumber ? `[p${c.pageNumber}${c.section ? ' · ' + c.section : ''}] ` : c.section ? `[§ ${c.section}] ` : ''
          return prefix + c.text
        })
        .join('\n\n')
      lines.push(`${heading}\n${body}`)
      processed++
      onProgress?.({ stage: 'extracting', progress: 5 + Math.floor((processed / docIds.length) * 20) })
    }
    return lines.join('\n\n')
  }

  private async detectLanguage(text: string): Promise<'zh' | 'en' | 'mixed'> {
    let zh = 0
    let en = 0
    for (const ch of text.slice(0, 8000)) {
      if (/[\u4e00-\u9fff]/.test(ch)) zh++
      else if (/[A-Za-z]/.test(ch)) en++
    }
    if (zh === 0 && en === 0) return 'mixed'
    if (zh > en * 2) return 'zh'
    if (en > zh * 2) return 'en'
    return 'mixed'
  }
}

function normalizeSourceRefs(refs: Array<{ documentName: string; page?: number; slideNumber?: number; section?: string; quote?: string }>, docs: Array<{ id: string; name: string }>): CourseSourceRef[] {
  if (!refs) return []
  return refs
    .map((r) => ({
      documentId: docs.find((d) => d.name === r.documentName)?.id ?? '',
      documentName: r.documentName,
      ...(typeof r.page === 'number' ? { page: r.page } : {}),
      ...(typeof r.slideNumber === 'number' ? { slideNumber: r.slideNumber } : {}),
      ...(r.section ? { section: r.section } : {}),
      ...(r.quote ? { quote: r.quote } : {}),
    }))
    .filter((r) => r.documentId)
}