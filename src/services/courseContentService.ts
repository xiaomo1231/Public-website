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
import {
  ANALYSIS_MIN_OUTPUT_TOKENS,
  type DocumentAnalysisProgress,
} from './documentAnalysisService'
import { AppError, isAppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import type { Subject } from '@/entities/project/types'
import { loadProjectSubject } from './projectSubject'
import { getDb, type AppDatabase } from '@/infrastructure/db/database'

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

export type EnsureAnalyzedReason = 'fresh' | 'no-provider' | 'no-documents' | 'failed' | 'analyzed'

export interface EnsureAnalyzedResult {
  analyzed: boolean
  reason: EnsureAnalyzedReason
  error?: string
  /** The original error for `failed`, so the UI can map it to an actionable hint. */
  cause?: unknown
}

export interface EnsureAnalyzedOptions {
  onProgress?: (progress: DocumentAnalysisProgress) => void
  signal?: AbortSignal
  /** Defaults to the whole project. */
  scope?: AnalysisScope
  /**
   * Re-analyse even when the stored analysis is fresh (the user's explicit
   * "re-analyse"). Still coalesced with any run already in flight.
   */
  force?: boolean
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
  /**
   * True only when every topic that needed work (in and outside the scope)
   * got it, so the analysis was stamped fresh. False ⇒ it stays stale.
   */
  complete?: boolean
}

/**
 * Concurrent `ensureAnalyzed` calls for the same project share one run.
 *
 * Module-level (not per instance) because the upload flow constructs a fresh
 * `CourseContentService` each time, so an instance field would not coalesce
 * anything. Same principle as the tutor lesson cache: one effective input set
 * means one request, and later callers await the first result.
 */
interface InFlightRun {
  promise: Promise<EnsureAnalyzedResult>
  /** Progress listeners of every caller sharing this run. */
  listeners: Set<(progress: DocumentAnalysisProgress) => void>
  /** A caller asked for `force` while a non-forced pass was running. */
  forceRequested: boolean
}

const inFlight = new Map<string, InFlightRun>()

/**
 * A shared run re-runs when material changed under it or a forced request
 * arrived mid-run; bounded so a project edited continuously cannot loop.
 */
const MAX_ANALYSIS_PASSES = 3

/** Test helper — drops any pending deduplication entry. */
export function clearEnsureAnalyzedInFlightForTesting(): void {
  inFlight.clear()
}

/** A run older than this with no live request in this tab was cut off. */
const INTERRUPTED_AFTER_MS = 5 * 60_000

/**
 * An analysis row left `analyzing` / `pending` by a tab that was closed
 * mid-run would read "processing" forever. Called once at start-up: rows with
 * no live request here that started a while ago become `failed` with an
 * actionable message, so the course offers a re-run. (A run still going in
 * another tab simply overwrites this when it finishes.)
 */
export async function recoverInterruptedAnalyses(
  db: AppDatabase = getDb(),
  now = Date.now(),
): Promise<number> {
  const stuck = await db.courseAnalyses
    .where('status')
    .anyOf(['analyzing', 'pending'])
    .filter((row) => !inFlight.has(row.projectId) && now - row.startedAt > INTERRUPTED_AFTER_MS)
    .toArray()
  for (const row of stuck) {
    await db.courseAnalyses.update(row.id, {
      status: 'failed',
      errorMessage: t('analysis.interrupted'),
      finishedAt: now,
    })
  }
  return stuck.length
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
   * Planning only — it reads, it never writes and never calls the AI.
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
    if (existing) {
      // Joiners share the run (and its progress). The run itself re-checks the
      // material when it finishes, so a caller whose upload landed after it
      // started still ends with an up-to-date analysis.
      if (options.onProgress) existing.listeners.add(options.onProgress)
      if (options.force) existing.forceRequested = true
      return existing.promise
    }

    const entry: InFlightRun = {
      promise: Promise.resolve({ analyzed: false, reason: 'fresh' }),
      listeners: new Set(options.onProgress ? [options.onProgress] : []),
      forceRequested: false,
    }
    const tracked = this.runPasses(projectId, options, entry).finally(() => {
      if (inFlight.get(projectId) === entry) inFlight.delete(projectId)
    })
    entry.promise = tracked
    inFlight.set(projectId, entry)
    return tracked
  }

  /**
   * One shared run: analyse, then — if the material changed while it ran, or a
   * caller forced a re-run during a non-forced pass — analyse once more.
   */
  private async runPasses(
    projectId: string,
    options: EnsureAnalyzedOptions,
    entry: InFlightRun,
  ): Promise<EnsureAnalyzedResult> {
    let force = Boolean(options.force)
    let result: EnsureAnalyzedResult = { analyzed: false, reason: 'fresh' }
    for (let pass = 0; pass < MAX_ANALYSIS_PASSES; pass += 1) {
      const startHash = await this.currentSourceHash(projectId)
      entry.forceRequested = false
      result = await this.runEnsureAnalyzed(projectId, {
        ...options,
        ...(force ? { force: true } : {}),
        onProgress: (progress) => {
          for (const listener of entry.listeners) listener(progress)
        },
      })
      if (result.reason === 'no-provider' || result.reason === 'no-documents') return result
      // A forced pass already re-read everything it could; another forced
      // request arriving meanwhile is the same request (e.g. a double click).
      const forcedAgain = entry.forceRequested && !force
      const endHash = await this.currentSourceHash(projectId)
      const materialChanged =
        startHash !== undefined && endHash !== undefined && endHash !== startHash
      if (!forcedAgain && !materialChanged) return result
      if (signalAborted(options.signal)) return result
      logger.info('Course material changed during analysis; running once more', {
        projectId,
        forcedAgain,
        materialChanged,
      })
      force = forcedAgain
    }
    return result
  }

  private async currentSourceHash(projectId: string): Promise<string | undefined> {
    try {
      return await this.content.computeSourceHash(projectId)
    } catch {
      return undefined
    }
  }

  /**
   * Analyse an explicit scope.
   *
   * `project` runs the full analyzer. `chapter` / `section` run a **scoped,
   * local** update — but only when every affected topic carries a locally
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

    // Only topics that touch the requested chapter/section are regenerated —
    // a scoped call must never spend AI work on (or rewrite) the rest of the
    // course. Pending topic work elsewhere keeps the analysis non-fresh.
    const inScope = topicScopeFilter(nodes, targetNodeId, await this.content.getTopics(projectId))
    const isTopicWork = (op: IncrementalOp) =>
      op.entity === 'topic' &&
      (op.kind === 'regenerateTopic' || (op.kind === 'relinkOnly' && op.inputChunkIds.length > 0))
    const outOfScopeWork = plan.ops.filter((op) => isTopicWork(op) && !inScope(op.id))
    const regeneratableOps = plan.ops.filter(
      (op): op is IncrementalOp & { entity: 'topic' } =>
        op.kind === 'regenerateTopic' && op.entity === 'topic' && inScope(op.id),
    )
    // Re-pointing a dependency needs no AI at all.
    const relinkOps = plan.ops.filter(
      (op) =>
        op.kind === 'relinkOnly' &&
        op.entity === 'topic' &&
        op.inputChunkIds.length > 0 &&
        inScope(op.id),
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

    // Re-pointed dependencies need no AI at all — the content fingerprint proved
    // the passage is the same, only its chunk id changed.
    for (const op of relinkOps) {
      const topic = topicById.get(op.id)
      if (!topic) {
        skipped.push({ topicId: op.id, reason: 'topic-missing' })
        continue
      }
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

    const subject = regeneratableOps.length > 0 ? await loadProjectSubject(projectId) : undefined
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
        subject,
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

    // The analysis may only be stamped with the current source/structure hashes
    // when *every* topic that needed work got it: a failed, skipped or flagged
    // topic — or pending work outside this scope — would otherwise sit behind
    // an analysis that reads fresh. In that case the regenerated topics are
    // still committed, but the analysis row keeps its old hashes, so it stays
    // stale and the rest is redone.
    const complete =
      flaggedForFullReanalysis.length === 0 && skipped.length === 0 && outOfScopeWork.length === 0
    if (!complete) {
      logger.info('Incremental update left work pending; the analysis stays stale', {
        projectId,
        flagged: flaggedForFullReanalysis.length,
        skipped: skipped.length,
        outOfScope: outOfScopeWork.length,
      })
    }

    await this.analyses.applyTopicUpdates(projectId, updates, {
      ...(analysis && complete
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
      complete,
    }
  }

  /** One topic's worth of staged AI output, validated but not yet persisted. */
  private async stageTopic(
    topic: Topic,
    candidateChunks: DocumentChunk[],
    ai: AIService,
    language: 'zh' | 'en' | 'mixed',
    subject: Subject | undefined,
    signal?: AbortSignal,
  ) {
    const chapterLabel = [topic.chapterNumber, topic.chapterTitle].filter(Boolean).join(' — ')
    const sectionLabel = [topic.sectionNumber, topic.sectionTitle].filter(Boolean).join(' — ')

    const messages = [
      {
        role: 'system' as const,
        content: prompts.subjectProfile.withSubject(
          prompts.topicAnalyzer.buildSystemPrompt(),
          subject,
        ),
      },
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
        promptVersion: prompts.subjectProfile.subjectPromptVersion(
          prompts.topicAnalyzer.VERSION,
          subject,
        ),
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
      // A cancelled run is not a per-topic failure: abandon the whole run so
      // nothing is committed.
      if (signal?.aborted || isAbortError(err)) throw err
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
    if (freshness.fresh && !options.force) return { analyzed: false, reason: 'fresh' }

    // No API key is a distinct state from "analysis failed" — it is simply
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
        ...(practiceQuestions.length > 0 ? { sideWrites: { practiceQuestions } } : {}),
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
      return { analyzed: false, reason: 'failed', error: message, cause: err }
    }
  }
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function isAbortError(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown } | null
  return e?.name === 'AbortError' || e?.code === 'ABORTED'
}

/**
 * Which topics touch a chapter/section scope: the target node, or any node
 * below it, appears among the topic's primary position or its validated
 * source chapters/sections.
 */
export function topicScopeFilter(
  nodes: ReadonlyArray<{ id: string; parentId?: string | null }>,
  targetNodeId: string,
  topics: ReadonlyArray<
    Pick<Topic, 'id' | 'chapterId' | 'sectionId' | 'sourceChapterIds' | 'sourceSectionIds'>
  >,
): (topicId: string) => boolean {
  const scopeNodes = new Set<string>([targetNodeId])
  // Walk down the flat tree until no new descendants appear.
  for (let grew = true; grew;) {
    grew = false
    for (const node of nodes) {
      if (node.parentId && scopeNodes.has(node.parentId) && !scopeNodes.has(node.id)) {
        scopeNodes.add(node.id)
        grew = true
      }
    }
  }
  const matching = new Set(
    topics
      .filter((topic) =>
        [
          topic.chapterId,
          topic.sectionId,
          ...(topic.sourceChapterIds ?? []),
          ...(topic.sourceSectionIds ?? []),
        ].some((id) => id !== undefined && scopeNodes.has(id)),
      )
      .map((topic) => topic.id),
  )
  return (topicId) => matching.has(topicId)
}

export { isPlanNoop, buildTopicDependency, isEmptyAffected, detectAffectedStructure }
