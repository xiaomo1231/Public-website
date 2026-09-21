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
   */
  chapterId?: string
  sectionId?: string
  chapterNumber?: string
  sectionNumber?: string
  chapterTitle?: string
  sectionTitle?: string
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