import { CourseContentRepository } from '@/entities/courseContent/repository'
import {
  detectAffectedStructure,
  EMPTY_AFFECTED_STRUCTURE,
  isEmptyAffected,
  type AffectedStructure,
} from '@/entities/courseContent/incremental'
import {
  isAnalysisScopeImplemented,
  type AnalysisScope,
  type CourseContentFreshness,
  type CourseContentManifest,
  type CourseContentStatus,
} from '@/entities/courseContent/types'
import type { CourseStructure } from '@/entities/courseStructure/types'
import { buildAIServices } from './aiServices'
import type { DocumentAnalysisProgress } from './documentAnalysisService'
import { AppError, isAppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

/** How a re-analysis would have to be run. */
export type IncrementalMode = 'none' | 'full' | 'incremental'

export interface IncrementalPlan {
  mode: IncrementalMode
  freshness: CourseContentFreshness
  /** Which chapters/sections the change touches (empty for `full`). */
  affected: AffectedStructure
  /**
   * How the plan would actually be executed today.
   *
   * Always `'project'`: a chapter/section-scoped plan is a *planning* result,
   * not something the analyzer can run yet. Do not read `mode: 'incremental'`
   * as "incremental generation is implemented".
   */
  executionScope: 'project'
}

export type EnsureAnalyzedReason =
  | 'fresh'
  | 'no-provider'
  | 'no-documents'
  | 'failed'
  | 'analyzed'

export interface EnsureAnalyzedResult {
  analyzed: boolean
  reason: EnsureAnalyzedReason
  error?: string
}

export interface EnsureAnalyzedOptions {
  onProgress?: (progress: DocumentAnalysisProgress) => void
  signal?: AbortSignal
  /** Defaults to the whole project. Only `project` is implemented today. */
  scope?: AnalysisScope
}

/**
 * Concurrent `ensureAnalyzed` calls for the same project share one run.
 *
 * Module-level (not per instance) because the upload flow constructs a fresh
 * `CourseContentService` each time, so an instance field would not coalesce
 * anything. Same principle as the tutor lesson cache: one effective input set
 * means one request, and later callers await the first result.
 */
const inFlight = new Map<string, Promise<EnsureAnalyzedResult>>()

/** Test helper — drops any pending deduplication entry. */
export function clearEnsureAnalyzedInFlightForTesting(): void {
  inFlight.clear()
}

/**
 * Orchestration around the persisted course content.
 *
 * Responsibilities:
 *   - answer freshness / manifest questions (delegated to the repository)
 *   - decide whether a re-analysis is needed and how wide it has to be
 *   - run the analysis as part of an *upload / processing* flow
 *
 * It never runs on page open: reading a project only ever reads.
 */
export class CourseContentService {
  private content: CourseContentRepository

  constructor(deps: { content?: CourseContentRepository } = {}) {
    this.content = deps.content ?? new CourseContentRepository()
  }

  getManifest(projectId: string): Promise<CourseContentManifest | null> {
    return this.content.getManifest(projectId)
  }

  getStatus(projectId: string): Promise<CourseContentStatus> {
    return this.content.getStatus(projectId)
  }

  isFresh(projectId: string): Promise<CourseContentFreshness> {
    return this.content.isFresh(projectId)
  }

  getStructure(projectId: string): Promise<CourseStructure | undefined> {
    return this.content.getStructure(projectId)
  }

  getContentVersion(projectId: string): Promise<number> {
    return this.content.getContentVersion(projectId)
  }

  markStale(projectId: string, reason: string): Promise<void> {
    return this.content.markStale(projectId, reason)
  }

  /**
   * Work out what a re-analysis would have to cover.
   *
   * `incremental` means the changed chunks map onto known chapters/sections;
   * `full` means the change cannot be attributed to part of the textbook.
   *
   * NOTE: this is planning only. The analyzer currently only implements a
   * project-level run, so `executionScope` is always `'project'`.
   */
  async planIncrementalUpdate(projectId: string): Promise<IncrementalPlan> {
    const freshness = await this.content.isFresh(projectId)
    if (freshness.fresh) {
      return {
        mode: 'none',
        freshness,
        affected: EMPTY_AFFECTED_STRUCTURE,
        executionScope: 'project',
      }
    }

    const [nodes, chunks] = await Promise.all([
      this.content.listAllNodes(projectId),
      this.content.listStructureChunks(projectId),
    ])
    if (nodes.length === 0) {
      return {
        mode: 'full',
        freshness,
        affected: EMPTY_AFFECTED_STRUCTURE,
        executionScope: 'project',
      }
    }

    const affected = detectAffectedStructure(nodes, chunks)
    return {
      mode: isEmptyAffected(affected) ? 'full' : 'incremental',
      freshness,
      affected,
      executionScope: 'project',
    }
  }

  /**
   * Analyse the project when its persisted content is missing or stale.
   *
   * Intended to be called from the upload / processing flow — never from a
   * page-open path. A failure leaves whatever was already stored untouched.
   *
   * Concurrent calls for the same project are coalesced: the second caller
   * awaits the first run instead of starting a second AI request.
   */
  ensureAnalyzed(
    projectId: string,
    options: EnsureAnalyzedOptions = {},
  ): Promise<EnsureAnalyzedResult> {
    const existing = inFlight.get(projectId)
    if (existing) return existing

    const run = this.runEnsureAnalyzed(projectId, options)
    const tracked = run.finally(() => {
      if (inFlight.get(projectId) === tracked) inFlight.delete(projectId)
    })
    inFlight.set(projectId, tracked)
    return tracked
  }

  /**
   * Analyse an explicit scope.
   *
   * The safety boundary for future incremental analysis: a chapter/section
   * scope is refused rather than silently executed as a whole-project run,
   * because the analyzer cannot yet replace a single chapter without risking
   * the existing Topic ↔ chapter / notes / transcript / practice links.
   */
  analyzeScope(
    scope: AnalysisScope,
    options: EnsureAnalyzedOptions = {},
  ): Promise<EnsureAnalyzedResult> {
    return this.ensureAnalyzed(scope.projectId, { ...options, scope })
  }

  private async runEnsureAnalyzed(
    projectId: string,
    options: EnsureAnalyzedOptions,
  ): Promise<EnsureAnalyzedResult> {
    const scope: AnalysisScope = options.scope ?? { type: 'project', projectId }
    if (!isAnalysisScopeImplemented(scope)) {
      throw new AppError(t('errors.analysisScopeUnsupported'), 'ANALYSIS_SCOPE_UNSUPPORTED')
    }

    const freshness = await this.content.isFresh(projectId)
    if (freshness.fresh) return { analyzed: false, reason: 'fresh' }

    // No API key is a distinct state from "analysis failed" — it is simply
    // "not configured", and must never mark the stored analysis as failed.
    const services = await buildAIServices()
    if (!services) return { analyzed: false, reason: 'no-provider' }

    try {
      await services.documentAnalysis.analyzeProject(projectId, {
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      })
      return { analyzed: true, reason: 'analyzed' }
    } catch (err) {
      if (isAppError(err) && err.code === 'NO_DOCUMENTS') {
        return { analyzed: false, reason: 'no-documents' }
      }
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('Course analysis failed; the previously saved content is still in use', {
        projectId,
        reasons: freshness.reasons,
        error: message,
      })
      return { analyzed: false, reason: 'failed', error: message }
    }
  }
}
