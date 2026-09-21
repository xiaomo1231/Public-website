import type { CourseAnalysis } from '../courseAnalysis/types'

/**
 * Course Content — the *logical* view of a project's persisted AI analysis and
 * textbook structure.
 *
 * There is no `content/` directory and no second database. This layer only
 * aggregates records that already live in Dexie (`courseAnalyses`, `topics`,
 * `courseStructures`, `chunks`, …) and answers one question the rest of the app
 * keeps asking: *is what we have on disk still current?*
 *
 * `CourseStructure` / `CourseStructureNode` remain the single source of truth
 * for the chapter/section hierarchy — this layer never copies it.
 */

/** Overall state of a project's persisted course content. */
export type CourseContentStatus =
  | 'missing'
  | 'processing'
  | 'ready'
  | 'stale'
  | 'error'

/** Why a stored analysis can no longer be trusted. */
export type CourseContentStaleReason =
  | 'missing'
  | 'incomplete'
  | 'source-changed'
  | 'prompt-changed'
  | 'schema-changed'
  | 'structure-changed'
  | 'analysis-failed'

export interface CourseContentFreshness {
  fresh: boolean
  reasons: CourseContentStaleReason[]
  /**
   * Free-form annotation recorded by `markStale`. Purely explanatory: it never
   * decides freshness on its own.
   */
  detail?: string
}

/**
 * The versions a stored analysis is compared against.
 *
 * Four independent concepts, deliberately not collapsed into one field:
 *   - `sourceHash`      — fingerprint of the analysis *input* (content)
 *   - `promptVersion`   — which analyzer prompt produced the result
 *   - `schemaVersion`   — the stored result's data shape
 *   - `structureVersion`/`structureHash` — the textbook structure revision
 */
export interface CourseContentVersions {
  sourceHash: string
  promptVersion: string
  schemaVersion: string
  structureVersion: number
  /** Content fingerprint of the detected structure; `''` when there is none. */
  structureHash: string
}

/**
 * Aggregate description of a project's persisted course content.
 *
 * Built on demand from existing rows; it is deliberately not a table.
 */
export interface CourseContentManifest {
  projectId: string
  status: CourseContentStatus
  /** Fingerprint of the sources the stored analysis was derived from. */
  sourceHash: string
  analysisPromptVersion: string
  analysisSchemaVersion: string
  /** `CourseStructure.version` of the project's primary structure (0 = none). */
  structureVersion: number
  /** Content fingerprint of the project's structure; `''` when there is none. */
  structureHash: string
  updatedAt: number
  topicCount: number
  formulaCount: number
  symbolCount: number
  documentIds: string[]
  /** Why the stored content is stale (empty when it is fresh). */
  staleReasons: CourseContentStaleReason[]
  /** Annotation recorded by `markStale`, surfaced for diagnostics. */
  staleDetail?: string
}

/** What a single analysis run is allowed to cover. */
export type AnalysisScope =
  | { type: 'project'; projectId: string }
  | { type: 'chapter'; projectId: string; chapterId: string }
  | { type: 'section'; projectId: string; sectionId: string }

/**
 * Scopes the analyzer can actually execute today.
 *
 * Only `project` is implemented. A `chapter` / `section` scope is a valid
 * *plan* (`planIncrementalUpdate`) but must not be silently executed as a
 * whole-project run, so callers are rejected instead.
 */
export const IMPLEMENTED_ANALYSIS_SCOPES = ['project'] as const

export function isAnalysisScopeImplemented(scope: AnalysisScope): boolean {
  return scope.type === 'project'
}

type FreshnessInput = Pick<
  CourseAnalysis,
  | 'sourceHash'
  | 'promptVersion'
  | 'schemaVersion'
  | 'derivedFromStructureVersion'
  | 'derivedFromStructureHash'
  | 'status'
  | 'staleReason'
>

/**
 * Does the stored result's structure dependency differ from the current one?
 *
 * The content fingerprint is authoritative whenever both sides have one, so a
 * revision bump that does not actually change the tree cannot invalidate an
 * analysis. Older rows (no stored hash) fall back to the coarse revision
 * number.
 */
function structureDiffers(saved: FreshnessInput, current: CourseContentVersions): boolean {
  if (current.structureHash !== '') {
    if (saved.derivedFromStructureHash) {
      return saved.derivedFromStructureHash !== current.structureHash
    }
    return saved.derivedFromStructureVersion !== current.structureVersion
  }
  // No structure at all: nothing can be out of date structurally.
  return false
}

/**
 * Compare a stored analysis against the current versions.
 *
 * Pure: no storage access, so it is trivially testable and can never be
 * affected by presentation state (theme, UI language, layout …) or by dynamic
 * learning state (class progress, practice attempts).
 *
 * `staleReason` is **not** an input. Staleness is always derived from the
 * version fields; the annotation is only carried through as `detail` once the
 * result is already known to be stale.
 */
export function evaluateFreshness(
  saved: FreshnessInput | undefined,
  current: CourseContentVersions,
): CourseContentFreshness {
  if (!saved) return { fresh: false, reasons: ['missing'] }

  const reasons: CourseContentStaleReason[] = []
  if (!saved.sourceHash || saved.sourceHash !== current.sourceHash) {
    reasons.push('source-changed')
  }
  if (saved.promptVersion !== current.promptVersion) reasons.push('prompt-changed')
  if ((saved.schemaVersion ?? '') !== current.schemaVersion) reasons.push('schema-changed')
  if (structureDiffers(saved, current)) reasons.push('structure-changed')
  if (saved.status === 'failed') reasons.push('analysis-failed')
  else if (saved.status !== 'ready') reasons.push('incomplete')

  return {
    fresh: reasons.length === 0,
    reasons,
    ...(saved.staleReason && reasons.length > 0 ? { detail: saved.staleReason } : {}),
  }
}
