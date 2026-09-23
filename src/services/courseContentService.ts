import { CourseContentRepository } from '@/entities/courseContent/repository'
import {
  detectAffectedStructure,
  EMPTY_AFFECTED_STRUCTURE,
  isEmptyAffected,
  type AffectedStructure,
} from '@/entities/courseContent/incremental'
import {
  isPlanNoop,
  planContentDependencies,
  planNeedsFullReanalysis,
  type IncrementalOp,
} from '@/entities/courseContent/dependency'
import {
  buildTopicDependency,
  buildCandidateChunkLabel,
  chunkFingerprintMap,
  validateTopicSourceChunks,
} from '@/entities/courseContent/topicDependency'
import {
  AnalysisScopeUnsupportedError,
  isAnalysisScopeImplemented,
  type AnalysisScope,
  type AnalysisScopeReason,
  type CourseContentFreshness,
  type CourseContentManifest,
  type CourseContentStatus,
} from '@/entities/courseContent/types'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { PracticeService } from './practiceService'
import { CourseContextService } from './courseContextService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { AtomicSideWrites } from '@/entities/courseAnalysis/repository'
import type { CourseStructure } from '@/entities/courseStructure/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { normalizeTopicAnalysis } from '@/infrastructure/ai/prompts/topic-analyzer/normalize'
import { normalizeMathNotation } from '@/infrastructure/files/mathNotation'
import { buildAIServices } from './aiServices'
import type { AIService } from './aiService'
import { ANALYSIS_MIN_OUTPUT_TOKENS, type DocumentAnalysisProgress } from './documentAnalysisService'
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
  /** Tiered operations, including the ones that need no work. */
  ops: IncrementalOp[]
  /**
   * True when every affected topic carries a locally validated dependency, so
   * a chapter/section scope can be executed without touching other topics.
   */
  executable: boolean
  /** Why the plan cannot be executed locally, when `executable` is false. */
  blockedReason?: AnalysisScopeReason
  /**
   * `local` when the plan can run as a scoped update; `project` when the only
   * safe option is a full re-analysis.
   */
  executionScope: 'project' | 'local'
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
  /** Defaults to the whole project. */
  scope?: AnalysisScope
}

export interface IncrementalExecutionResult {
  /** True only when the transaction committed. */
  committed: boolean
  scope: AnalysisScope
  ops: IncrementalOp[]
  regeneratedTopicIds: string[]
  /** Topics the model could not supply a verifiable dependency for. */
  flaggedForFullReanalysis: string[]
  /** Topics the run deliberately left untouched, with the reason. */
  skipped: Array<{ topicId: string; reason: string }>
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

/** Test helper �?drops any pending deduplication entry. */
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
  private contexts: CourseContextRepository
  private practice: PracticeService
  private analyses: CourseAnalysisRepository
  private courseContext: CourseContextService

  constructor(
    deps: {
      content?: CourseContentRepository
      contexts?: CourseContextRepository
      practice?: PracticeService
      analyses?: CourseAnalysisRepository
      courseContext?: CourseContextService
    } = {},
  ) {
    this.content = deps.content ?? new CourseContentRepository()
    this.contexts = deps.contexts ?? new CourseContextRepository()
    this.practice = deps.practice ?? new PracticeService()
    this.analyses = deps.analyses ?? new CourseAnalysisRepository()
    this.courseContext = deps.courseContext ?? new CourseContextService()
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
   * Planning only �?it reads, it never writes and never calls the AI.
   */
  async planIncrementalUpdate(projectId: string): Promise<IncrementalPlan> {
    const freshness = await this.content.isFresh(projectId)
    if (freshness.fresh) {
      return {
        mode: 'none',
        freshness,
        affected: EMPTY_AFFECTED_STRUCTURE,
        ops: [],
        executable: false,
        executionScope: 'project',
      }
    }

    const [nodes, chunks, topics, context, practiceQuestions] = await Promise.all([
      this.content.listAllNodes(projectId),
      this.content.listProjectChunks(projectId),
      this.content.getTopics(projectId),
      this.contexts.get(projectId),
      this.practice.listQuestionsByProject(projectId),
    ])

    if (nodes.length === 0) {
      return {
        mode: 'full',
        freshness,
        affected: EMPTY_AFFECTED_STRUCTURE,
        ops: [],
        executable: false,
        blockedReason: 'structure-ambiguous',
        executionScope: 'project',
      }
    }

    const report = planContentDependencies({
      nodes,
      chunks,
      topics,
      noteLinks: context?.noteLinks ?? [],
      lectureLinks: context?.lectureLinks ?? [],
      practiceQuestions,
    })

    const regeneratable = report.ops.filter((op) => op.kind === 'regenerateTopic').length
    // A dependency that was re-pointed by identical content needs no AI, but it
    // still has to be persisted — so it counts as executable work.
    const relinkable = report.ops.filter(
      (op) => op.kind === 'relinkOnly' && op.entity === 'topic' && op.inputChunkIds.length > 0,
    ).length
    const blocked = planNeedsFullReanalysis(report.ops)
    const incremental = (regeneratable > 0 || relinkable > 0) && !blocked

    return {
      mode: incremental ? 'incremental' : 'full',
      freshness,
      affected: report.affected,
      ops: report.ops,
      executable: incremental,
      ...(blocked ? { blockedReason: 'dependencies-missing' as const } : {}),
      executionScope: incremental ? 'local' : 'project',
    }
  }

  /**
   * Analyse the project when its persisted content is missing or stale.
   *
   * Intended to be called from the upload / processing flow �?never from a
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
   * `project` runs the full analyzer. `chapter` / `section` run a **scoped,
   * local** update �?but only when every affected topic carries a locally
   * validated dependency. Otherwise the call is refused with a structured
   * reason; it never silently degrades to a whole-project analysis.
   */
  async analyzeScope(
    scope: AnalysisScope,
    options: EnsureAnalyzedOptions = {},
  ): Promise<EnsureAnalyzedResult | IncrementalExecutionResult> {
    if (scope.type === 'project') {
      return this.ensureAnalyzed(scope.projectId, options)
    }
    return this.executeIncrementalScope(scope, options)
  }

  /**
   * Execute a chapter- or section-scoped update.
   *
   * Stages every regenerated topic in memory, re-validates the inputs, and only
   * then commits everything in one transaction. Nothing is written before the
   * whole run has succeeded.
   */
  async executeIncrementalScope(
    scope: Exclude<AnalysisScope, { type: 'project' }>,
    options: EnsureAnalyzedOptions = {},
  ): Promise<IncrementalExecutionResult> {
    const { projectId } = scope
    const nodes = await this.content.listAllNodes(projectId)
    const targetNodeId = scope.type === 'chapter' ? scope.chapterId : scope.sectionId
    const target = nodes.find((node) => node.id === targetNodeId)
    if (!target) {
      throw new AnalysisScopeUnsupportedError(
        t('errors.analysisScopeUnsupported'),
        'structure-ambiguous',
      )
    }

    const plan = await this.planIncrementalUpdate(projectId)
    if (!plan.executable) {
      throw new AnalysisScopeUnsupportedError(
        t('errors.analysisScopeUnsupported'),
        plan.blockedReason ?? 'dependencies-missing',
      )
    }

    const regeneratableOps = plan.ops.filter(
      (op): op is IncrementalOp & { entity: 'topic' } =>
        op.kind === 'regenerateTopic' && op.entity === 'topic',
    )
    // Re-pointing a dependency needs no AI at all.
    const relinkOps = plan.ops.filter(
      (op) => op.kind === 'relinkOnly' && op.entity === 'topic' && op.inputChunkIds.length > 0,
    )
    if (regeneratableOps.length === 0 && relinkOps.length === 0) {
      return {
        committed: false,
        scope,
        ops: plan.ops,
        regeneratedTopicIds: [],
        flaggedForFullReanalysis: [],
        skipped: [],
      }
    }

    const services = regeneratableOps.length > 0 ? await buildAIServices() : null
    if (regeneratableOps.length > 0 && !services) {
      return {
        committed: false,
        scope,
        ops: plan.ops,
        regeneratedTopicIds: [],
        flaggedForFullReanalysis: [],
        skipped: [{ topicId: '*', reason: 'no-provider' }],
      }
    }

    // Everything below reads a consistent snapshot; the pre-commit check makes
    // sure it is still the same snapshot when we write.
    const before = await this.snapshotVersions(projectId)
    const chunks = await this.content.listProjectChunks(projectId)
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]))
    const topics = await this.content.getTopics(projectId)
    const topicById = new Map(topics.map((topic) => [topic.id, topic]))
    // Regenerated content must stay in the project's teaching language.
    const analysis = await this.content.getAnalysis(projectId)
    const analysisLanguage = analysis?.language ?? 'en'

    const updates = []
    const relinkedTopics: Topic[] = []
    const regeneratedTopicIds: string[] = []
    const flaggedForFullReanalysis: string[] = []
    const skipped: Array<{ topicId: string; reason: string }> = []

    // Re-pointed dependencies need no AI at all �?the content fingerprint proved
    // the passage is the same, only its chunk id changed.
    for (const op of plan.ops) {
      if (op.kind !== 'relinkOnly' || op.entity !== 'topic' || op.inputChunkIds.length === 0) {
        continue
      }
      const topic = topicById.get(op.id)
      if (!topic) continue
      const dependency = buildTopicDependency(op.inputChunkIds, chunks)
      const next: Topic = {
        ...topic,
        sourceChunkIds: dependency.sourceChunkIds,
        sourceChapterIds: dependency.sourceChapterIds,
        sourceSectionIds: dependency.sourceSectionIds,
        dependencyHash: dependency.dependencyHash,
        sourceChunkFingerprints: chunkFingerprintMap(
          chunks.filter((chunk) => dependency.sourceChunkIds.includes(chunk.id)),
        ),
      }
      relinkedTopics.push(next)
    }

    for (const op of regeneratableOps) {
      const topic = topicById.get(op.id)
      if (!topic) {
        skipped.push({ topicId: op.id, reason: 'topic-missing' })
        continue
      }
      const candidateChunks = op.inputChunkIds
        .map((id) => chunkById.get(id))
        .filter((chunk): chunk is DocumentChunk => Boolean(chunk))
      if (candidateChunks.length === 0) {
        skipped.push({ topicId: op.id, reason: 'no-live-sources' })
        continue
      }

      const staged = await this.stageTopic(
        topic,
        candidateChunks,
        services!.ai,
        analysisLanguage,
        options.signal,
      )
      if (!staged) {
        flaggedForFullReanalysis.push(op.id)
        continue
      }
      updates.push(staged)
      regeneratedTopicIds.push(op.id)
    }

    if (updates.length === 0 && relinkedTopics.length === 0) {
      return {
        committed: false,
        scope,
        ops: plan.ops,
        regeneratedTopicIds: [],
        flaggedForFullReanalysis,
        skipped,
      }
    }

    // Pre-commit revalidation: if the material or the structure moved while we
    // were generating, abandon the run. The caller may retry.
    const after = await this.snapshotVersions(projectId)
    if (after.sourceHash !== before.sourceHash || after.structureHash !== before.structureHash) {
      throw new AppError(t('errors.incrementalConcurrentChange'), 'CONCURRENT_MODIFICATION')
    }

    // Stage the associated references — practice questions and the derived
    // context — in memory. Nothing is written here: they are committed by the
    // single transaction below, so a re-pointed reference can never become
    // visible without the content it belongs to.
    const sideWrites: AtomicSideWrites = {}
    const practiceQuestions = await this.practice.planChunkRelink(projectId)
    if (practiceQuestions.length > 0) sideWrites.practiceQuestions = practiceQuestions

    const stagedContext = await this.courseContext.stageDerived(projectId)
    if (stagedContext.changed) sideWrites.courseContext = stagedContext.context

    await this.analyses.applyTopicUpdates(projectId, updates, {
      ...(analysis
        ? {
            analysis: {
              ...analysis,
              sourceHash: after.sourceHash,
              derivedFromStructureVersion: after.structureVersion,
              derivedFromStructureHash: after.structureHash,
              finishedAt: Date.now(),
            },
          }
        : {}),
      relinkedTopics,
      ...(sideWrites.practiceQuestions || sideWrites.courseContext ? { sideWrites } : {}),
    })

    logger.info('Incremental course update committed', {
      projectId,
      scope: scope.type,
      regenerated: regeneratedTopicIds.length,
      flagged: flaggedForFullReanalysis.length,
      skipped: skipped.length,
      practiceRelinked: practiceQuestions.length,
      contextRewritten: Boolean(sideWrites.courseContext),
    })

    return {
      committed: true,
      scope,
      ops: plan.ops,
      regeneratedTopicIds,
      flaggedForFullReanalysis,
      skipped,
    }
  }

  /** One topic's worth of staged AI output, validated but not yet persisted. */
  private async stageTopic(
    topic: Topic,
    candidateChunks: DocumentChunk[],
    ai: AIService,
    language: 'zh' | 'en' | 'mixed',
    signal?: AbortSignal,
  ) {
    const chapterLabel = [topic.chapterNumber, topic.chapterTitle].filter(Boolean).join(' �?')
    const sectionLabel = [topic.sectionNumber, topic.sectionTitle].filter(Boolean).join(' �?')

    const messages = [
      { role: 'system' as const, content: prompts.topicAnalyzer.buildSystemPrompt() },
      {
        role: 'user' as const,
        content: prompts.topicAnalyzer.buildUserPrompt({
          topicName: topic.name,
          topicDescription: topic.description,
          language,
          ...(chapterLabel ? { chapterLabel } : {}),
          ...(sectionLabel ? { sectionLabel } : {}),
          chunks: candidateChunks.map((chunk) => ({
            id: chunk.id,
            label: buildCandidateChunkLabel(chunk).split(' · ').slice(1).join(' · '),
            text: normalizeMathNotation(chunk.text).text,
          })),
        }),
      },
    ]

    try {
      const { data } = await ai.chatJSON<unknown>(messages, {
        // A structured topic needs the same head-room as a full analysis.
        maxTokens: Math.max(ai.maxOutputTokens, ANALYSIS_MIN_OUTPUT_TOKENS),
        ...(signal ? { signal } : {}),
      })
      const output = normalizeTopicAnalysis(data)
      const dependency = validateTopicSourceChunks(output.topic.sourceChunkIds, candidateChunks)
      if (!dependency) {
        logger.warn('Incremental topic had no verifiable sources; flagging for full re-analysis', {
          topicId: topic.id,
        })
        return null
      }

      const now = Date.now()
      const topicRow: Topic = {
        ...topic,
        name: output.topic.name || topic.name,
        description: output.topic.description || topic.description,
        sourceChunkIds: dependency.sourceChunkIds,
        sourceChapterIds: dependency.sourceChapterIds,
        sourceSectionIds: dependency.sourceSectionIds,
        dependencyHash: dependency.dependencyHash,
        promptVersion: prompts.topicAnalyzer.VERSION,
        createdAt: topic.createdAt,
      }
      delete topicRow.needsFullReanalysis

      const topicIds = [topic.id]
      return {
        topic: topicRow,
        concepts: output.concepts.map((c) => ({
          id: crypto.randomUUID(),
          projectId: topic.projectId,
          name: c.name,
          definition: c.definition,
          ...(c.explanation ? { explanation: c.explanation } : {}),
          topicIds,
          sourceRefs: [],
          createdAt: now,
        })),
        formulas: output.formulas.map((f) => ({
          id: crypto.randomUUID(),
          projectId: topic.projectId,
          name: f.name,
          latex: f.latex,
          description: f.description,
          variables: f.variables,
          topicIds,
          sourceRefs: [],
          createdAt: now,
        })),
        symbols: output.symbols.map((s) => ({
          id: crypto.randomUUID(),
          projectId: topic.projectId,
          symbol: s.symbol,
          meaning: s.meaning,
          context: s.context,
          ...(s.unit ? { unit: s.unit } : {}),
          topicIds,
          sourceRefs: [],
          createdAt: now,
        })),
        examples: output.examples.map((e) => ({
          id: crypto.randomUUID(),
          projectId: topic.projectId,
          title: e.title,
          problem: e.problem,
          ...(e.solution ? { solution: e.solution } : {}),
          topicIds,
          sourceRefs: [],
          createdAt: now,
        })),
        exercises: output.exercises.map((e) => ({
          id: crypto.randomUUID(),
          projectId: topic.projectId,
          prompt: e.prompt,
          difficulty: e.difficulty,
          topicIds,
          sourceRefs: [],
          createdAt: now,
        })),
        prerequisites: output.prerequisites.map((p) => ({
          id: crypto.randomUUID(),
          projectId: topic.projectId,
          name: p.name,
          description: p.description,
          topicIds,
          createdAt: now,
        })),
      }
    } catch (err) {
      logger.warn('Incremental topic regeneration failed; keeping the stored topic', {
        topicId: topic.id,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  private async snapshotVersions(projectId: string) {
    const [sourceHash, structureHash, structureVersion] = await Promise.all([
      this.content.computeSourceHash(projectId),
      this.content.getStructureHash(projectId),
      this.content.getContentVersion(projectId),
    ])
    return { sourceHash, structureHash, structureVersion }
  }

  private async runEnsureAnalyzed(
    projectId: string,
    options: EnsureAnalyzedOptions,
  ): Promise<EnsureAnalyzedResult> {
    const scope: AnalysisScope = options.scope ?? { type: 'project', projectId }
    if (!isAnalysisScopeImplemented(scope)) {
      throw new AnalysisScopeUnsupportedError(
        t('errors.analysisScopeUnsupported'),
        'scope-not-implemented',
      )
    }

    const freshness = await this.content.isFresh(projectId)
    if (freshness.fresh) return { analyzed: false, reason: 'fresh' }

    // No API key is a distinct state from "analysis failed" �?it is simply
    // "not configured", and must never mark the stored analysis as failed.
    const services = await buildAIServices()
    if (!services) return { analyzed: false, reason: 'no-provider' }

    try {
      // Stage the practice re-pointing first: the full-analysis path commits it
      // inside the same transaction as the new analysis, so it can never land
      // on its own.
      const practiceQuestions = await this.practice.planChunkRelink(projectId)
      await services.documentAnalysis.analyzeProject(projectId, {
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(practiceQuestions.length > 0
          ? { sideWrites: { practiceQuestions } }
          : {}),
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

export { isPlanNoop, buildTopicDependency, isEmptyAffected, detectAffectedStructure }
