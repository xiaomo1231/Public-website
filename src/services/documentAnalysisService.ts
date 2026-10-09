import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { AtomicSideWrites } from '@/entities/courseAnalysis/repository'
import { COURSE_ANALYSIS_SCHEMA_VERSION } from '@/entities/courseAnalysis/types'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { computeAnalysisSourceHash, toSourceDocumentFingerprint } from '@/entities/courseContent/sourceHash'
import {
  buildCandidateChunkLabel,
  chunkFingerprintMap,
  validateTopicSourceChunks,
} from '@/entities/courseContent/topicDependency'
import { matchTopicIdentities } from '@/entities/courseAnalysis/topicIdentity'
import { mergeDocumentAnalyses } from '@/entities/courseAnalysis/mergeAnalyses'
import {
  planAnalysisSegments,
  segmentText,
  type AnalysisSegment,
  type ChunkFormatter,
} from '@/entities/courseContent/analysisInput'
import type { AIService } from './aiService'
import type { ProjectService } from './projectService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { normalizeDocumentAnalysis } from '@/infrastructure/ai/prompts/document-analyzer/normalize'
import type { DocumentAnalysisOutput } from '@/infrastructure/ai/prompts/types'
import type { SourceReference as CourseSourceRef } from '@/entities/courseAnalysis/types'
import { logger } from '@/infrastructure/logger/logger'
import { AppError } from '@/infrastructure/errors/AppError'
import { asRecord } from '@/infrastructure/ai/validation'
import type { DocumentChunk } from '@/entities/chunk/types'
import { tokenize } from './classProgressService'
import { resolveMaterialType } from '@/entities/document/types'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { t } from '@/i18n'

/** Parts of a long course analysed at the same time. */
const ANALYSIS_CONCURRENCY = 2

/**
 * The analyzer must return a large structured object (topics, concepts,
 * formulas, symbols, examples, exercises, prerequisites).
 *
 * The user's chat `maxTokens` (default 2048) is far too small for that: even a
 * minimal analysis needs roughly 2.2k tokens of JSON and a typical one needs
 * about 8k. Without an explicit budget the provider truncates the response
 * mid-JSON and parsing fails, which used to surface as a misleading
 * "the AI returned something unreadable" error.
 */
export const ANALYSIS_MIN_OUTPUT_TOKENS = 8_192

/** Top-level collections the analyzer is asked to return. */
const ANALYSIS_COLLECTION_KEYS = [
  'topics',
  'concepts',
  'formulas',
  'symbols',
  'examples',
  'exercises',
  'prerequisites',
] as const

/** Describe one expected collection for diagnostics (never its contents). */
function describeCollection(record: Record<string, unknown> | null, key: string): string {
  if (!record) return 'no object'
  const value = record[key]
  if (value === undefined) return 'MISSING'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array length=${value.length}`
  return typeof value
}

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
  private content: CourseContentRepository
  private ai: AIService

  constructor(deps: DocumentAnalysisServiceOptions & { db?: AppDatabase; documents?: DocumentRepository; chunks?: ChunkRepository; analyses?: CourseAnalysisRepository; content?: CourseContentRepository; projects: ProjectService }) {
    this.db = deps.db ?? getDb()
    this.documents = deps.documents ?? new DocumentRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.content = deps.content ?? new CourseContentRepository({ db: this.db, analyses: this.analyses, chunks: this.chunks, documents: this.documents })
    this.projects = deps.projects
    this.ai = deps.ai
  }

  /**
   * Analyze all processed documents in a project, extracting structured
   * knowledge. Re-runs overwrite the previous analysis.
   */
  async analyzeProject(projectId: string, options: { onProgress?: AnalysisProgressListener; signal?: AbortSignal; sideWrites?: AtomicSideWrites } = {}): Promise<CourseAnalysisRepository> {
    // Also verifies the project exists. The subject is read here, from the
    // project itself, so every path (manual or automatic) analyses with it.
    const { subject } = await this.projects.get(projectId)
    const { onProgress } = options
    onProgress?.({ stage: 'collecting', progress: 5, message: t('stage.collecting') })

    const documents = await this.documents.listByProject(projectId)
    const readyDocs = documents.filter((d) => d.status === 'ready')
    // A professor answer key is reference material, never course knowledge; it
    // is excluded from the analysis (and from its source hash) entirely.
    const courseDocs = readyDocs.filter(
      (d) => resolveMaterialType(d.materialType) !== 'homework_answer',
    )
    if (courseDocs.length === 0) {
      throw new AppError(t('errors.noProcessedDocuments'), 'NO_DOCUMENTS')
    }

    // The textbook is the primary source of course facts. Notes and lecture
    // transcripts are context for the tutor, not the basis of the analysis —
    // unless there is no textbook at all.
    const textbookDocs = courseDocs.filter(
      (d) => resolveMaterialType(d.materialType) === 'textbook',
    )
    const analysisDocs = textbookDocs.length > 0 ? textbookDocs : courseDocs
    // Chunks carry the textbook chapter/section they came from; the analysis is
    // grounded in that structure instead of re-inventing an outline.
    const chunkLists = await Promise.all(
      analysisDocs.map((doc) => this.chunks.listByDocument(doc.id)),
    )
    const analysisChunks = chunkLists.flat()

    // Fingerprint of the exact analysis *input* this run is based on. Written
    // with the result so a later visit can tell whether the material changed
    // without re-running the analyzer. Built from chunk content (not chunk ids
    // or timestamps), so re-processing identical material is not a change.
    const sourceHash = computeAnalysisSourceHash(
      analysisDocs.map((doc, index) => toSourceDocumentFingerprint(doc, chunkLists[index]!)),
    )
    // The textbook structure the analysis is grounded in, so a structure change
    // can invalidate the result. The hash is the precise signal; the revision
    // number is kept for older rows.
    const [derivedFromStructureVersion, derivedFromStructureHash] = await Promise.all([
      this.content.getContentVersion(projectId),
      this.content.getStructureHash(projectId),
    ])

    // Every chunk goes to the analyzer: in one request when the course fits,
    // otherwise in parts cut at chapter boundaries and merged afterwards.
    const formatted = new Map<string, string>()
    const format: ChunkFormatter = (chunk) => {
      let text = formatted.get(chunk.id)
      if (text === undefined) {
        // The stable chunk id is what the model echoes back in each topic's
        // `sourceChunkIds`. Maths is canonicalised (Symbol-font glyphs
        // recovered, Unicode maths to LaTeX) so the analyzer never ingests
        // opaque characters; the stored chunk is untouched.
        text = `[${buildCandidateChunkLabel(chunk)}] ${normalizeMathNotation(chunk.text).text}`
        formatted.set(chunk.id, text)
      }
      return text
    }
    const planned = planAnalysisSegments(
      analysisDocs.map((doc, index) => ({ id: doc.id, name: doc.name, chunks: chunkLists[index]! })),
      format,
    )
    const segments: AnalysisSegment[] =
      planned.length > 0
        ? planned
        : [{ documents: analysisDocs.map((doc) => ({ id: doc.id, name: doc.name, chunks: [] })), label: '', chapterIds: [], chars: 0 }]
    logger.debug('Analysis input planned', {
      projectId,
      chunks: analysisChunks.length,
      parts: segments.length,
      chars: segments.map((segment) => segment.chars),
    })
    onProgress?.({ stage: 'extracting', progress: 25 })
    const language = await this.detectLanguage(segmentText(segments[0]!, format))
    onProgress?.({ stage: 'analyzing', progress: 30, message: t('stage.askingAi') })

    const seed = await this.analyses.getByProject(projectId)
    const analysisId = seed?.id ?? crypto.randomUUID()
    const startedAt = seed?.startedAt ?? Date.now()
    const promptVersion = prompts.subjectProfile.subjectPromptVersion(
      prompts.documentAnalyzer.VERSION,
      subject,
    )
    await this.analyses.upsert({
      id: analysisId,
      projectId,
      status: 'analyzing',
      language,
      progress: 30,
      documentIds: analysisDocs.map((d) => d.id),
      topicCount: seed?.topicCount ?? 0,
      formulaCount: seed?.formulaCount ?? 0,
      symbolCount: seed?.symbolCount ?? 0,
      startedAt,
      promptVersion,
      sourceHash,
      schemaVersion: COURSE_ANALYSIS_SCHEMA_VERSION,
      derivedFromStructureVersion,
      derivedFromStructureHash,
    })

    let output: DocumentAnalysisOutput
    try {
      const outputs = await this.analyzeSegments(segments, format, {
        projectId,
        subject,
        language,
        documentNames: analysisDocs.map((d) => d.name),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(onProgress ? { onProgress } : {}),
      })
      output = mergeDocumentAnalyses(
        outputs.map((part, index) => ({
          output: part,
          label: segments[index]!.label,
          chapterIds: segments[index]!.chapterIds,
        })),
      )
      if (segments.length > 1) {
        logger.info('Course analysed in parts', {
          projectId,
          parts: segments.length,
          topics: output.topics.length,
          concepts: output.concepts.length,
        })
      }
    } catch (err) {
      // A failed refresh must never destroy an analysis that is already usable.
      // Restore the previous row (the 'analyzing' write above replaced it) and
      // let the caller surface the error.
      if (seed && seed.status === 'ready') {
        await this.analyses.upsert(seed)
        logger.warn('Course analysis failed; the previously saved analysis is still in use', {
          projectId,
          error: err instanceof Error ? err.message : String(err),
        })
      } else {
        await this.analyses.upsert({
          id: analysisId,
          projectId,
          status: 'failed',
          language,
          progress: 60,
          documentIds: analysisDocs.map((d) => d.id),
          topicCount: 0,
          formulaCount: 0,
          symbolCount: 0,
          startedAt,
          promptVersion,
          sourceHash,
          schemaVersion: COURSE_ANALYSIS_SCHEMA_VERSION,
          derivedFromStructureVersion,
          derivedFromStructureHash,
          errorMessage: err instanceof Error ? err.message : t('errors.analysisFailed'),
        })
      }
      throw err
    }

    onProgress?.({ stage: 'storing', progress: 80, message: t('stage.saving') })

    // The candidate set the model was allowed to pick from. A `sourceChunkId`
    // outside this set is discarded — the model never gets to invent a
    // dependency, and an unverifiable topic is marked instead of guessed at.
    const candidateChunks = analysisChunks.filter((chunk) => chunk.text.trim().length > 0)

    const previousTopics = await this.analyses.listTopics(projectId)
    const chunkTokens = analysisChunks.map((chunk) => ({ chunk, tokens: new Set(tokenize(chunk.text)) }))
    const position = new Map(analysisChunks.map((chunk, index) => [chunk.id, { chunk, index }]))
    const drafts = output.topics.map((topic, idx) => {
      // A topic sits where its earliest source passage is; word overlap is
      // only the fallback for a topic without valid sources.
      const firstSource = (topic.sourceChunkIds ?? [])
        .map((id) => position.get(id))
        .filter((entry) => entry !== undefined && entry.chunk.text.trim().length > 0)
        .sort((a, b) => a!.index - b!.index)[0]
      const structure = firstSource
        ? structureOf(firstSource.chunk)
        : bestStructureRef(`${topic.name} ${topic.description}`, chunkTokens)
      return {
        name: topic.name,
        description: topic.description,
        order: idx,
        sourceRefs: normalizeSourceRefs(topic.sourceRefs, analysisDocs),
        rawSourceChunkIds: topic.sourceChunkIds,
        ...structure,
      }
    })

    // Reuse the stored id when this is recognisably the same teaching topic, so
    // TutorLesson / TutorSession / Quiz / Practice references survive a
    // re-analysis. Ambiguous matches deliberately get a NEW id.
    const identity = matchTopicIdentities(
      previousTopics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        ...(topic.chapterId ? { chapterId: topic.chapterId } : {}),
        ...(topic.sectionId ? { sectionId: topic.sectionId } : {}),
        ...(topic.sourceChunkIds ? { sourceChunkIds: topic.sourceChunkIds } : {}),
      })),
      drafts.map((draft) => ({
        name: draft.name,
        ...(draft.chapterId ? { chapterId: draft.chapterId } : {}),
        ...(draft.sectionId ? { sectionId: draft.sectionId } : {}),
      })),
    )
    logger.debug('Topic identity resolved', {
      projectId,
      reused: identity.diagnostics.filter((d) => d.matchedTopicId).length,
      ambiguous: identity.diagnostics.filter((d) => d.reason === 'ambiguous').length,
      fresh: identity.diagnostics.filter((d) => d.reason === 'new').length,
    })

    const topicsByName = new Map<string, string>()
    const topicsPayload = drafts.map((draft, idx) => {
      const id = identity.ids[idx] ?? crypto.randomUUID()
      topicsByName.set(draft.name, id)
      const dependency = validateTopicSourceChunks(draft.rawSourceChunkIds, candidateChunks)
      return {
        name: draft.name,
        description: draft.description,
        order: draft.order,
        sourceRefs: draft.sourceRefs,
        ...(draft.chapterId ? { chapterId: draft.chapterId } : {}),
        ...(draft.sectionId ? { sectionId: draft.sectionId } : {}),
        ...(draft.chapterNumber ? { chapterNumber: draft.chapterNumber } : {}),
        ...(draft.sectionNumber ? { sectionNumber: draft.sectionNumber } : {}),
        ...(draft.chapterTitle ? { chapterTitle: draft.chapterTitle } : {}),
        ...(draft.sectionTitle ? { sectionTitle: draft.sectionTitle } : {}),
        // Per-topic provenance: which prompt produced this row.
        promptVersion,
        // A topic whose sources cannot be verified is kept and flagged, never
        // given an invented dependency.
        ...(dependency
          ? {
              sourceChunkIds: dependency.sourceChunkIds,
              sourceChapterIds: dependency.sourceChapterIds,
              sourceSectionIds: dependency.sourceSectionIds,
              dependencyHash: dependency.dependencyHash,
              // Lets a later re-process re-point the dependency by content.
              sourceChunkFingerprints: chunkFingerprintMap(
                candidateChunks.filter((chunk) => dependency.sourceChunkIds.includes(chunk.id)),
              ),
            }
          : { needsFullReanalysis: true }),
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
          sourceRefs: normalizeSourceRefs(c.sourceRefs, analysisDocs),
        })),
        formulas: output.formulas.map((f) => ({
          name: f.name,
          latex: f.latex,
          description: f.description,
          variables: f.variables,
          topicNames: [],
          sourceRefs: normalizeSourceRefs(f.sourceRefs, analysisDocs),
        })),
        symbols: output.symbols.map((s) => ({
          symbol: s.symbol,
          meaning: s.meaning,
          context: s.context,
          ...(s.unit ? { unit: s.unit } : {}),
          topicNames: [],
          sourceRefs: normalizeSourceRefs(s.sourceRefs, analysisDocs),
        })),
        examples: output.examples.map((e) => ({
          title: e.title,
          problem: e.problem,
          ...(e.solution ? { solution: e.solution } : {}),
          topicNames: e.topicNames,
          sourceRefs: normalizeSourceRefs(e.sourceRefs, analysisDocs),
        })),
        exercises: output.exercises.map((ex) => ({
          prompt: ex.prompt,
          difficulty: ex.difficulty,
          topicNames: ex.topicNames,
          sourceRefs: normalizeSourceRefs(ex.sourceRefs, analysisDocs),
        })),
        prerequisites: output.prerequisites.map((p) => ({
          name: p.name,
          description: p.description,
          topicNames: p.topicNames,
        })),
        topicsByName,
        documentIds: analysisDocs.map((d) => d.id),
      },
      output.language ?? language,
      {
        analysisId,
        promptVersion,
        sourceHash,
        schemaVersion: COURSE_ANALYSIS_SCHEMA_VERSION,
        derivedFromStructureVersion,
        derivedFromStructureHash,
        inputCoverage: 'complete',
        inputParts: segments.length,
        // Committed inside the same transaction as the new analysis, so a
        // re-pointed reference can never land without its content.
        ...(options.sideWrites ? { sideWrites: options.sideWrites } : {}),
      },
    )

    onProgress?.({ stage: 'done', progress: 100, message: t('analysis.complete') })
    return this.analyses
  }

  /**
   * Analyse each part of the course, at most `ANALYSIS_CONCURRENCY` at a time,
   * returning the outputs in part order. Any failure fails the whole run, so a
   * partial analysis is never stored.
   */
  private async analyzeSegments(
    segments: AnalysisSegment[],
    format: ChunkFormatter,
    context: {
      projectId: string
      subject: Parameters<typeof prompts.subjectProfile.withSubject>[1]
      language: 'zh' | 'en' | 'mixed'
      documentNames: string[]
      signal?: AbortSignal
      onProgress?: AnalysisProgressListener
    },
  ): Promise<DocumentAnalysisOutput[]> {
    const total = segments.length
    const outputs: DocumentAnalysisOutput[] = new Array(total)
    let next = 0
    let done = 0
    let failed = false
    const worker = async () => {
      while (!failed && next < total) {
        const index = next++
        const segment = segments[index]!
        try {
          outputs[index] = await this.requestAnalysis(
            [
              {
                role: 'system',
                content: prompts.subjectProfile.withSubject(prompts.documentAnalyzer.buildSystemPrompt(), context.subject),
              },
              {
                role: 'user',
                content: prompts.documentAnalyzer.buildUserPrompt({
                  documentName:
                    total === 1 ? context.documentNames.join(', ') : segment.documents.map((d) => d.name).join(', '),
                  documentText: segmentText(segment, format),
                  language: context.language,
                  ...(total > 1 ? { part: { index: index + 1, total, label: segment.label } } : {}),
                }),
              },
            ],
            { projectId: context.projectId, part: index + 1, parts: total, ...(context.signal ? { signal: context.signal } : {}) },
          )
        } catch (err) {
          // Stop handing out parts; the run fails as a whole.
          failed = true
          throw err
        }
        done++
        if (total > 1) {
          context.onProgress?.({
            stage: 'analyzing',
            progress: 30 + Math.floor((done / total) * 50),
            message: t('stage.askingAiPart', { current: done, total }),
          })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, total) }, worker))
    return outputs
  }

  /** One analyzer request: stream, check the shape, normalise. */
  private async requestAnalysis(
    messages: ChatMessage[],
    context: { projectId: string; part: number; parts: number; signal?: AbortSignal },
  ): Promise<DocumentAnalysisOutput> {
    const { projectId } = context
    // Structured output needs far more room than a chat reply.
    const maxTokens = Math.max(this.ai.maxOutputTokens, ANALYSIS_MIN_OUTPUT_TOKENS)
    const promptChars = messages.reduce((total, m) => total + m.content.length, 0)
    const requestStartedAt = Date.now()
    logger.debug('AI analysis request started', {
      projectId,
      part: context.part,
      parts: context.parts,
      provider: this.ai.currentProvider.id,
      streaming: true,
      promptChars,
      estimatedTokens: Math.round(promptChars / 3),
      maxTokens,
    })

    // Streamed, not buffered: a structured analysis can take minutes to
    // generate, and a non-streaming request must finish entirely within the
    // request budget.
    const { data, raw } = await this.ai.streamJSON<unknown>(messages, undefined, {
      maxTokens,
      ...(context.signal ? { signal: context.signal } : {}),
    })

    // Structured diagnostics. Sizes, keys and short snippets only — never the
    // API key, and never the full course text.
    const parsedRecord = asRecord(data)
    logger.debug('AI analysis response', {
      projectId,
      part: context.part,
      responseChars: raw.content.length,
      finishReason: raw.finishReason,
      prefix: raw.content.slice(0, 160),
      suffix: raw.content.slice(-160),
      topLevelKeys: parsedRecord ? Object.keys(parsedRecord).slice(0, 20) : null,
      topics: describeCollection(parsedRecord, 'topics'),
      concepts: describeCollection(parsedRecord, 'concepts'),
      formulas: describeCollection(parsedRecord, 'formulas'),
      symbols: describeCollection(parsedRecord, 'symbols'),
    })

    // A response that carries none of the expected collections is a schema
    // mismatch, not an empty analysis. Reporting it beats silently telling
    // the user "analysis complete: 0 topics".
    if (parsedRecord && !ANALYSIS_COLLECTION_KEYS.some((key) => key in parsedRecord)) {
      const found = Object.keys(parsedRecord).slice(0, 8).join(', ')
      throw new AppError(t('errors.analysisSchemaMismatch', { keys: found || '(none)' }), 'MALFORMED_ANALYSIS')
    }

    // Validate + sanitise before anything reaches the database.
    const output = normalizeDocumentAnalysis(data)
    logger.info('Document analysis completed', {
      projectId,
      part: context.part,
      model: raw.model,
      durationMs: Date.now() - requestStartedAt,
      promptTokens: raw.usage?.promptTokens,
      completionTokens: raw.usage?.completionTokens,
      finishReason: raw.finishReason,
      topics: output.topics.length,
      formulas: output.formulas.length,
      symbols: output.symbols.length,
    })
    return output
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

interface StructureRef {
  chapterId?: string
  sectionId?: string
  chapterNumber?: string
  sectionNumber?: string
  chapterTitle?: string
  sectionTitle?: string
}

/** The textbook position of one chunk — the model never gets to renumber the book. */
function structureOf(chunk: DocumentChunk): StructureRef {
  return {
    ...(chunk.chapterId ? { chapterId: chunk.chapterId } : {}),
    ...(chunk.sectionId ? { sectionId: chunk.sectionId } : {}),
    ...(chunk.chapterNumber ? { chapterNumber: chunk.chapterNumber } : {}),
    ...(chunk.sectionNumber ? { sectionNumber: chunk.sectionNumber } : {}),
    ...(chunk.chapterTitle ? { chapterTitle: chunk.chapterTitle } : {}),
    ...(chunk.sectionTitle ? { sectionTitle: chunk.sectionTitle } : {}),
  }
}

/** Textbook structure a topic without valid sources best matches, by deterministic token overlap. */
function bestStructureRef(
  query: string,
  chunks: Array<{ chunk: DocumentChunk; tokens: Set<string> }>,
): StructureRef {
  // `overlapScore`, with each chunk tokenised once by the caller: a long
  // textbook has thousands of chunks and many topics.
  const queryTokens = new Set(tokenize(query))
  let best: { chunk: DocumentChunk; score: number } | null = null
  for (const { chunk, tokens } of chunks) {
    let score = 0
    if (queryTokens.size > 0 && tokens.size > 0) {
      let shared = 0
      for (const token of queryTokens) if (tokens.has(token)) shared++
      score = shared / Math.min(queryTokens.size, tokens.size)
    }
    if (!best || score > best.score) best = { chunk, score }
  }
  if (!best || best.score <= 0) return {}
  return structureOf(best.chunk)
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