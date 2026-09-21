import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { CourseAnalysisRepository } from '../courseAnalysis/repository'
import type {
  Concept,
  CourseAnalysis,
  CourseExercise,
  CourseSymbol,
  Example,
  Formula,
  Prerequisite,
  Topic,
} from '../courseAnalysis/types'
import { COURSE_ANALYSIS_SCHEMA_VERSION } from '../courseAnalysis/types'
import { CourseStructureRepository } from '../courseStructure/repository'
import type { CourseStructure, CourseStructureNode } from '../courseStructure/types'
import { DocumentRepository } from '../document/repository'
import { ChunkRepository } from '../chunk/repository'
import type { DocumentChunk } from '../chunk/types'
import { prompts } from '@/infrastructure/ai/prompts'
import {
  evaluateFreshness,
  type CourseContentFreshness,
  type CourseContentManifest,
  type CourseContentStatus,
  type CourseContentVersions,
} from './types'
import {
  computeAnalysisSourceHash,
  computeStructureHash,
  selectAnalysisDocuments,
  toSourceDocumentFingerprint,
  type SourceDocumentFingerprint,
} from './sourceHash'

export interface CourseContentRepositoryDeps {  db?: AppDatabase
  analyses?: CourseAnalysisRepository
  structures?: CourseStructureRepository
  documents?: DocumentRepository
  chunks?: ChunkRepository
  /** Expected analyzer prompt version; defaults to the registered analyzer. */
  promptVersion?: string
  /** Expected data-shape version; defaults to `COURSE_ANALYSIS_SCHEMA_VERSION`. */
  schemaVersion?: string
}

/** Map a stored analysis + its derived freshness onto the public status. */
function resolveStatus(
  analysis: CourseAnalysis | undefined,
  fresh: boolean,
): CourseContentStatus {
  if (!analysis) return 'missing'
  if (analysis.status === 'analyzing' || analysis.status === 'pending') return 'processing'
  if (analysis.status === 'failed') return 'error'
  return fresh ? 'ready' : 'stale'
}

/**
 * Unified read access + freshness management for a project's persisted course
 * content.
 *
 * This is a *logical* layer over the existing Dexie entities — it owns no table
 * and stores no second copy of anything. Its scope is deliberately narrow:
 *
 *   course content aggregation + freshness + manifest + structure + analysis state
 *
 * It is **not** a god repository. Tutor lessons, practice, notes, transcripts,
 * quiz attempts, learning/class progress and visual sources keep their own
 * repositories and services; this class only reads the course-analysis entities
 * that make up the content itself.
 */
export class CourseContentRepository {
  private analyses: CourseAnalysisRepository
  private structures: CourseStructureRepository
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private expectedPromptVersion: string
  private expectedSchemaVersion: string

  constructor(deps: CourseContentRepositoryDeps = {}) {
    const db = deps.db ?? getDb()
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(db)
    this.structures = deps.structures ?? new CourseStructureRepository(db)
    this.documents = deps.documents ?? new DocumentRepository(db)
    this.chunks = deps.chunks ?? new ChunkRepository(db)
    this.expectedPromptVersion = deps.promptVersion ?? prompts.documentAnalyzer.VERSION
    this.expectedSchemaVersion = deps.schemaVersion ?? COURSE_ANALYSIS_SCHEMA_VERSION
  }

  // ---------------------------------------------------------------------
  // Analysis state
  // ---------------------------------------------------------------------

  getAnalysis(projectId: string): Promise<CourseAnalysis | undefined> {
    return this.analyses.getByProject(projectId)
  }

  // ---------------------------------------------------------------------
  // Read-only aggregation of the analysis entities
  // ---------------------------------------------------------------------

  getTopics(projectId: string): Promise<Topic[]> {
    return this.analyses.listTopics(projectId)
  }

  getConcepts(projectId: string): Promise<Concept[]> {
    return this.analyses.listConcepts(projectId)
  }

  getFormulas(projectId: string): Promise<Formula[]> {
    return this.analyses.listFormulas(projectId)
  }

  getSymbols(projectId: string): Promise<CourseSymbol[]> {
    return this.analyses.listSymbols(projectId)
  }

  getExamples(projectId: string): Promise<Example[]> {
    return this.analyses.listExamples(projectId)
  }

  getExercises(projectId: string): Promise<CourseExercise[]> {
    return this.analyses.listExercises(projectId)
  }

  getPrerequisites(projectId: string): Promise<Prerequisite[]> {
    return this.analyses.listPrerequisites(projectId)
  }

  getFormulasByTopic(topicId: string): Promise<Formula[]> {
    return this.analyses.listFormulasByTopic(topicId)
  }

  getSymbolsByTopic(topicId: string): Promise<CourseSymbol[]> {
    return this.analyses.listSymbolsByTopic(topicId)
  }

  // ---------------------------------------------------------------------
  // Structure (the single source of truth for the chapter/section hierarchy)
  // ---------------------------------------------------------------------

  listStructures(projectId: string): Promise<CourseStructure[]> {
    return this.structures.listByProject(projectId)
  }

  /** The project's primary structure: the highest version, newest first. */
  async getStructure(projectId: string): Promise<CourseStructure | undefined> {
    const structures = await this.structures.listByProject(projectId)
    return structures.sort((a, b) => b.version - a.version || b.updatedAt - a.updatedAt)[0]
  }

  getStructureNodes(structureId: string): Promise<CourseStructureNode[]> {
    return this.structures.listNodes(structureId)
  }

  /** Every structure node of the project, across all detected structures. */
  async listAllNodes(projectId: string): Promise<CourseStructureNode[]> {
    const structures = await this.structures.listByProject(projectId)
    const ordered = structures.slice().sort((a, b) => a.id.localeCompare(b.id))
    const nodes: CourseStructureNode[] = []
    for (const structure of ordered) {
      nodes.push(...(await this.structures.listNodes(structure.id)))
    }
    return nodes
  }

  /** Every chunk of the documents that back the project's structures. */
  async listStructureChunks(projectId: string): Promise<DocumentChunk[]> {
    const structures = await this.structures.listByProject(projectId)
    const lists = await Promise.all(
      structures.map((structure) => this.chunks.listByDocument(structure.sourceDocumentId)),
    )
    return lists.flat()
  }

  /**
   * Content fingerprint of the project's whole detected structure.
   *
   * Unlike the revision number, this is stable across structures and compares
   * actual tree content. Returns `''` when the project has no structure.
   */
  async getStructureHash(projectId: string): Promise<string> {
    const structures = await this.structures.listByProject(projectId)
    if (structures.length === 0) return ''
    const ordered = structures.slice().sort((a, b) => a.id.localeCompare(b.id))
    const nodes: CourseStructureNode[] = []
    for (const structure of ordered) {
      nodes.push(...(await this.structures.listNodes(structure.id)))
    }
    return computeStructureHash(nodes)
  }

  /**
   * Content version = the highest textbook structure revision.
   *
   * The structure is the structural source of truth, so its revision is the
   * number that advances when the course content itself changes. Returns 0 when
   * the project has no detected structure.
   *
   * Note: this is a *coarse* signal — with several textbook structures, a
   * change in the lower-numbered one may not move the maximum. `getStructureHash`
   * is the precise comparison and is preferred when available.
   */
  async getContentVersion(projectId: string): Promise<number> {
    const structures = await this.structures.listByProject(projectId)
    return structures.reduce((max, structure) => Math.max(max, structure.version), 0)
  }

  // ---------------------------------------------------------------------
  // Freshness
  // ---------------------------------------------------------------------

  /**
   * Fingerprint of the analysis *input* for this project.
   *
   * Built from the extracted chunk content of the selected documents, so
   * re-processing identical material does not count as a change.
   */
  async computeSourceHash(projectId: string): Promise<string> {
    const documents = await this.documents.listByProject(projectId)
    const selected = selectAnalysisDocuments(documents)
    const fingerprints: SourceDocumentFingerprint[] = []
    for (const doc of selected) {
      const chunks = await this.chunks.listByDocument(doc.id)
      fingerprints.push(toSourceDocumentFingerprint(doc, chunks))
    }
    return computeAnalysisSourceHash(fingerprints)
  }

  /** The versions the stored analysis is compared against right now. */
  async getVersions(
    projectId: string,
    overrides: Partial<CourseContentVersions> = {},
  ): Promise<CourseContentVersions> {
    const [sourceHash, structureVersion, structureHash] = await Promise.all([
      this.computeSourceHash(projectId),
      this.getContentVersion(projectId),
      this.getStructureHash(projectId),
    ])
    return {
      sourceHash: overrides.sourceHash ?? sourceHash,
      promptVersion: overrides.promptVersion ?? this.expectedPromptVersion,
      schemaVersion: overrides.schemaVersion ?? this.expectedSchemaVersion,
      structureVersion: overrides.structureVersion ?? structureVersion,
      structureHash: overrides.structureHash ?? structureHash,
    }
  }

  /**
   * Is the stored analysis still current?
   *
   * Freshness depends only on persisted source data and version constants —
   * never on theme, UI language, layout, class progress or practice attempts.
   */
  async isFresh(
    projectId: string,
    overrides: Partial<CourseContentVersions> = {},
  ): Promise<CourseContentFreshness> {
    const [analysis, current] = await Promise.all([
      this.analyses.getByProject(projectId),
      this.getVersions(projectId, overrides),
    ])
    return evaluateFreshness(analysis, current)
  }

  async getStatus(projectId: string): Promise<CourseContentStatus> {
    const analysis = await this.analyses.getByProject(projectId)
    if (!analysis) return 'missing'
    if (analysis.status === 'analyzing' || analysis.status === 'pending') return 'processing'
    if (analysis.status === 'failed') return 'error'
    const freshness = await this.isFresh(projectId)
    return freshness.fresh ? 'ready' : 'stale'
  }

  /** Aggregate view of the project's persisted content, or null when empty. */
  async getManifest(projectId: string): Promise<CourseContentManifest | null> {
    const analysis = await this.analyses.getByProject(projectId)
    const structure = await this.getStructure(projectId)
    if (!analysis && !structure) return null

    // One pass: `getVersions` already computes the structure hash, so the
    // manifest must not recompute it through `isFresh` as well.
    const current = await this.getVersions(projectId)
    const freshness = evaluateFreshness(analysis, current)

    return {
      projectId,
      status: resolveStatus(analysis, freshness.fresh),
      sourceHash: analysis?.sourceHash ?? '',
      analysisPromptVersion: analysis?.promptVersion ?? '',
      analysisSchemaVersion: analysis?.schemaVersion ?? '',
      structureVersion: structure?.version ?? 0,
      structureHash: current.structureHash,
      updatedAt: analysis?.finishedAt ?? analysis?.startedAt ?? 0,
      topicCount: analysis?.topicCount ?? 0,
      formulaCount: analysis?.formulaCount ?? 0,
      symbolCount: analysis?.symbolCount ?? 0,
      documentIds: analysis?.documentIds ?? [],
      staleReasons: freshness.reasons,
      ...(freshness.detail ? { staleDetail: freshness.detail } : {}),
    }
  }

  // ---------------------------------------------------------------------
  // Stale annotation (informational — never a freshness input)
  // ---------------------------------------------------------------------

  /**
   * Record *why* the stored analysis is considered stale.
   *
   * This is an annotation, not a switch: freshness is always derived from
   * `sourceHash` / `promptVersion` / `schemaVersion` / structure, so marking a
   * project here does not by itself make `isFresh` return false. It only adds
   * an explanatory `detail` to the freshness result. No-op when there is
   * nothing stored.
   */
  async markStale(projectId: string, reason: string): Promise<void> {
    const analysis = await this.analyses.getByProject(projectId)
    if (!analysis) return
    await this.analyses.upsert({ ...analysis, staleReason: reason, staleAt: Date.now() })
  }

  /** Drop a stale annotation once it no longer applies. */
  async clearStale(projectId: string): Promise<void> {
    const analysis = await this.analyses.getByProject(projectId)
    if (!analysis || (analysis.staleReason === undefined && analysis.staleAt === undefined)) return
    const next: CourseAnalysis = { ...analysis }
    delete next.staleReason
    delete next.staleAt
    await this.analyses.upsert(next)
  }
}
