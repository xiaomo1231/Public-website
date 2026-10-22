import type { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { FrameRevision } from '@/infrastructure/ai/prompts/homework-walkthrough/v3'
import { prompts } from '@/infrastructure/ai/prompts'
import { AbortedError, TimeoutError as AITimeoutError } from '@/infrastructure/ai/errors'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { HomeworkRepository } from '@/entities/homework/repository'
import { UserRepository } from '@/entities/user/repository'
import { isDeferredProfessorAnswer } from '@/entities/homework/answerMatching'
import { formatHomeworkReviewText } from '@/entities/homework/reviewFormatting'
import {
  classifyHomeworkError,
  isAccountFatalError,
  isRetryableHomeworkError,
  type HomeworkErrorKind,
} from '@/entities/homework/errorKind'
import { MIN_OUTPUT_TOKENS, planOutputBudget } from '@/entities/homework/tokenBudget'
import {
  checkLinearSystems,
  involvesRowReduction,
  type ClaimedLinearSystem,
} from '@/entities/homework/walkthroughChecks'
import {
  shouldSplitWalkthrough,
  walkthroughSubparts,
  type WalkthroughSubpart,
} from '@/entities/homework/splitQuestion'
import {
  detailedVariant,
  planWalkthrough,
  walkthroughId,
  walkthroughLanguage,
  type HomeworkWalkthrough,
  type WalkthroughLevel,
  type WalkthroughVariant,
  type WalkthroughVariantDraft,
  type WalkthroughDraft,
  type WalkthroughLanguage,
  type WalkthroughPart,
  type WalkthroughPlanEntry,
  type WalkthroughSection,
  type WalkthroughSectionVersion,
} from '@/entities/homework/walkthrough'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { SubjectContext } from '@/entities/project/types'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import {
  createGenerationRun,
  GenerationPausedError,
  isAbortError,
  type GenerationControl,
  type GenerationRun,
} from '@/shared/lib/generationControl'
import { t } from '@/i18n'
import { HomeworkService } from './homeworkService'
import { loadProjectSubjectContext } from './projectSubject'

/** Sections prepared at once (rate-limit safe). */
const SECTION_CONCURRENCY = 2
/** A long question (seven parts of row reduction) streams for a while. */
const SECTION_DEADLINE_MS = 240_000
/**
 * Every attempt of one section request together (retries, budget changes):
 * past this the section is saved as failed ("timed out, try again") and the
 * run moves on, instead of trying for 20+ minutes with no sign of life.
 */
export const SECTION_TOTAL_MS = 360_000
const SECTION_OUTPUT_CEILING = 8_192
const SECTION_OUTPUT_MAX = 16_384
/** Hard cap on paid requests for one section (budget changes + transient retries). */
const SECTION_MAX_ATTEMPTS = 6
const MAX_TRANSIENT_RETRIES = 2
const RETRY_BASE_DELAY_MS = 700
/**
 * How much of each question the opening / summary request sees: the question,
 * its conclusion and its key points — never the worked text, so the request
 * stays small however long the assignment is.
 */
const FRAME_QUESTION_CHARS = 800
const FRAME_CONCLUSION_CHARS = 1_000
const FRAME_KEY_POINT_CHARS = 600
/** How much of the sub-parts already written each later sub-part request sees. */
const PART_EARLIER_CHARS = 6_000
const PART_EARLIER_MIN_CHARS = 600
/** Longest revision request kept from the student. */
export const MAX_REVISION_SUGGESTION = 1_000

export interface WalkthroughState {
  set: HomeworkSet
  questions: HomeworkQuestion[]
  language: WalkthroughLanguage
  promptVersion: string
  walkthrough?: HomeworkWalkthrough
  plan: WalkthroughPlanEntry[]
}

export interface WalkthroughProgress {
  total: number
  done: number
  failed: number
  /** Section ids being written right now. */
  running: string[]
  /** Split questions: the sub-part being written, by section id (`b`). */
  parts?: Record<string, string>
  /** Set while one section is being regenerated on its own. */
  section?: {
    id: string
    split: boolean
    /** Only the 题目分析 is being written (补充题目分析). */
    analysis?: boolean
    /** The detailed version (详细版) is being written or rewritten. */
    variant?: boolean
  }
  /** Detailed versions (详细版) of several sections are being written. */
  variant?: boolean
  /** Sections on a second or later attempt, with why the last one failed. */
  attempts?: Record<string, SectionAttempt>
}

/** A section request being tried again. */
export interface SectionAttempt {
  /** 2 for the first retry. */
  attempt: number
  lastFailure: HomeworkErrorKind
}

export interface WalkthroughRunResult {
  generated: number
  failed: number
  /**
   * The run was paused or stopped before everything was written. The finished
   * sections are saved; `resume()` writes only what is left.
   */
  paused?: boolean
  /** The interruption was an immediate stop (in-flight requests aborted). */
  stopped?: boolean
  /** Set when the provider refused the account (no credit, bad key). */
  fatalError?: string
}

interface Run {
  promise: Promise<WalkthroughRunResult>
  progress: WalkthroughProgress
  control: GenerationControl
}

/** How a paused run ended, so the panel can offer 继续 and resume exactly. */
export interface WalkthroughPausedRun {
  stopped: boolean
  done: number
  total: number
  /**
   * A paused "regenerate everything" run: sections written at or after this
   * time were already rewritten by it and are not redone on resume.
   */
  forceSince?: number
  /** A paused run writing detailed versions (全部切到详细版); resume continues it. */
  variant?: { sectionIds?: string[] }
}

/** Module scope: services are rebuilt per page, a run must outlive that. */
const runs = new Map<string, Run>()
/** Paused runs, for this page visit (the saved sections themselves persist). */
const pausedRuns = new Map<string, WalkthroughPausedRun>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeWalkthroughRuns(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Sections were saved outside a run (an import): mounted panels re-read. */
export function notifyWalkthroughChanged(): void {
  emit()
}

/** The controller of the run in progress (pause / stop it from any mounted panel). */
export function walkthroughRunControl(setId: string): GenerationRun | undefined {
  const control = runs.get(setId)?.control
  return control && 'requestPause' in control ? (control as GenerationRun) : undefined
}

/** The run that was paused during this page visit, if any. */
export function walkthroughPausedRun(setId: string): WalkthroughPausedRun | undefined {
  const paused = pausedRuns.get(setId)
  return paused ? { ...paused } : undefined
}

export function walkthroughRunProgress(setId: string): WalkthroughProgress | undefined {
  const run = runs.get(setId)
  return run
    ? {
        ...run.progress,
        running: [...run.progress.running],
        ...(run.progress.parts ? { parts: { ...run.progress.parts } } : {}),
        ...(run.progress.section ? { section: { ...run.progress.section } } : {}),
        ...(run.progress.attempts ? { attempts: { ...run.progress.attempts } } : {}),
      }
    : undefined
}

/** Show (or, with `null`, clear) a section's retry state. */
function setAttempt(
  progress: WalkthroughProgress,
  ids: readonly string[],
  attempt: SectionAttempt | null,
): void {
  const next = { ...progress.attempts }
  for (const id of ids) {
    if (attempt) next[id] = attempt
    else delete next[id]
  }
  if (Object.keys(next).length > 0) progress.attempts = next
  else delete progress.attempts
  emit()
}

/** `1`, `2(a)` or `Problem 3` — how the walkthrough refers to a question. */
export function questionLabel(question: HomeworkQuestion, index: number): string {
  return question.number?.trim() || String(index + 1)
}

/**
 * The complete, document-style walkthrough of one homework assignment.
 *
 * Each question gets its own section (one request each, two at a time); the
 * opening "tools you need" and the closing summary come from one more request
 * that sees every question's conclusion. Every section is saved as soon as it
 * is ready, so a failure or a closed tab keeps what was finished, and a later
 * run only redoes what is missing, failed or out of date. A section that was
 * ready is never replaced by a failure.
 */
export class HomeworkWalkthroughService {
  private ai: AIService | null
  private db: AppDatabase
  private homework: HomeworkService
  private sets: HomeworkRepository
  private repo: WalkthroughRepository

  constructor(deps: { ai: AIService | null; db?: AppDatabase; homework?: HomeworkService }) {
    this.ai = deps.ai
    this.db = deps.db ?? getDb()
    this.homework = deps.homework ?? new HomeworkService({ ai: deps.ai, db: this.db })
    this.sets = new HomeworkRepository(this.db)
    this.repo = new WalkthroughRepository(this.db)
  }

  async state(setId: string): Promise<WalkthroughState> {
    const set = await this.sets.getSet(setId)
    if (!set) throw new NotFoundError('HomeworkSet', setId)
    // Retired questions (no longer in the assignment) are not part of the walkthrough.
    const questions = (await this.sets.listQuestions(setId)).filter((question) => !question.retired)
    const profile = await new UserRepository(this.db).get().catch(() => undefined)
    const language = walkthroughLanguage(profile?.questionLanguage, set.language)
    const subject = await loadProjectSubjectContext(set.projectId, this.db)
    const promptVersion = prompts.subjectProfile.subjectPromptVersion(
      // v2 without a revision block is byte-identical to v1, so caches keep their hashes.
      `homework-walkthrough/${prompts.homeworkWalkthrough.CACHE_VERSION}`,
      subject,
    )
    const walkthrough = await this.repo.get(walkthroughId(setId, language))
    return {
      set,
      questions,
      language,
      promptVersion,
      ...(walkthrough ? { walkthrough } : {}),
      plan: planWalkthrough(questions, walkthrough, language, promptVersion),
    }
  }

  isRunning(setId: string): boolean {
    return runs.has(setId)
  }

  /** An AI provider is configured (writing or rewriting is possible). */
  hasAI(): boolean {
    return this.ai !== null
  }

  /**
   * Write what is missing, failed or out of date (everything with `force`).
   * Concurrent calls for the same assignment share one run.
   */
  generate(
    setId: string,
    options: {
      force?: boolean
      /** With `force`: sections written at or after this time are kept. */
      forceSince?: number
      /** Pause / stop control; a run of its own is created when absent. */
      control?: GenerationControl
    } = {},
  ): Promise<WalkthroughRunResult> {
    const existing = runs.get(setId)
    if (existing) return existing.promise
    const control = options.control ?? createGenerationRun()
    const forceSince = options.force ? (options.forceSince ?? Date.now()) : undefined
    pausedRuns.delete(setId)
    const progress: WalkthroughProgress = { total: 0, done: 0, failed: 0, running: [] }
    const promise = this.run(setId, forceSince, progress, control)
      .then((result) => {
        if (result.paused) {
          pausedRuns.set(setId, {
            stopped: result.stopped === true,
            done: progress.done,
            total: progress.total,
            ...(forceSince !== undefined ? { forceSince } : {}),
          })
        }
        return result
      })
      .finally(() => {
        runs.delete(setId)
        emit()
      })
    runs.set(setId, { promise, progress, control })
    emit()
    return promise
  }

  /** Continue a paused run with only what is left (a plain update otherwise). */
  resume(
    setId: string,
    options: { control?: GenerationControl } = {},
  ): Promise<WalkthroughRunResult> {
    const paused = pausedRuns.get(setId)
    if (paused?.variant)
      return this.generateVariants(setId, {
        ...(paused.variant.sectionIds ? { sectionIds: paused.variant.sectionIds } : {}),
        ...(options.control ? { control: options.control } : {}),
      })
    return this.generate(setId, {
      ...(paused?.forceSince !== undefined ? { force: true, forceSince: paused.forceSince } : {}),
      ...(options.control ? { control: options.control } : {}),
    })
  }

  private async run(
    setId: string,
    forceSince: number | undefined,
    progress: WalkthroughProgress,
    control: GenerationControl,
  ): Promise<WalkthroughRunResult> {
    const ai = this.requireAI()
    const state = await this.state(setId)
    if (state.questions.length === 0)
      throw new AppError(t('homework.walkthrough.noQuestions'), 'VALIDATION_ERROR')
    const subject = await loadProjectSubjectContext(state.set.projectId, this.db)
    const base = {
      id: walkthroughId(setId, state.language),
      projectId: state.set.projectId,
      setId,
      language: state.language,
    }
    // A forced run redoes every section it has not rewritten yet, so a resumed
    // "regenerate everything" never redoes what it already wrote.
    const redo = (entry: WalkthroughPlanEntry): boolean =>
      entry.needsWork ||
      (forceSince !== undefined &&
        !(
          (entry.section?.status === 'ready' || entry.section?.status === 'insufficient') &&
          (entry.section?.generatedAt ?? 0) >= forceSince
        ))
    const questionEntries = state.plan.filter((entry) => entry.kind === 'question')
    const todo = questionEntries.filter(redo)
    const frameEntries = state.plan.filter((entry) => entry.kind !== 'question')
    const frameNeeded = todo.length > 0 || frameEntries.some(redo)
    progress.total = todo.length + (frameNeeded ? 1 : 0)
    emit()

    const result: WalkthroughRunResult = { generated: 0, failed: 0 }
    const labels = new Map(
      state.questions.map((question, index) => [question.id, questionLabel(question, index)]),
    )
    let fatal: string | undefined
    /** Parts left undone because the run was paused or stopped. */
    let interrupted = false
    /** The assignment was deleted during the run: stop asking, write nothing. */
    let gone = false
    const save = async (section: WalkthroughSection): Promise<void> => {
      if (!(await this.repo.putSection(base, section))) gone = true
    }

    const queue = [...todo]
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        if (fatal || gone) return
        // A pause lets the sections in flight finish; no new one starts.
        if (!control.shouldContinue()) {
          interrupted = true
          return
        }
        const entry = queue.shift()!
        progress.running.push(entry.id)
        emit()
        const label = labels.get(entry.question!.id) ?? '?'
        let aborted = false
        try {
          const section = await this.writeQuestion(ai, {
            entry,
            label,
            language: state.language,
            subject,
            control,
            mode: 'generate',
            // A resumed "rewrite everything" continues only its own drafts.
            ...(forceSince !== undefined ? { draftSince: forceSince } : {}),
            saveSection: save,
            onPart: (part) => {
              progress.parts = { ...progress.parts }
              if (part) progress.parts[entry.id] = part
              else delete progress.parts[entry.id]
              setAttempt(progress, [entry.id], null)
            },
            onAttempt: (attempt) => setAttempt(progress, [entry.id], attempt),
          })
          // "Not enough information" is a finished answer, not a failure.
          // The student's 普通 / 详细 choice outlives a rewrite.
          await save(withLevel(section, entry.section))
          result.generated += 1
        } catch (err) {
          if (isAbortError(err, control.signal)) {
            // Stopped: not a failure, nothing is written, it stays to do.
            aborted = true
            interrupted = true
            continue
          }
          const kind = classifyHomeworkError(err)
          if (isAccountFatalError(kind)) fatal = friendlyAIError(err)
          result.failed += 1
          progress.failed += 1
          // A finished section is never replaced by a failure; finished
          // sub-parts of a split question are kept for the next run.
          const latest = await this.storedSection(base.id, entry.id)
          if (latest?.status !== 'ready') {
            await save({
              ...failedSection(entry, label, friendlyAIError(err)),
              ...(latest?.draft ? { draft: latest.draft } : {}),
            })
          }
        } finally {
          progress.running = progress.running.filter((id) => id !== entry.id)
          if (progress.parts?.[entry.id]) {
            progress.parts = { ...progress.parts }
            delete progress.parts[entry.id]
          }
          if (!aborted) progress.done += 1
          setAttempt(progress, [entry.id], null)
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SECTION_CONCURRENCY, queue.length) }, () => worker()),
    )

    if (frameNeeded && !fatal && !gone && (interrupted || !control.shouldContinue())) {
      // The opening and summary come last; a paused run leaves them to do.
      interrupted = true
    } else if (frameNeeded && !fatal && !gone) {
      progress.running.push('overview', 'summary')
      emit()
      let aborted = false
      try {
        const frame = await this.writeFrame(ai, setId, state, labels, subject, {
          signal: control.signal,
          onAttempt: (attempt) => setAttempt(progress, ['overview', 'summary'], attempt),
        })
        if (frame) {
          for (const section of frame) await save(section)
          result.generated += 1
        }
      } catch (err) {
        if (isAbortError(err, control.signal)) {
          aborted = true
          interrupted = true
          return this.finishInterrupted(base.id, state, result, fatal, control)
        }
        if (isAccountFatalError(classifyHomeworkError(err))) fatal = friendlyAIError(err)
        result.failed += 1
        progress.failed += 1
        for (const entry of frameEntries) {
          if (entry.section?.status !== 'ready') {
            await save(failedSection(entry, entry.kind, friendlyAIError(err)))
          }
        }
      } finally {
        progress.running = []
        if (!aborted) progress.done += 1
        setAttempt(progress, ['overview', 'summary'], null)
      }
    }

    if (interrupted) return this.finishInterrupted(base.id, state, result, fatal, control)
    await this.repo.keepSections(base.id, new Set(state.plan.map((entry) => entry.id)))
    return fatal ? { ...result, fatalError: fatal } : result
  }

  /** End an interrupted run: the finished sections are saved, the rest stays to do. */
  private async finishInterrupted(
    id: string,
    state: WalkthroughState,
    result: WalkthroughRunResult,
    fatal: string | undefined,
    control: GenerationControl,
  ): Promise<WalkthroughRunResult> {
    await this.repo.keepSections(id, new Set(state.plan.map((entry) => entry.id)))
    return {
      ...result,
      paused: true,
      ...(control.signal.aborted ? { stopped: true } : {}),
      ...(fatal ? { fatalError: fatal } : {}),
    }
  }

  /** The stored version of one section (fresh, not the run's starting snapshot). */
  private async storedSection(
    id: string,
    sectionId: string,
  ): Promise<WalkthroughSection | undefined> {
    return (await this.repo.get(id))?.sections.find((section) => section.id === sectionId)
  }

  /**
   * Rewrite one section on its own, optionally following the student's
   * suggestion (the model sees the current version). The previous ready
   * version is kept for 恢复上一版; a stopped or failed rewrite leaves the
   * section exactly as it was (finished sub-parts of a split question are
   * kept as a draft, so 继续 writes only the rest).
   */
  regenerateSection(
    setId: string,
    sectionId: string,
    options: {
      suggestion?: string
      control?: GenerationControl
      /** The version shown: `detailed` rewrites only the detailed version. */
      level?: WalkthroughLevel
    } = {},
  ): Promise<WalkthroughRunResult> {
    if (runs.has(setId))
      return Promise.reject(new AppError(t('homework.walkthrough.busy'), 'VALIDATION_ERROR'))
    const control = options.control ?? createGenerationRun()
    const progress: WalkthroughProgress = {
      total: 1,
      done: 0,
      failed: 0,
      running: [sectionId],
      section: {
        id: sectionId,
        split: false,
        ...(options.level === 'detailed' ? { variant: true } : {}),
      },
    }
    const suggestion = options.suggestion?.trim().slice(0, MAX_REVISION_SUGGESTION) || undefined
    const run =
      options.level === 'detailed'
        ? this.regenerateDetailed(setId, sectionId, suggestion, progress, control)
        : this.regenerate(setId, sectionId, suggestion, progress, control)
    const promise = run.finally(() => {
      runs.delete(setId)
      emit()
    })
    runs.set(setId, { promise, progress, control })
    emit()
    return promise
  }

  private async regenerate(
    setId: string,
    sectionId: string,
    suggestion: string | undefined,
    progress: WalkthroughProgress,
    control: GenerationControl,
  ): Promise<WalkthroughRunResult> {
    const ai = this.requireAI()
    const state = await this.state(setId)
    const entry = state.plan.find((item) => item.id === sectionId)
    // Imported 「其它内容」 matches no question: there is nothing to rewrite it from.
    if (!entry || entry.kind === 'other') throw new NotFoundError('WalkthroughSection', sectionId)
    const subject = await loadProjectSubjectContext(state.set.projectId, this.db)
    const base = {
      id: walkthroughId(setId, state.language),
      projectId: state.set.projectId,
      setId,
      language: state.language,
    }
    const save = async (section: WalkthroughSection): Promise<void> => {
      await this.repo.putSection(base, section)
    }
    const current = entry.section?.status === 'ready' ? entry.section : undefined
    const labels = new Map(
      state.questions.map((question, index) => [question.id, questionLabel(question, index)]),
    )
    try {
      if (entry.kind === 'question') {
        const section = await this.writeQuestion(ai, {
          entry,
          label: labels.get(entry.question!.id) ?? '?',
          language: state.language,
          subject,
          control,
          mode: 'regenerate',
          ...(suggestion ? { suggestion } : {}),
          ...(current ? { current } : {}),
          saveSection: save,
          onPart: (part, done, total) => {
            progress.section = { id: sectionId, split: true }
            progress.total = total
            progress.done = done
            progress.parts = part ? { [sectionId]: part } : {}
            setAttempt(progress, [sectionId], null)
          },
          onAttempt: (attempt) => setAttempt(progress, [sectionId], attempt),
        })
        // "Not enough information" never replaces a ready section.
        if (section.status === 'insufficient' && current)
          throw new AppError(
            t('homework.walkthrough.insufficient', { reason: section.error ?? '' }),
            'INVALID_RESPONSE',
          )
        // Only the standard version is rewritten; the detailed one stays.
        await save(withLevel(withPrevious(section, current), current, true))
      } else {
        const frame = await this.writeFrame(
          ai,
          setId,
          state,
          labels,
          subject,
          {
            signal: control.signal,
            onAttempt: (attempt) => setAttempt(progress, [sectionId], attempt),
          },
          {
            target: entry.kind,
            ...(current ? { current: { body: frameText(current) } } : {}),
            ...(suggestion ? { suggestion } : {}),
          },
        )
        if (!frame)
          throw new AppError(t('homework.walkthrough.frameNeedsQuestions'), 'VALIDATION_ERROR')
        // The frame request returns both parts; only the requested one is saved.
        const next = frame.find((section) => section.id === sectionId)!
        await save(withPrevious(next, current))
      }
      progress.done = progress.total
      emit()
      return { generated: 1, failed: 0 }
    } catch (err) {
      if (isAbortError(err, control.signal))
        return {
          generated: 0,
          failed: 0,
          paused: true,
          ...(control.signal.aborted ? { stopped: true } : {}),
        }
      throw err
    }
  }

  /** Swap a section with the version its last regeneration replaced (toggles). */
  async restorePrevious(setId: string, sectionId: string): Promise<void> {
    if (runs.has(setId)) throw new AppError(t('homework.walkthrough.busy'), 'VALIDATION_ERROR')
    const state = await this.state(setId)
    const section = state.walkthrough?.sections.find((item) => item.id === sectionId)
    if (!section?.previous) throw new NotFoundError('WalkthroughSection', sectionId)
    await this.repo.putSection(
      {
        id: walkthroughId(setId, state.language),
        projectId: state.set.projectId,
        setId,
        language: state.language,
      },
      section.previous.level === 'detailed'
        ? swapDetailed(section)
        : withLevel(
            { ...applyVersion(section, section.previous), previous: versionOf(section) },
            section,
            true,
          ),
    )
  }

  /**
   * 补充题目分析: write only the analysis block of a ready question section
   * written before prompt v3 (one short request). The section's other text,
   * its hash and its previous version are untouched; a stop leaves it as it was.
   */
  addAnalysis(
    setId: string,
    sectionId: string,
    options: { control?: GenerationControl } = {},
  ): Promise<WalkthroughRunResult> {
    if (runs.has(setId))
      return Promise.reject(new AppError(t('homework.walkthrough.busy'), 'VALIDATION_ERROR'))
    const control = options.control ?? createGenerationRun()
    const progress: WalkthroughProgress = {
      total: 1,
      done: 0,
      failed: 0,
      running: [sectionId],
      section: { id: sectionId, split: false, analysis: true },
    }
    const promise = this.writeAnalysis(setId, sectionId, progress, control).finally(() => {
      runs.delete(setId)
      emit()
    })
    runs.set(setId, { promise, progress, control })
    emit()
    return promise
  }

  private async writeAnalysis(
    setId: string,
    sectionId: string,
    progress: WalkthroughProgress,
    control: GenerationControl,
  ): Promise<WalkthroughRunResult> {
    const ai = this.requireAI()
    const state = await this.state(setId)
    const entry = state.plan.find((item) => item.id === sectionId)
    if (!entry?.question || entry.section?.status !== 'ready')
      throw new NotFoundError('WalkthroughSection', sectionId)
    const subject = await loadProjectSubjectContext(state.set.projectId, this.db)
    const index = state.questions.findIndex((question) => question.id === entry.question!.id)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.homeworkWalkthrough.buildAnalysisSystemPrompt(),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.homeworkWalkthrough.buildAnalysisUserPrompt({
          label: questionLabel(entry.question, index),
          question: entry.question.prompt,
          sourceText: await this.homework.questionSourceText(entry.question),
          ...(entry.section.conclusion ? { conclusion: entry.section.conclusion } : {}),
          language: state.language,
        }),
      },
    ]
    try {
      const analysis = prompts.homeworkWalkthrough.readAnalysis(
        await requestSectionJSON(ai, messages, control.signal, (attempt) =>
          setAttempt(progress, [sectionId], attempt),
        ),
      )
      if (!analysis) throw new AppError(t('homework.walkthrough.invalid'), 'INVALID_RESPONSE')
      // Saved onto the section as it is now (it may have changed meanwhile).
      const id = walkthroughId(setId, state.language)
      const latest = await this.storedSection(id, sectionId)
      if (latest?.status !== 'ready') throw new NotFoundError('WalkthroughSection', sectionId)
      await this.repo.putSection(
        { id, projectId: state.set.projectId, setId, language: state.language },
        { ...latest, analysis: formatHomeworkReviewText(analysis) },
      )
      progress.done = 1
      emit()
      return { generated: 1, failed: 0 }
    } catch (err) {
      if (isAbortError(err, control.signal))
        return {
          generated: 0,
          failed: 0,
          paused: true,
          ...(control.signal.aborted ? { stopped: true } : {}),
        }
      throw err
    }
  }

  /** What a question's prompt needs besides the question text. */
  private async questionInputs(
    question: HomeworkQuestion,
    subject: SubjectContext | undefined,
  ): Promise<QuestionInputs> {
    const deferred =
      question.answerStatus === 'matched' && isDeferredProfessorAnswer(question.answerText ?? '')
    const professorAnswer =
      question.answerStatus === 'matched' && !deferred && (question.answerText ?? '').trim()
        ? question.answerText
        : undefined
    return {
      sourceText: await this.homework.questionSourceText(question),
      ...(professorAnswer ? { professorAnswer } : {}),
      ...(!deferred && question.solution ? { previousSolution: question.solution } : {}),
      linearSystems: subject?.subject === 'linear_algebra' || involvesRowReduction(question.prompt),
    }
  }

  /**
   * One question's section: in one request, or — for a long multipart
   * question, or when the one request still ends truncated — one request per
   * sub-part, saved as it goes so an interruption continues where it stopped.
   */
  private async writeQuestion(ai: AIService, job: QuestionJob): Promise<WalkthroughSection> {
    const question = job.entry.question!
    const inputs = await this.questionInputs(question, job.subject)
    const subparts = walkthroughSubparts(question.prompt)
    const draft = usableDraft(job, subparts)
    if (subparts.length >= 2 && (draft || shouldSplitWalkthrough(question.prompt, subparts)))
      return this.writeSplit(ai, job, inputs, subparts, draft, false)
    try {
      return await this.writeWhole(ai, job, inputs)
    } catch (err) {
      if (
        subparts.length >= 2 &&
        !isAbortError(err, job.control.signal) &&
        classifyHomeworkError(err) === 'truncated'
      )
        // Too long for one reply even with the larger budget: split it.
        return this.writeSplit(ai, job, inputs, subparts, undefined, true)
      throw err
    }
  }

  private async writeWhole(
    ai: AIService,
    job: QuestionJob,
    inputs: QuestionInputs,
  ): Promise<WalkthroughSection> {
    const { entry, label } = job
    const question = entry.question!
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.homeworkWalkthrough.buildQuestionSystemPrompt({
            linearSystems: inputs.linearSystems,
            analysis: true,
            steps: true,
          }),
          job.subject,
        ),
      },
      {
        role: 'user',
        content: prompts.homeworkWalkthrough.buildQuestionUserPrompt({
          label,
          question: question.prompt,
          sourceText: inputs.sourceText,
          language: job.language,
          ...(inputs.professorAnswer ? { professorAnswer: inputs.professorAnswer } : {}),
          ...(inputs.previousSolution ? { previousSolution: inputs.previousSolution } : {}),
          ...(job.mode === 'regenerate' ? { revision: revisionOf(job, job.current) } : {}),
        }),
      },
    ]
    const data = await requestSectionJSON(ai, messages, job.control.signal, job.onAttempt)
    const normalized = prompts.homeworkWalkthrough.normalizeQuestionSection(data)
    if (!normalized) throw new AppError(t('homework.walkthrough.invalid'), 'INVALID_RESPONSE')
    if (normalized.status === 'insufficient')
      return insufficientSection(entry, label, normalized.reason)
    const checks = inputs.linearSystems ? checkLinearSystems(normalized.linearSystems) : []
    return {
      id: entry.id,
      kind: 'question',
      questionId: question.id,
      title: label,
      ...(normalized.analysis ? { analysis: formatHomeworkReviewText(normalized.analysis) } : {}),
      conclusion: formatHomeworkReviewText(normalized.conclusion),
      body: formatHomeworkReviewText(normalized.body),
      status: 'ready',
      inputHash: entry.inputHash,
      ...(checks.length > 0 ? { checks } : {}),
      generatedAt: Date.now(),
    }
  }

  /** Split mode: one request per sub-part, each saved before the next starts. */
  private async writeSplit(
    ai: AIService,
    job: QuestionJob,
    inputs: QuestionInputs,
    subparts: WalkthroughSubpart[],
    resumeFrom: WalkthroughDraft | undefined,
    persistStart: boolean,
  ): Promise<WalkthroughSection> {
    const { entry, label, control } = job
    const question = entry.question!
    const labels = subparts.map((part) => part.label)
    let draft: WalkthroughDraft = resumeFrom ?? {
      mode: job.mode,
      ...(job.mode === 'regenerate' && job.suggestion ? { suggestion: job.suggestion } : {}),
      inputHash: entry.inputHash,
      labels,
      parts: [],
      startedAt: Date.now(),
    }
    // A ready section keeps its text until every sub-part is rewritten.
    const holder = job.current ?? (entry.section?.status === 'ready' ? entry.section : undefined)
    const saveDraft = (next: WalkthroughDraft): Promise<void> =>
      job.saveSection(
        holder
          ? { ...holder, draft: next }
          : {
              id: entry.id,
              kind: 'question',
              questionId: question.id,
              title: label,
              body: '',
              status: 'partial',
              inputHash: entry.inputHash,
              draft: next,
              generatedAt: Date.now(),
            },
      )
    // Fallen back after a truncated reply: remember to continue split.
    if (persistStart && !resumeFrom) await saveDraft(draft)
    const system = prompts.subjectProfile.withSubject(
      prompts.homeworkWalkthrough.buildPartSystemPrompt({
        linearSystems: inputs.linearSystems,
        punctuation: true,
        steps: true,
      }),
      job.subject,
    )
    for (let index = draft.parts.length; index < subparts.length; index++) {
      // Pausing stops between sub-parts; the finished ones are saved.
      if (!control.shouldContinue()) throw new GenerationPausedError(control.signal.aborted)
      const part = subparts[index]!.label
      job.onPart?.(part, index, subparts.length)
      const currentPart = job.current?.parts?.find((item) => item.label === part)
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        {
          role: 'user',
          content: prompts.homeworkWalkthrough.buildPartUserPrompt({
            label,
            question: question.prompt,
            sourceText: inputs.sourceText,
            language: job.language,
            ...(inputs.professorAnswer ? { professorAnswer: inputs.professorAnswer } : {}),
            ...(inputs.previousSolution ? { previousSolution: inputs.previousSolution } : {}),
            part,
            parts: labels,
            earlier: earlierParts(draft.parts),
            // The first sub-part also brings the analysis of the whole question.
            ...(index === 0 ? { analysis: true } : {}),
            ...(job.mode === 'regenerate'
              ? { revision: revisionOf(job, currentPart ?? job.current) }
              : {}),
          }),
        },
      ]
      const raw = await requestSectionJSON(ai, messages, control.signal, job.onAttempt)
      const normalized = prompts.homeworkWalkthrough.normalizePart(raw)
      if (!normalized) throw new AppError(t('homework.walkthrough.invalid'), 'INVALID_RESPONSE')
      if (normalized.status === 'insufficient')
        return insufficientSection(entry, label, `(${part}) ${normalized.reason}`)
      const checks = inputs.linearSystems
        ? checkLinearSystems(normalized.linearSystems.map((system) => partClaim(part, system)))
        : []
      const written: WalkthroughPart = {
        label: part,
        heading: stripPartLabel(normalized.heading, part),
        conclusion: formatHomeworkReviewText(stripPartLabel(normalized.conclusion, part)),
        body: formatHomeworkReviewText(normalized.body),
        ...(checks.length > 0 ? { checks } : {}),
      }
      const analysis = index === 0 ? prompts.homeworkWalkthrough.readAnalysis(raw) : ''
      draft = {
        ...draft,
        parts: [...draft.parts, written],
        ...(analysis ? { analysis: formatHomeworkReviewText(analysis) } : {}),
      }
      // The last one is saved as the finished section by the caller.
      if (index < subparts.length - 1) await saveDraft(draft)
    }
    job.onPart?.(null, subparts.length, subparts.length)
    return joinParts(entry, label, draft.parts, draft.analysis)
  }

  /** The opening and the summary, from every question that has a section. */
  private async writeFrame(
    ai: AIService,
    setId: string,
    state: WalkthroughState,
    labels: ReadonlyMap<string, string>,
    subject: SubjectContext | undefined,
    request: { signal?: AbortSignal; onAttempt?: (attempt: SectionAttempt) => void },
    /** Rewrite one of the two parts (the other is returned but not saved). */
    revision?: FrameRevision,
  ): Promise<WalkthroughSection[] | null> {
    const stored = await this.repo.get(walkthroughId(setId, state.language))
    const byId = new Map((stored?.sections ?? []).map((section) => [section.id, section]))
    const questions = state.plan
      .filter((entry) => entry.kind === 'question')
      .map((entry) => ({ entry, section: byId.get(entry.id) }))
      .filter(({ section }) => section?.status === 'ready')
      .map(({ entry, section }) => ({
        label: labels.get(entry.question!.id) ?? '?',
        question: clip(entry.question!.prompt, FRAME_QUESTION_CHARS),
        conclusion: clip(section!.conclusion ?? '', FRAME_CONCLUSION_CHARS),
        keyPoints: sectionKeyPoints(section!),
      }))
    if (questions.length === 0) return null
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.homeworkWalkthrough.buildFrameSystemPrompt({ keyPoints: true }),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.homeworkWalkthrough.buildFrameKeyPointsUserPrompt({
          title: state.set.title,
          questions,
          language: state.language,
          ...(revision ? { revision } : {}),
        }),
      },
    ]
    const frame = prompts.homeworkWalkthrough.normalizeFrame(
      await requestSectionJSON(ai, messages, request.signal, request.onAttempt),
    )
    if (!frame) throw new AppError(t('homework.walkthrough.invalid'), 'INVALID_RESPONSE')
    const frameHash = state.plan.find((entry) => entry.kind === 'overview')!.inputHash
    const now = Date.now()
    return [
      {
        id: 'overview',
        kind: 'overview',
        title: 'overview',
        body: formatHomeworkReviewText(frame.overview),
        status: 'ready',
        inputHash: frameHash,
        generatedAt: now,
      },
      {
        id: 'summary',
        kind: 'summary',
        title: 'summary',
        body: formatHomeworkReviewText(frame.summary),
        ...(frame.suggestions.length > 0
          ? { suggestions: frame.suggestions.map(formatHomeworkReviewText) }
          : {}),
        status: 'ready',
        inputHash: frameHash,
        generatedAt: now,
      },
    ]
  }

  // --- 普通版 / 详细版 -------------------------------------------------------

  /**
   * Remember which version (普通 / 详细) sections show: the given question
   * sections, or every question section with `'all'`. Instant, no request.
   */
  async setLevel(
    setId: string,
    sectionIds: readonly string[] | 'all',
    level: WalkthroughLevel,
  ): Promise<void> {
    const state = await this.state(setId)
    if (!state.walkthrough) return
    const wanted = sectionIds === 'all' ? null : new Set(sectionIds)
    await this.repo.updateSections(state.walkthrough.id, (section) =>
      section.kind === 'question' && (!wanted || wanted.has(section.id))
        ? { ...section, level }
        : section,
    )
    emit()
  }

  /**
   * Write the detailed version of ready question sections that lack one (all
   * of them, or `sectionIds`), each FROM its standard version, so the
   * conclusion, notation and steps stay the same. Saved as each finishes;
   * pausable between sections (and between sub-parts of a split question).
   */
  generateVariants(
    setId: string,
    options: { sectionIds?: string[]; control?: GenerationControl } = {},
  ): Promise<WalkthroughRunResult> {
    if (runs.has(setId))
      return Promise.reject(new AppError(t('homework.walkthrough.busy'), 'VALIDATION_ERROR'))
    const control = options.control ?? createGenerationRun()
    pausedRuns.delete(setId)
    const single = options.sectionIds?.length === 1 ? options.sectionIds[0] : undefined
    const progress: WalkthroughProgress = {
      total: 0,
      done: 0,
      failed: 0,
      running: [],
      ...(single ? { section: { id: single, split: false, variant: true } } : { variant: true }),
    }
    const promise = this.runVariants(setId, options.sectionIds, progress, control)
      .then((result) => {
        if (result.paused && !single)
          pausedRuns.set(setId, {
            stopped: result.stopped === true,
            done: progress.done,
            total: progress.total,
            variant: options.sectionIds ? { sectionIds: options.sectionIds } : {},
          })
        return result
      })
      .finally(() => {
        runs.delete(setId)
        emit()
      })
    runs.set(setId, { promise, progress, control })
    emit()
    return promise
  }

  private async runVariants(
    setId: string,
    sectionIds: readonly string[] | undefined,
    progress: WalkthroughProgress,
    control: GenerationControl,
  ): Promise<WalkthroughRunResult> {
    const ai = this.requireAI()
    const state = await this.state(setId)
    const subject = await loadProjectSubjectContext(state.set.projectId, this.db)
    const wanted = sectionIds ? new Set(sectionIds) : null
    const todo = state.plan.filter(
      (entry) =>
        entry.kind === 'question' &&
        entry.section?.status === 'ready' &&
        (!wanted || wanted.has(entry.id)) &&
        !detailedVariant(entry.section),
    )
    progress.total = todo.length
    emit()
    const labels = new Map(
      state.questions.map((question, index) => [question.id, questionLabel(question, index)]),
    )
    const id = walkthroughId(setId, state.language)
    const result: WalkthroughRunResult = { generated: 0, failed: 0 }
    let fatal: string | undefined
    let interrupted = false
    const queue = [...todo]
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        if (fatal) return
        if (!control.shouldContinue()) {
          interrupted = true
          return
        }
        const entry = queue.shift()!
        progress.running.push(entry.id)
        emit()
        let aborted = false
        try {
          await this.writeVariant(ai, {
            id,
            entry,
            section: entry.section!,
            label: labels.get(entry.question!.id) ?? '?',
            language: state.language,
            subject,
            control,
            mode: 'generate',
            onPart: (part, done, total) => {
              if (progress.section) {
                progress.section = { ...progress.section, split: true }
                progress.total = total
                progress.done = done
              }
              progress.parts = { ...progress.parts }
              if (part) progress.parts[entry.id] = part
              else delete progress.parts[entry.id]
              setAttempt(progress, [entry.id], null)
            },
            onAttempt: (attempt) => setAttempt(progress, [entry.id], attempt),
          })
          result.generated += 1
        } catch (err) {
          if (isAbortError(err, control.signal)) {
            aborted = true
            interrupted = true
            continue
          }
          if (isAccountFatalError(classifyHomeworkError(err))) fatal = friendlyAIError(err)
          // A failed detailed version leaves the standard one as it is.
          result.failed += 1
          progress.failed += 1
          // One section on its own: the caller shows why.
          if (progress.section) throw err
        } finally {
          progress.running = progress.running.filter((item) => item !== entry.id)
          if (progress.parts?.[entry.id]) {
            progress.parts = { ...progress.parts }
            delete progress.parts[entry.id]
          }
          if (!aborted && !progress.section) progress.done += 1
          setAttempt(progress, [entry.id], null)
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SECTION_CONCURRENCY, queue.length) }, () => worker()),
    )
    if (interrupted)
      return {
        ...result,
        paused: true,
        ...(control.signal.aborted ? { stopped: true } : {}),
        ...(fatal ? { fatalError: fatal } : {}),
      }
    if (progress.section) {
      progress.done = progress.total
      emit()
    }
    return fatal ? { ...result, fatalError: fatal } : result
  }

  /** 重新生成这一节 while the detailed version is shown: only that version is rewritten. */
  private async regenerateDetailed(
    setId: string,
    sectionId: string,
    suggestion: string | undefined,
    progress: WalkthroughProgress,
    control: GenerationControl,
  ): Promise<WalkthroughRunResult> {
    const ai = this.requireAI()
    const state = await this.state(setId)
    const entry = state.plan.find((item) => item.id === sectionId)
    const section = entry?.section
    const current = section ? detailedVariant(section) : undefined
    if (!entry?.question || section?.status !== 'ready' || !current)
      throw new NotFoundError('WalkthroughSection', sectionId)
    const subject = await loadProjectSubjectContext(state.set.projectId, this.db)
    const index = state.questions.findIndex((question) => question.id === entry.question!.id)
    try {
      await this.writeVariant(ai, {
        id: walkthroughId(setId, state.language),
        entry,
        section,
        label: questionLabel(entry.question, index),
        language: state.language,
        subject,
        control,
        mode: 'regenerate',
        ...(suggestion ? { suggestion } : {}),
        current,
        onPart: (part, done, total) => {
          progress.section = { id: sectionId, split: true, variant: true }
          progress.total = total
          progress.done = done
          progress.parts = part ? { [sectionId]: part } : {}
          setAttempt(progress, [sectionId], null)
        },
        onAttempt: (attempt) => setAttempt(progress, [sectionId], attempt),
      })
      progress.done = progress.total
      emit()
      return { generated: 1, failed: 0 }
    } catch (err) {
      if (isAbortError(err, control.signal))
        return {
          generated: 0,
          failed: 0,
          paused: true,
          ...(control.signal.aborted ? { stopped: true } : {}),
        }
      throw err
    }
  }

  /**
   * One section's detailed version, from its standard text (one request, or
   * one per sub-part of a split question, with the finished sub-parts kept as
   * a draft). Saved onto the section as it is then; a section that changed
   * meanwhile (other inputs, no longer ready) is left alone.
   */
  private async writeVariant(ai: AIService, job: VariantJob): Promise<WalkthroughVariant> {
    const { section, entry, control } = job
    const question = entry.question!
    const inputs = await this.questionInputs(question, job.subject)
    const common = {
      label: job.label,
      question: question.prompt,
      sourceText: inputs.sourceText,
      language: job.language,
      level: 'detailed' as const,
      ...(inputs.professorAnswer ? { professorAnswer: inputs.professorAnswer } : {}),
    }
    let variant: WalkthroughVariant
    const parts = section.parts ?? []
    if (parts.length >= 2) {
      const labels = parts.map((part) => part.label)
      const saved = section.variantDraft
      let draft: WalkthroughVariantDraft =
        saved &&
        saved.inputHash === section.inputHash &&
        saved.mode === job.mode &&
        (saved.suggestion ?? '') === (job.suggestion ?? '') &&
        saved.labels.join('|') === labels.join('|')
          ? saved
          : {
              level: 'detailed',
              mode: job.mode,
              ...(job.suggestion ? { suggestion: job.suggestion } : {}),
              inputHash: section.inputHash,
              labels,
              parts: [],
              startedAt: Date.now(),
            }
      const system = prompts.subjectProfile.withSubject(
        prompts.homeworkWalkthrough.buildVariantSystemPrompt({
          linearSystems: inputs.linearSystems,
          level: 'detailed',
          part: true,
        }),
        job.subject,
      )
      for (let index = draft.parts.length; index < parts.length; index++) {
        if (!control.shouldContinue()) throw new GenerationPausedError(control.signal.aborted)
        const standard = parts[index]!
        job.onPart?.(standard.label, index, parts.length)
        const currentPart = job.current?.parts?.find((item) => item.label === standard.label)
        const raw = await requestSectionJSON(
          ai,
          [
            { role: 'system', content: system },
            {
              role: 'user',
              content: prompts.homeworkWalkthrough.buildVariantUserPrompt({
                ...common,
                part: standard.label,
                heading: standard.heading,
                existing: { conclusion: standard.conclusion, body: standard.body },
                ...(job.mode === 'regenerate'
                  ? { revision: variantRevision(currentPart, job.suggestion) }
                  : {}),
              }),
            },
          ],
          control.signal,
          job.onAttempt,
        )
        const normalized = prompts.homeworkWalkthrough.normalizeVariant(raw)
        if (!normalized) throw new AppError(t('homework.walkthrough.invalid'), 'INVALID_RESPONSE')
        if (normalized.status === 'insufficient')
          throw new AppError(
            t('homework.walkthrough.insufficient', { reason: normalized.reason }),
            'INVALID_RESPONSE',
          )
        const checks = inputs.linearSystems
          ? checkLinearSystems(
              normalized.linearSystems.map((system) => partClaim(standard.label, system)),
            )
          : []
        draft = {
          ...draft,
          parts: [
            ...draft.parts,
            {
              label: standard.label,
              heading: standard.heading,
              conclusion: formatHomeworkReviewText(
                stripPartLabel(normalized.conclusion, standard.label),
              ),
              body: formatHomeworkReviewText(normalized.body),
              ...(checks.length > 0 ? { checks } : {}),
            },
          ],
        }
        if (index < parts.length - 1) {
          const next = draft
          await this.repo.updateSection(job.id, section.id, (latest) =>
            latest.status === 'ready' && latest.inputHash === section.inputHash
              ? { ...latest, variantDraft: next }
              : null,
          )
        }
      }
      job.onPart?.(null, parts.length, parts.length)
      const joined = joinParts(entry, job.label, draft.parts)
      variant = {
        ...(joined.conclusion ? { conclusion: joined.conclusion } : {}),
        body: joined.body,
        ...(joined.checks ? { checks: joined.checks } : {}),
        parts: draft.parts,
        inputHash: section.inputHash,
        generatedAt: Date.now(),
      }
    } else {
      const raw = await requestSectionJSON(
        ai,
        [
          {
            role: 'system',
            content: prompts.subjectProfile.withSubject(
              prompts.homeworkWalkthrough.buildVariantSystemPrompt({
                linearSystems: inputs.linearSystems,
                level: 'detailed',
              }),
              job.subject,
            ),
          },
          {
            role: 'user',
            content: prompts.homeworkWalkthrough.buildVariantUserPrompt({
              ...common,
              existing: {
                ...(section.conclusion ? { conclusion: section.conclusion } : {}),
                body: section.body,
              },
              ...(job.mode === 'regenerate'
                ? { revision: variantRevision(job.current, job.suggestion) }
                : {}),
            }),
          },
        ],
        control.signal,
        job.onAttempt,
      )
      const normalized = prompts.homeworkWalkthrough.normalizeVariant(raw)
      if (!normalized) throw new AppError(t('homework.walkthrough.invalid'), 'INVALID_RESPONSE')
      if (normalized.status === 'insufficient')
        throw new AppError(
          t('homework.walkthrough.insufficient', { reason: normalized.reason }),
          'INVALID_RESPONSE',
        )
      const checks = inputs.linearSystems ? checkLinearSystems(normalized.linearSystems) : []
      variant = {
        conclusion: formatHomeworkReviewText(normalized.conclusion),
        body: formatHomeworkReviewText(normalized.body),
        ...(checks.length > 0 ? { checks } : {}),
        inputHash: section.inputHash,
        generatedAt: Date.now(),
      }
    }
    const replaced = job.mode === 'regenerate' ? job.current : undefined
    const stored = await this.repo.updateSection(job.id, section.id, (latest) => {
      if (latest.status !== 'ready' || latest.inputHash !== section.inputHash) return null
      const { variantDraft: _done, ...rest } = latest
      return {
        ...rest,
        variants: { ...latest.variants, detailed: variant },
        ...(replaced ? { previous: { level: 'detailed', ...variantVersion(replaced) } } : {}),
      }
    })
    if (!stored) throw new AppError(t('homework.walkthrough.sectionChanged'), 'VALIDATION_ERROR')
    return variant
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'NO_PROVIDER')
    return this.ai
  }
}

function failedSection(
  entry: WalkthroughPlanEntry,
  title: string,
  error: string,
): WalkthroughSection {
  return {
    id: entry.id,
    kind: entry.kind,
    ...(entry.question ? { questionId: entry.question.id } : {}),
    title,
    body: '',
    status: 'failed',
    error,
    inputHash: entry.inputHash,
    generatedAt: Date.now(),
  }
}

interface QuestionInputs {
  sourceText: string
  professorAnswer?: string
  previousSolution?: string
  linearSystems: boolean
}

/** One question section to write, and how it reports and saves progress. */
interface QuestionJob {
  entry: WalkthroughPlanEntry
  label: string
  language: WalkthroughLanguage
  subject: SubjectContext | undefined
  control: GenerationControl
  /** `regenerate` — this section on its own, with the revision block. */
  mode: 'generate' | 'regenerate'
  suggestion?: string
  /** The ready version being rewritten (regenerate). */
  current?: WalkthroughSection
  /** Drafts started before this time are not continued ("rewrite everything"). */
  draftSince?: number
  saveSection: (section: WalkthroughSection) => Promise<void>
  /** Split mode: the sub-part now being written (`null` when all are done). */
  onPart?: (part: string | null, done: number, total: number) => void
  /** A request is being tried again (shown as 第 2 次尝试：上次超时). */
  onAttempt?: (attempt: SectionAttempt) => void
}

/** A saved draft this job may continue: same inputs, same request, same sub-parts. */
function usableDraft(
  job: QuestionJob,
  subparts: readonly WalkthroughSubpart[],
): WalkthroughDraft | undefined {
  const draft = job.entry.section?.draft
  if (!draft || draft.inputHash !== job.entry.inputHash || draft.mode !== job.mode) return undefined
  if (job.mode === 'regenerate' && (draft.suggestion ?? '') !== (job.suggestion ?? ''))
    return undefined
  if (draft.labels.join('|') !== subparts.map((part) => part.label).join('|')) return undefined
  if (job.draftSince !== undefined && draft.startedAt < job.draftSince) return undefined
  return draft
}

function revisionOf(
  job: QuestionJob,
  current: { conclusion?: string; body: string } | undefined,
): { current?: { conclusion?: string; body: string }; suggestion?: string } {
  return {
    ...(current
      ? {
          current: {
            ...(current.conclusion ? { conclusion: current.conclusion } : {}),
            body: current.body,
          },
        }
      : {}),
    ...(job.suggestion ? { suggestion: job.suggestion } : {}),
  }
}

/** The sub-parts already written, each cut so all of them fit one budget. */
function earlierParts(
  parts: readonly WalkthroughPart[],
): Array<{ label: string; conclusion: string; body: string }> {
  if (parts.length === 0) return []
  const each = Math.max(PART_EARLIER_MIN_CHARS, Math.floor(PART_EARLIER_CHARS / parts.length))
  return parts.map((part) => ({
    label: part.label,
    conclusion: part.conclusion,
    body: part.body.length > each ? `${part.body.slice(0, each)}…` : part.body,
  }))
}

/** Drop a leading `(b)` / `（b）` / `b)` the model repeated before a heading or result. */
function stripPartLabel(text: string, part: string): string {
  const pattern = new RegExp(`^\\s*[(（]?${part}[)）]\\s*[:：.、-]?\\s*`, 'i')
  return text.replace(pattern, '').trim()
}

/** Label a sub-part's linear system with the sub-part, e.g. `(b)` or `(b) #2`. */
function partClaim(part: string, system: ClaimedLinearSystem): ClaimedLinearSystem {
  const tag = `(${part})`
  const own = system.label.trim()
  const label = !own || /^#\d+$/.test(own) ? tag : own.includes(tag) ? own : `${tag} ${own}`
  return { ...system, label }
}

/** The finished section of a split question: its sub-parts in order. */
function joinParts(
  entry: WalkthroughPlanEntry,
  label: string,
  parts: readonly WalkthroughPart[],
  analysis?: string,
): WalkthroughSection {
  const checks = parts.flatMap((part) => part.checks ?? [])
  return {
    id: entry.id,
    kind: 'question',
    questionId: entry.question!.id,
    title: label,
    ...(analysis ? { analysis } : {}),
    conclusion: parts.map((part) => `(${part.label}) ${part.conclusion}`).join('\n\n'),
    body: parts
      .map((part) => `### (${part.label}) ${part.heading}`.trimEnd() + `\n\n${part.body}`)
      .join('\n\n'),
    status: 'ready',
    inputHash: entry.inputHash,
    parts: [...parts],
    ...(checks.length > 0 ? { checks } : {}),
    generatedAt: Date.now(),
  }
}

function insufficientSection(
  entry: WalkthroughPlanEntry,
  label: string,
  reason: string,
): WalkthroughSection {
  return {
    id: entry.id,
    kind: 'question',
    questionId: entry.question!.id,
    title: label,
    body: '',
    status: 'insufficient',
    error: reason,
    inputHash: entry.inputHash,
    generatedAt: Date.now(),
  }
}

/** The replaceable content of a ready section. */
export function versionOf(section: WalkthroughSection): WalkthroughSectionVersion {
  return {
    ...(section.analysis ? { analysis: section.analysis } : {}),
    ...(section.conclusion ? { conclusion: section.conclusion } : {}),
    body: section.body,
    ...(section.checks ? { checks: section.checks } : {}),
    ...(section.suggestions ? { suggestions: section.suggestions } : {}),
    ...(section.parts ? { parts: section.parts } : {}),
    ...(section.origin ? { origin: section.origin } : {}),
    ...(section.sourceDocumentId ? { sourceDocumentId: section.sourceDocumentId } : {}),
    ...(section.issues ? { issues: section.issues } : {}),
    inputHash: section.inputHash,
    generatedAt: section.generatedAt,
  }
}

/** A section showing `version` (a ready one), without draft or history. */
function applyVersion(
  section: WalkthroughSection,
  version: WalkthroughSectionVersion,
): WalkthroughSection {
  return {
    id: section.id,
    kind: section.kind,
    ...(section.questionId ? { questionId: section.questionId } : {}),
    title: section.title,
    ...(version.analysis ? { analysis: version.analysis } : {}),
    ...(version.conclusion ? { conclusion: version.conclusion } : {}),
    body: version.body,
    ...(version.suggestions ? { suggestions: version.suggestions } : {}),
    status: 'ready',
    inputHash: version.inputHash,
    ...(version.checks ? { checks: version.checks } : {}),
    ...(version.parts ? { parts: version.parts } : {}),
    ...(version.origin ? { origin: version.origin } : {}),
    ...(version.sourceDocumentId ? { sourceDocumentId: version.sourceDocumentId } : {}),
    ...(version.issues ? { issues: version.issues } : {}),
    generatedAt: version.generatedAt,
  }
}

/** The rewritten section, keeping the ready one it replaces (one level). */
function withPrevious(
  section: WalkthroughSection,
  replaced: WalkthroughSection | undefined,
): WalkthroughSection {
  return replaced ? { ...section, previous: versionOf(replaced) } : section
}

/** An opening / summary as the revision request shows it. */
function frameText(section: WalkthroughSection): string {
  const suggestions = section.suggestions?.length
    ? `\n\nReview suggestions:\n${section.suggestions.map((item) => `- ${item}`).join('\n')}`
    : ''
  return `${section.body}${suggestions}`
}

/**
 * One section request. A worked section is much longer than its prompt, so it
 * starts with generous room and doubles it once the model stops early; a
 * provider that rejects the size gets half; brief outages are retried twice.
 * Each attempt has its own deadline even while the stream keeps trickling, and
 * all attempts together stop at `SECTION_TOTAL_MS` with a "timed out, try
 * again" error, so one section never holds the run for 20+ minutes.
 */
async function requestSectionJSON(
  ai: AIService,
  messages: ChatMessage[],
  runSignal?: AbortSignal,
  onAttempt?: (attempt: SectionAttempt) => void,
): Promise<unknown> {
  const startedAt = Date.now()
  const remaining = (): number => SECTION_TOTAL_MS - (Date.now() - startedAt)
  const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0)
  const userCap =
    Number.isFinite(ai.maxOutputTokens) && ai.maxOutputTokens > 0 ? ai.maxOutputTokens : Infinity
  let budget = planOutputBudget({
    inputChars,
    userMaxTokens: ai.maxOutputTokens,
    ceiling: SECTION_OUTPUT_CEILING,
    overhead: 4_000,
    min: 2_048,
  })
  let retries = 0
  let attempts = 0
  // Lowest budget the provider rejected as too large: never ask for it (or
  // more) again, so truncated / output-limit cannot ping-pong forever.
  let rejectedBudget = Infinity
  const tried = new Set<number>()
  let lastFailure: HomeworkErrorKind | undefined
  for (;;) {
    attempts += 1
    tried.add(budget)
    if (runSignal?.aborted) throw new AbortedError()
    const left = remaining()
    if (left <= 0) throw sectionTimeoutError()
    if (attempts > 1 && lastFailure) onAttempt?.({ attempt: attempts, lastFailure })
    // The last attempt only gets what is left of the section's total time.
    const deadline = Math.min(SECTION_DEADLINE_MS, left)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, deadline)
    // The run's stop aborts this attempt too.
    const onRunAbort = (): void => controller.abort()
    runSignal?.addEventListener('abort', onRunAbort)
    try {
      const { data } = await ai.streamJSON<unknown>(messages, undefined, {
        maxTokens: budget,
        signal: controller.signal,
      })
      return data
    } catch (err) {
      // Stopped by the student: never a timeout, never retried.
      if (runSignal?.aborted) throw new AbortedError()
      const failure = timedOut ? new AITimeoutError(deadline) : err
      const kind = classifyHomeworkError(failure)
      lastFailure = kind
      // Out of total time: a clear "timed out, try again", whatever came last.
      if (remaining() <= 0) throw sectionTimeoutError()
      if (attempts >= SECTION_MAX_ATTEMPTS) throw failure
      if (kind === 'truncated') {
        const next = Math.min(userCap, SECTION_OUTPUT_MAX, budget * 2, rejectedBudget - 1)
        if (next <= budget || tried.has(next)) throw failure
        budget = next
      } else if (kind === 'output-limit') {
        rejectedBudget = Math.min(rejectedBudget, budget)
        const next = Math.max(Math.min(MIN_OUTPUT_TOKENS, userCap), Math.floor(budget / 2))
        if (next >= budget || tried.has(next)) throw failure
        budget = next
      } else if (isRetryableHomeworkError(kind) && retries < MAX_TRANSIENT_RETRIES) {
        retries += 1
        const delay = RETRY_BASE_DELAY_MS * 2 ** retries
        if (delay >= remaining()) throw sectionTimeoutError()
        await new Promise((resolve) => setTimeout(resolve, delay))
        if (runSignal?.aborted) throw new AbortedError()
      } else {
        throw failure
      }
    } finally {
      clearTimeout(timer)
      runSignal?.removeEventListener('abort', onRunAbort)
    }
  }
}

/** A section that ran out of total time: saved as failed, the run moves on. */
function sectionTimeoutError(): AppError {
  return new AppError(
    t('homework.walkthrough.sectionTimeout', { minutes: Math.round(SECTION_TOTAL_MS / 60_000) }),
    'SECTION_TIMEOUT',
  )
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/**
 * What the opening / summary needs from a worked section besides its
 * conclusion: its step headings and the terms it puts in bold, one per line.
 * Local and short — the worked text itself is not sent.
 */
export function sectionKeyPoints(section: Pick<WalkthroughSection, 'body' | 'parts'>): string {
  const points: string[] = []
  const add = (value: string): void => {
    const point = value.replace(/\s+/g, ' ').trim()
    if (point && !points.includes(point)) points.push(point)
  }
  for (const part of section.parts ?? []) add(`(${part.label}) ${part.heading}`)
  for (const match of section.body.matchAll(/^#{2,4}\s+(.+)$/gm)) add(match[1]!)
  for (const match of section.body.matchAll(/\*\*([^*\n]{2,80})\*\*/g)) add(match[1]!)
  let text = ''
  for (const point of points) {
    const line = `- ${point}`
    if (text.length + line.length + 1 > FRAME_KEY_POINT_CHARS) break
    text += text ? `\n${line}` : line
  }
  return text
}

/** One detailed version to write. */
interface VariantJob {
  /** The walkthrough row. */
  id: string
  entry: WalkthroughPlanEntry
  /** The ready section (its standard version is the source). */
  section: WalkthroughSection
  label: string
  language: WalkthroughLanguage
  subject: SubjectContext | undefined
  control: GenerationControl
  mode: 'generate' | 'regenerate'
  suggestion?: string
  /** The detailed version being rewritten (regenerate). */
  current?: WalkthroughVariant
  onPart?: (part: string | null, done: number, total: number) => void
  onAttempt?: (attempt: SectionAttempt) => void
}

function variantRevision(
  current: { conclusion?: string; body: string } | undefined,
  suggestion: string | undefined,
): { current?: { conclusion?: string; body: string }; suggestion?: string } {
  return {
    ...(current
      ? {
          current: {
            ...(current.conclusion ? { conclusion: current.conclusion } : {}),
            body: current.body,
          },
        }
      : {}),
    ...(suggestion ? { suggestion } : {}),
  }
}

/** A detailed version as the previous-version slot stores it. */
function variantVersion(variant: WalkthroughVariant): Omit<WalkthroughSectionVersion, 'level'> {
  return {
    ...(variant.conclusion ? { conclusion: variant.conclusion } : {}),
    body: variant.body,
    ...(variant.checks ? { checks: variant.checks } : {}),
    ...(variant.parts ? { parts: variant.parts } : {}),
    inputHash: variant.inputHash,
    generatedAt: variant.generatedAt,
  }
}

/** 恢复上一版 of the detailed version: swap it with the one it replaced. */
function swapDetailed(section: WalkthroughSection): WalkthroughSection {
  const previous = section.previous!
  const current = section.variants?.detailed
  const restored: WalkthroughVariant = {
    ...(previous.conclusion ? { conclusion: previous.conclusion } : {}),
    body: previous.body,
    ...(previous.checks ? { checks: previous.checks } : {}),
    ...(previous.parts ? { parts: previous.parts } : {}),
    inputHash: previous.inputHash,
    generatedAt: previous.generatedAt,
  }
  const { previous: _swapped, ...rest } = section
  return {
    ...rest,
    variants: { ...section.variants, detailed: restored },
    ...(current ? { previous: { level: 'detailed', ...variantVersion(current) } } : {}),
  }
}

/**
 * Keep the student's 普通 / 详细 choice on a rewritten section; with
 * `variants`, also its detailed version (only the standard one was rewritten).
 */
function withLevel(
  section: WalkthroughSection,
  from: WalkthroughSection | undefined,
  variants = false,
): WalkthroughSection {
  if (!from) return section
  return {
    ...section,
    ...(from.level ? { level: from.level } : {}),
    ...(variants && from.variants ? { variants: from.variants } : {}),
  }
}
