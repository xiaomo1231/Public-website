import type { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
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
} from '@/entities/homework/errorKind'
import { MIN_OUTPUT_TOKENS, planOutputBudget } from '@/entities/homework/tokenBudget'
import { checkLinearSystems, involvesRowReduction } from '@/entities/homework/walkthroughChecks'
import {
  planWalkthrough,
  walkthroughId,
  walkthroughLanguage,
  type HomeworkWalkthrough,
  type WalkthroughLanguage,
  type WalkthroughPlanEntry,
  type WalkthroughSection,
} from '@/entities/homework/walkthrough'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { SubjectContext } from '@/entities/project/types'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import {
  createGenerationRun,
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
const SECTION_OUTPUT_CEILING = 8_192
const SECTION_OUTPUT_MAX = 16_384
/** Hard cap on paid requests for one section (budget changes + transient retries). */
const SECTION_MAX_ATTEMPTS = 6
const MAX_TRANSIENT_RETRIES = 2
const RETRY_BASE_DELAY_MS = 700
/** How much of each question the opening / summary request sees. */
const FRAME_QUESTION_CHARS = 1_500
const FRAME_EXCERPT_CHARS = 1_500

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
  return run ? { ...run.progress, running: [...run.progress.running] } : undefined
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
      `homework-walkthrough/${prompts.homeworkWalkthrough.VERSION}`,
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
        !(entry.section?.status !== 'failed' && (entry.section?.generatedAt ?? 0) >= forceSince))
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
          const section = await this.writeQuestionSection(
            ai,
            entry,
            label,
            state.language,
            subject,
            control.signal,
          )
          // "Not enough information" is a finished answer, not a failure.
          await save(section)
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
          // A finished section is never replaced by a failure.
          if (entry.section?.status !== 'ready') {
            await save(failedSection(entry, label, friendlyAIError(err)))
          }
        } finally {
          progress.running = progress.running.filter((id) => id !== entry.id)
          if (!aborted) progress.done += 1
          emit()
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
        const frame = await this.writeFrame(ai, setId, state, labels, subject, control.signal)
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
        emit()
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

  private async writeQuestionSection(
    ai: AIService,
    entry: WalkthroughPlanEntry,
    label: string,
    language: WalkthroughLanguage,
    subject: SubjectContext | undefined,
    signal?: AbortSignal,
  ): Promise<WalkthroughSection> {
    const question = entry.question!
    const deferred =
      question.answerStatus === 'matched' && isDeferredProfessorAnswer(question.answerText ?? '')
    const professorAnswer =
      question.answerStatus === 'matched' && !deferred && (question.answerText ?? '').trim()
        ? question.answerText
        : undefined
    const linearSystems =
      subject?.subject === 'linear_algebra' || involvesRowReduction(question.prompt)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.homeworkWalkthrough.buildQuestionSystemPrompt({ linearSystems }),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.homeworkWalkthrough.buildQuestionUserPrompt({
          label,
          question: question.prompt,
          sourceText: await this.homework.questionSourceText(question),
          language,
          ...(professorAnswer ? { professorAnswer } : {}),
          ...(!deferred && question.solution ? { previousSolution: question.solution } : {}),
        }),
      },
    ]
    const data = await requestSectionJSON(ai, messages, signal)
    const normalized = prompts.homeworkWalkthrough.normalizeQuestionSection(data)
    if (!normalized) throw new AppError(t('homework.walkthrough.invalid'), 'INVALID_RESPONSE')
    const now = Date.now()
    if (normalized.status === 'insufficient') {
      return {
        id: entry.id,
        kind: 'question',
        questionId: question.id,
        title: label,
        body: '',
        status: 'insufficient',
        error: normalized.reason,
        inputHash: entry.inputHash,
        generatedAt: now,
      }
    }
    const checks = linearSystems ? checkLinearSystems(normalized.linearSystems) : []
    return {
      id: entry.id,
      kind: 'question',
      questionId: question.id,
      title: label,
      conclusion: formatHomeworkReviewText(normalized.conclusion),
      body: formatHomeworkReviewText(normalized.body),
      status: 'ready',
      inputHash: entry.inputHash,
      ...(checks.length > 0 ? { checks } : {}),
      generatedAt: now,
    }
  }

  /** The opening and the summary, from every question that has a section. */
  private async writeFrame(
    ai: AIService,
    setId: string,
    state: WalkthroughState,
    labels: ReadonlyMap<string, string>,
    subject: SubjectContext | undefined,
    signal?: AbortSignal,
  ): Promise<WalkthroughSection[] | null> {
    const stored = await this.repo.get(walkthroughId(setId, state.language))
    const byId = new Map((stored?.sections ?? []).map((section) => [section.id, section]))
    const questions = state.plan
      .filter((entry) => entry.kind === 'question')
      .map((entry) => ({ entry, section: byId.get(entry.id) }))
      .filter(({ section }) => section?.status === 'ready')
      .map(({ entry, section }) => ({
        label: labels.get(entry.question!.id) ?? '?',
        question: entry.question!.prompt.slice(0, FRAME_QUESTION_CHARS),
        conclusion: section!.conclusion ?? '',
        excerpt: section!.body.slice(0, FRAME_EXCERPT_CHARS),
      }))
    if (questions.length === 0) return null
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.homeworkWalkthrough.buildFrameSystemPrompt(),
          subject,
        ),
      },
      {
        role: 'user',
        content: prompts.homeworkWalkthrough.buildFrameUserPrompt({
          title: state.set.title,
          questions,
          language: state.language,
        }),
      },
    ]
    const frame = prompts.homeworkWalkthrough.normalizeFrame(
      await requestSectionJSON(ai, messages, signal),
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

/**
 * One section request. A worked section is much longer than its prompt, so it
 * starts with generous room and doubles it once the model stops early; a
 * provider that rejects the size gets half; brief outages are retried twice.
 * Each attempt has its own deadline even while the stream keeps trickling.
 */
async function requestSectionJSON(
  ai: AIService,
  messages: ChatMessage[],
  runSignal?: AbortSignal,
): Promise<unknown> {
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
  for (;;) {
    attempts += 1
    tried.add(budget)
    if (runSignal?.aborted) throw new AbortedError()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, SECTION_DEADLINE_MS)
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
      const failure = timedOut ? new AITimeoutError(SECTION_DEADLINE_MS) : err
      const kind = classifyHomeworkError(failure)
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
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** retries))
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
