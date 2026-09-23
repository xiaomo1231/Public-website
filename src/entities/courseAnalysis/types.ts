import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'

export interface SourceReference {
  documentId: string
  documentName: string
  page?: number
  slideNumber?: number
  section?: string
  quote?: string
  /**
   * Chunk this reference was resolved from. Always set from local data —
   * never taken from the model's output.
   */
  chunkId?: string
}

export interface Topic {
  id: string
  projectId: string
  name: string
  description: string
  order: number
  sourceRefs: SourceReference[]
  /**
   * Where this teaching topic sits in the textbook structure. Topics may
   * regroup sections for teaching, but they must not override the textbook's
   * own chapters/sections.
   *
   * This is the **display / primary-ownership** position. It is NOT the
   * incremental dependency — see `sourceChunkIds` below.
   */
  chapterId?: string
  sectionId?: string
  chapterNumber?: string
  sectionNumber?: string
  chapterTitle?: string
  sectionTitle?: string
  /**
   * The authoritative incremental dependency: the exact chunks this topic was
   * derived from, chosen by the model **only** from the candidate ids the
   * analyzer put in front of it, then validated locally.
   *
   * A topic may legitimately span several chapters. Missing on rows written
   * before this field existed, which is why consumers must treat "absent" as
   * "unknown, needs a full re-analysis" rather than guessing.
   */
  sourceChunkIds?: string[]
  /** Chapters covered by `sourceChunkIds`, derived locally. */
  sourceChapterIds?: string[]
  /** Sections covered by `sourceChunkIds`, derived locally. */
  sourceSectionIds?: string[]
  /**
   * Fingerprint of the ordered `sourceChunkIds` plus their content. Lets an
   * incremental run tell "the dependency is unchanged" from "the dependency
   * changed but the ids happen to still exist".
   */
  dependencyHash?: string
  /**
   * Content fingerprint per source chunk id.
   *
   * Re-processing a document regenerates **every** chunk id, so a stored
   * `sourceChunkIds` entry goes stale even when the text is identical. This map
   * is what lets the dependency be re-pointed at the replacement chunk by
   * content instead of forcing a full re-analysis.
   */
  sourceChunkFingerprints?: Record<string, string>
  /**
   * Set when the dependency could not be established (no valid
   * `sourceChunkIds`, unmappable sources, or an ambiguous identity match).
   * Such a topic is kept and shown, but never regenerated incrementally.
   */
  needsFullReanalysis?: boolean
  /**
   * The prompt that produced *this* topic. A full analysis records the
   * document-analyzer version; an incremental regeneration records the
   * topic-analyzer version. Absent on rows written before per-topic versioning.
   */
  promptVersion?: string
  createdAt: number
}

export interface Concept {
  id: string
  projectId: string
  name: string
  definition: string
  explanation?: string
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface Formula {
  id: string
  projectId: string
  name: string
  latex: string
  description: string
  variables: Array<{ symbol: string; meaning: string }>
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface CourseSymbol {
  id: string
  projectId: string
  symbol: string
  meaning: string
  context: string
  unit?: string
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface Example {
  id: string
  projectId: string
  title: string
  problem: string
  solution?: string
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface CourseExercise {
  id: string
  projectId: string
  prompt: string
  difficulty: DifficultyLevel
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface Prerequisite {
  id: string
  projectId: string
  name: string
  description: string
  topicIds: string[]
  createdAt: number
}

export type AnalysisStatus = 'pending' | 'analyzing' | 'ready' | 'failed'

/**
 * Data-shape version of a stored analysis result.
 *
 * This is deliberately *not* the Dexie schema version: Dexie describes the
 * database structure, this describes the shape of the JSON the analyzer
 * produced. A breaking change to `CourseAnalysis` / `DocumentAnalysisOutput`
 * bumps this constant, which makes every stored analysis stale and triggers a
 * re-run instead of loading data the current code cannot read.
 */
export const COURSE_ANALYSIS_SCHEMA_VERSION = '1'

export interface CourseAnalysis {
  id: string
  projectId: string
  status: AnalysisStatus
  language: 'zh' | 'en' | 'mixed'
  progress: number
  errorMessage?: string
  documentIds: string[]
  topicCount: number
  formulaCount: number
  symbolCount: number
  startedAt: number
  finishedAt?: number
  /** Prompt version that produced this analysis. */
  promptVersion: string
  /**
   * Fingerprint of the textbook sources this analysis was derived from
   * (documents + their chunks). When the material changes, this no longer
   * matches the freshly computed hash and the analysis is stale.
   *
   * Optional for migration-friendliness: rows written before this field
   * existed simply read as stale.
   */
  sourceHash?: string
  /** Data-shape version — see `COURSE_ANALYSIS_SCHEMA_VERSION`. */
  schemaVersion?: string
  /**
   * `CourseStructure.version` this analysis was derived from. Lets a structure
   * change invalidate the analysis without comparing the whole tree.
   *
   * Superseded by `derivedFromStructureHash` when that is present: the version
   * number is coarse (it does not distinguish two structures whose revision
   * numbers collide), whereas the hash compares actual tree content.
   */
  derivedFromStructureVersion?: number
  /**
   * Content fingerprint of the detected structure this analysis was derived
   * from. Preferred over the version number when both sides have one.
   */
  derivedFromStructureHash?: string
  /**
   * Set when the app *knows* something invalidated the analysis (e.g. a source
   * document was removed). Staleness is normally derived from the fields above;
   * this records an explicit, out-of-band reason.
   */
  staleReason?: string
  staleAt?: number
}