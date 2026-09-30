import type { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { HomeworkQuestionMode } from '@/infrastructure/ai/prompts/homework-question/v3'
import { prompts } from '@/infrastructure/ai/prompts'
import { asArray, asRecord, asStringArray, asTrimmedString } from '@/infrastructure/ai/validation'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { CourseContentService } from './courseContentService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { buildCandidateChunkLabel } from '@/entities/courseContent/topicDependency'
import { resolveMaterialType, type Document } from '@/entities/document/types'
import { renderPdfPageImage } from '@/infrastructure/files/pdfExtractor'
import { splitHomeworkSubparts } from '@/entities/homework/splitQuestion'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { getUILanguage, t } from '@/i18n'
import { HomeworkRepository } from '@/entities/homework/repository'
import {
  hasStudentWork,
  homeworkContentFingerprint,
  matchHomeworkQuestions,
  matchRetiredCandidates,
  normalizePrompt,
  type MatchableQuestion,
  type QuestionMatch,
} from '@/entities/homework/matching'
import {
  countCandidateQuestions,
  dedupeByKey,
  MIN_ANALYZER_TEXT_CHARS,
  planAnalyzerBatches,
} from '@/entities/homework/analyzerBatching'
import {
  locateQuestionExcerpt,
  resolveSourceChunkIds,
} from '@/entities/homework/sourceGrounding'
import {
  matchAnswersToQuestions,
  normalizeAnswerNumber,
  parseAnswerEntries,
  type AnswerEntry,
  type AnswerMatchResult,
} from '@/entities/homework/answerMatching'

/** Longest excerpt kept for one located source; the UI collapses long ones. */
const SOURCE_EXCERPT_MAX_CHARS = 480
import {
  EMPTY_REANALYSIS_SUMMARY,
  HOMEWORK_ANALYZER_PROMPT_VERSION,
  HOMEWORK_MAX_HINTS,
  HOMEWORK_MESSAGE_LIMIT,
  HOMEWORK_QUESTION_PROMPT_VERSION,
  type HomeworkMessage,
  type HomeworkProgress,
  type HomeworkQuestion,
  type HomeworkSet,
  type ReanalysisSummary,
} from '@/entities/homework/types'
import {
  ANALYZER_OUTPUT_CEILING,
  MIN_OUTPUT_TOKENS,
  planAnalyzerOutputBudget,
  planQuestionOutputBudget,
} from '@/entities/homework/tokenBudget'
import {
  classifyHomeworkError,
  isAccountFatalError,
  isRetryableHomeworkError,
  type HomeworkErrorKind,
} from '@/entities/homework/errorKind'

/** Hard cap on questions extracted from one assignment. */
const MAX_QUESTIONS = 50
/** How many previous chat turns are sent back to the model. */
const CHAT_HISTORY_TURNS = 8
/** How many questions' hints+solutions are prepared at once (rate-limit safe). */
const CONTENT_CONCURRENCY = 3
/** Bounded retries for one analyzer batch / one question request. */
const MAX_REQUEST_RETRIES = 2
/** Base backoff before retrying a transient batch/question failure. */
const RETRY_BASE_DELAY_MS = 700
/** How deep a single batch may be halved after a context/truncation failure. */
const MAX_BATCH_SPLIT_DEPTH = 5

/** Outcome of generating one question's hints + solution. */
interface GeneratedQuestionResult {
  question?: HomeworkQuestion
  kind?: HomeworkErrorKind
}

/** Coalesce concurrent re-analyses of the same set / regenerations of a question. */
const setRuns = new Map<string, Promise<{ set: HomeworkSet; summary: ReanalysisSummary } | undefined>>()
const questionRuns = new Map<string, Promise<GeneratedQuestionResult>>()
/**
 * Coalesce concurrent first-time analyses of the same document. The database
 * check-and-create is the real guard (it also covers two browser tabs); this
 * only avoids doing the same work twice within one tab.
 */
const documentRuns = new Map<string, Promise<HomeworkSet>>()

/** The result of committing a re-analysis; `pendingIds` need content generation. */
interface ReanalysisCommit {
  summary: ReanalysisSummary
  pendingIds: string[]
}

/** Outcome of reading the document in bounded batches. */
interface BatchAnalysis {
  questions: NormalizedQuestion[]
  /** Batches that returned candidates whose source ids stayed invalid. */
  invalidSourceRanges: number
  /** Batches that failed (AI error) or chunks left unread past the cap. */
  failedRanges: number
  /** First batch failure, surfaced when no question could be read at all. */
  firstError?: unknown
}

/**
 * Sent as a second, bounded attempt when a batch's source ids did not match.
 * It restates the closed set so a model that reformatted the ids can correct
 * itself; it never relaxes local validation.
 */
const ANALYZER_CORRECTION_REMINDER =
  'Your previous answer cited chunk ids that do not appear in the material above. Reply again with JSON only. For each question set `sourceChunkIds` to ids taken from the bracketed labels printed above, written exactly as `c:<chunkId>` (for example `c:9f3a1c2e · …`). Use only ids from the passages shown in this message; never invent one.'

/**
 * Homework walkthroughs.
 *
 * A student uploads an assignment (an ordinary document with
 * `materialType: 'homework'`) and the existing extraction pipeline reads it.
 * This service asks the AI which questions exist, grounds each one in the real
 * chunks it came from, and pre-generates progressive hints plus a worked
 * solution.
 *
 * Student work (draft, revealed hints, revealed solution, conversation) is
 * stored ON each question row, so a re-analysis matches incoming questions onto
 * their previous rows and NEVER deletes a record. Questions that no longer
 * match are retired (kept, viewable, restorable) rather than dropped.
 *
 * Everything is local-first: only the current document's text / the current
 * question's passages are ever sent, and each result is validated before it is
 * stored. A per-question failure never affects the others.
 */
export class HomeworkService {
  private ai: AIService | null
  private db: AppDatabase
  private homework: HomeworkRepository
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private content: CourseContentService

  constructor(deps: { ai: AIService | null; db?: AppDatabase; content?: CourseContentService }) {
    const db = deps.db ?? getDb()
    this.db = db
    this.content = deps.content ?? new CourseContentService()
    this.ai = deps.ai
    this.homework = new HomeworkRepository(db)
    this.documents = new DocumentRepository(db)
    this.chunks = new ChunkRepository(db)
  }

  listSets(projectId: string): Promise<HomeworkSet[]> {
    return this.homework.listSets(projectId)
  }

  getSet(id: string): Promise<HomeworkSet | undefined> {
    return this.homework.getSet(id)
  }

  /** Active questions (retired ones live in `listRetiredQuestions`). */
  async listQuestions(setId: string): Promise<HomeworkQuestion[]> {
    return (await this.homework.listQuestions(setId)).filter((question) => !question.retired)
  }

  /** Questions a re-analysis could not place; their records are kept. */
  async listRetiredQuestions(setId: string): Promise<HomeworkQuestion[]> {
    return (await this.homework.listQuestions(setId)).filter((question) => question.retired)
  }

  getQuestion(id: string): Promise<HomeworkQuestion | undefined> {
    return this.homework.getQuestion(id)
  }

  /**
   * Analyse one homework document into a set of questions (with hints +
   * solutions).
   *
   * Idempotent: a document has at most one homework set. If a set already
   * exists — whatever its status — it is returned untouched and **no AI runs**,
   * so revisiting, refreshing or opening a second tab never re-identifies. The
   * check-and-create share one transaction over `homeworkSets` (so two racing
   * callers cannot both insert), and same-tab concurrency is coalesced first.
   */
  createFromDocument(documentId: string): Promise<HomeworkSet> {
    const running = documentRuns.get(documentId)
    if (running) return running
    const run = this.runCreateFromDocument(documentId).finally(() =>
      documentRuns.delete(documentId),
    )
    documentRuns.set(documentId, run)
    return run
  }

  private async runCreateFromDocument(documentId: string): Promise<HomeworkSet> {
    const document = await this.loadDocument(documentId)
    if (resolveMaterialType(document.materialType) !== 'homework') {
      throw new AppError(t('homework.notHomework'), 'NOT_HOMEWORK')
    }
    const { set, created } = await this.ensureSetForDocument(document)
    if (!created) return set
    const { set: finalSet } = await this.runAnalysis(set)
    return finalSet
  }

  /**
   * Find the document's set, or create exactly one. The lookup and the insert
   * share a transaction over `homeworkSets`, so two callers racing for the same
   * document cannot both create a set.
   */
  private async ensureSetForDocument(
    document: Document,
  ): Promise<{ set: HomeworkSet; created: boolean }> {
    const now = Date.now()
    let set: HomeworkSet | undefined
    let created = false
    await this.db.transaction('rw', this.db.homeworkSets, async () => {
      const existing = await this.homework.listSetsByDocument(document.id)
      if (existing.length > 0) {
        set = [...existing].sort((a, b) => b.createdAt - a.createdAt)[0]
        return
      }
      const next: HomeworkSet = {
        id: crypto.randomUUID(),
        projectId: document.projectId,
        documentId: document.id,
        documentName: document.name,
        title: document.name,
        status: 'analyzing',
        language: currentLanguage(),
        questionCount: 0,
        promptVersion: HOMEWORK_ANALYZER_PROMPT_VERSION,
        progress: { stage: 'identifying', completed: 0, updatedAt: now },
        createdAt: now,
        updatedAt: now,
      }
      await this.homework.upsertSet(next)
      set = next
      created = true
    })
    if (!set) throw new AppError(t('homework.documentMissing'), 'NOT_FOUND')
    return { set, created }
  }

  /** Whether a first-time analysis run is currently in flight for a document. */
  isDocumentRunning(documentId: string): boolean {
    return documentRuns.has(documentId)
  }

  /** Whether a re-analysis run is currently in flight for a set. */
  isSetRunning(setId: string): boolean {
    return setRuns.has(setId)
  }

  /** True when any question in the set holds the learner's own work. */
  private async setHasStudentWork(setId: string): Promise<boolean> {
    const questions = await this.homework.listQuestions(setId)
    return questions.some((question) => hasStudentWork(question))
  }

  /**
   * Clean up historical duplicates: more than one set for the same document.
   *
   * The master record is chosen deterministically — a set with student work
   * (when exactly one has it), otherwise a `ready` set, otherwise the newest.
   * Only duplicates that hold **no student work** are removed; when two or more
   * sets hold student work the document is left alone and reported as
   * ambiguous, so no record is ever silently dropped or mis-attached. Files
   * that merely share a name but have different `documentId` are untouched.
   */
  async reconcileSets(projectId: string): Promise<{ removed: number; ambiguous: string[] }> {
    const sets = await this.homework.listSets(projectId)
    const byDocument = new Map<string, HomeworkSet[]>()
    for (const set of sets) {
      const group = byDocument.get(set.documentId) ?? []
      group.push(set)
      byDocument.set(set.documentId, group)
    }

    let removed = 0
    const ambiguous: string[] = []
    for (const [documentId, group] of byDocument) {
      if (group.length <= 1) continue
      const withWorkFlags = await Promise.all(
        group.map(async (set) => ({ set, work: await this.setHasStudentWork(set.id) })),
      )
      const withWork = withWorkFlags.filter((entry) => entry.work)
      if (withWork.length > 1) {
        ambiguous.push(documentId)
        continue
      }
      const canonical =
        withWork[0]?.set ??
        group.find((set) => set.status === 'ready') ??
        [...group].sort((a, b) => b.createdAt - a.createdAt)[0]!
      for (const entry of withWorkFlags) {
        if (entry.set.id === canonical.id || entry.work) continue
        await this.homework.deleteSet(entry.set.id)
        removed += 1
      }
    }
    return { removed, ambiguous }
  }

  /**
   * Delete one assignment **and its source file** from this project.
   *
   * Runs only after an explicit confirmation that names the student records
   * being removed, so it may delete questions that hold drafts/hints/messages.
   * Everything — the set, its questions and the document's derived rows — is
   * removed in one transaction; a set from another project is refused.
   */
  async deleteAssignment(setId: string, projectId: string): Promise<void> {
    const set = await this.homework.getSet(setId)
    if (!set || set.projectId !== projectId) throw new NotFoundError('HomeworkSet', setId)
    const documentId = set.documentId
    const answerDocumentId = set.answerDocumentId
    await this.db.transaction(
      'rw',
      [
        this.db.homeworkSets,
        this.db.homeworkQuestions,
        this.db.documents,
        this.db.documentBlobs,
        this.db.chunks,
        this.db.processingJobs,
        this.db.visualSources,
        this.db.visualSourceImages,
        this.db.courseStructures,
        this.db.courseStructureNodes,
      ],
      async () => {
        await this.homework.deleteByDocument(documentId)
        await this.documents.delete(documentId)
        // The linked answer file belongs to this assignment; remove it too.
        if (answerDocumentId && answerDocumentId !== documentId) {
          await this.documents.delete(answerDocumentId)
        }
      },
    )
    try {
      await this.content.markStale(projectId, 'homework-removed')
    } catch {
      /* annotation only */
    }
  }

  // --- Professor answer key -------------------------------------------------

  /** The linked answer document, project-checked. `null` when none/invalid. */
  async getAnswerDocument(setId: string): Promise<Document | null> {
    const set = await this.homework.getSet(setId)
    if (!set || !set.answerDocumentId) return null
    const document = await this.loadDocumentOrNull(set.answerDocumentId)
    if (!document || document.projectId !== set.projectId) return null
    return document
  }

  /**
   * Link an uploaded answer document to the assignment. The document must be a
   * real `homework_answer` file in the SAME project — never another project's
   * file, and never an ordinary assignment.
   */
  async attachAnswerDocument(setId: string, documentId: string): Promise<HomeworkSet> {
    const set = await this.homework.getSet(setId)
    if (!set) throw new NotFoundError('HomeworkSet', setId)
    const document = await this.loadDocument(documentId)
    if (document.projectId !== set.projectId) throw new NotFoundError('Document', documentId)
    if (resolveMaterialType(document.materialType) !== 'homework_answer') {
      throw new AppError(t('homework.answer.notAnswerFile'), 'INVALID_INPUT')
    }
    // Replacing: drop the old per-question links first, so no mapping can leak
    // from the previous answer file onto the new one.
    if (set.answerDocumentId && set.answerDocumentId !== documentId) {
      await this.homework.clearAnswerLinks(setId)
    }
    const updated = await this.homework.updateSet(setId, { answerDocumentId: documentId })
    return updated ?? set
  }

  /**
   * Remove the answer association. This only clears the link (and the
   * per-question answers) — the file and every student record are kept unless
   * `deleteFile` is explicitly requested.
   */
  async detachAnswerDocument(
    setId: string,
    projectId: string,
    options: { deleteFile?: boolean } = {},
  ): Promise<void> {
    const set = await this.homework.getSet(setId)
    if (!set || set.projectId !== projectId) throw new NotFoundError('HomeworkSet', setId)
    const answerDocumentId = set.answerDocumentId
    await this.homework.clearAnswerLinks(setId)
    await this.homework.updateSet(setId, { answerDocumentId: undefined })
    if (options.deleteFile && answerDocumentId) {
      await this.documents.delete(answerDocumentId)
    }
  }

  /**
   * Parse the linked answer document and propose a question-to-answer mapping.
   * Only unique one-to-one number matches are proposed as `matched`; everything
   * else is left for the student to confirm.
   */
  async buildAnswerMapping(
    setId: string,
  ): Promise<{ document: Document | null; entries: AnswerEntry[]; result: AnswerMatchResult }> {
    const set = await this.homework.getSet(setId)
    if (!set) throw new NotFoundError('HomeworkSet', setId)
    const document = await this.getAnswerDocument(setId)
    if (!document) {
      return { document: null, entries: [], result: { assignments: [], unmatchedAnswers: [] } }
    }
    const chunks = (await this.chunks.listByDocument(document.id)).slice().sort((a, b) => a.order - b.order)
    const entries = parseAnswerEntries(chunks.map((chunk) => ({ id: chunk.id, text: chunk.text })))
    const questions = (await this.homework.listQuestions(setId)).filter((q) => !q.retired)
    const result = matchAnswersToQuestions(
      questions.map((q) => ({ id: q.id, ...(q.number ? { number: q.number } : {}) })),
      entries,
    )
    return { document, entries, result }
  }

  /**
   * Persist the confirmed mapping. Only the questions the student selected are
   * written; a `undefined` selection clears that question's answer link. The
   * question rows (drafts, hints, messages) are never touched otherwise.
   */
  async confirmAnswerMapping(
    setId: string,
    selections: ReadonlyArray<{ questionId: string; answerIndex?: number }>,
  ): Promise<number> {
    const set = await this.homework.getSet(setId)
    if (!set) throw new NotFoundError('HomeworkSet', setId)
    const { entries } = await this.buildAnswerMapping(setId)
    let matched = 0
    for (const selection of selections) {
      const question = await this.homework.getQuestion(selection.questionId)
      if (!question || question.setId !== setId) continue
      if (selection.answerIndex === undefined) {
        await this.homework.updateQuestion(selection.questionId, {
          answerText: undefined,
          answerNumber: undefined,
          answerChunkIds: undefined,
          answerStatus: undefined,
        })
        continue
      }
      const entry = entries[selection.answerIndex]
      if (!entry) continue
      matched += 1
      await this.homework.updateQuestion(selection.questionId, {
        answerText: entry.text,
        ...(entry.number ? { answerNumber: entry.number } : { answerNumber: undefined }),
        answerChunkIds: entry.chunkIds,
        answerStatus: 'matched',
      })
    }
    return matched
  }

  /** Whether an answer-based generation is currently in flight for a question. */
  isQuestionRunning(questionId: string): boolean {
    return questionRuns.has(questionId)
  }

  /** Regenerate ONE question's help from its stored professor answer. */
  generateAnswerForQuestion(questionId: string): Promise<HomeworkQuestion | undefined> {
    return this.startAnswerGenerate(questionId).then((result) => result.question)
  }

  /**
   * Generate answer-based hints + solution for the set's matched questions.
   * Each question is isolated: one failure keeps that question's existing help
   * intact and never blocks the rest.
   */
  async generateAnswerContent(
    setId: string,
    questionIds?: readonly string[],
  ): Promise<{ generated: number; failed: number }> {
    const set = await this.homework.getSet(setId)
    if (!set) throw new NotFoundError('HomeworkSet', setId)
    const questions = (await this.homework.listQuestions(setId)).filter(
      (question) =>
        !question.retired &&
        question.answerStatus === 'matched' &&
        (question.answerText ?? '').trim().length > 0,
    )
    const targets = questionIds
      ? questions.filter((question) => questionIds.includes(question.id))
      : questions

    let generated = 0
    let failed = 0
    for (const question of targets) {
      const result = await this.startAnswerGenerate(question.id)
      if (result.question?.generationStatus === 'failed') failed += 1
      else generated += 1
    }
    return { generated, failed }
  }

  /**
   * Re-run the analysis for a set. Existing questions are matched by content;
   * a matched question keeps its id and every student field, unmatched new
   * questions are added, and unmatched old questions are retired (never
   * deleted). Concurrent calls for the same set are coalesced.
   */
  retrySet(
    setId: string,
  ): Promise<{ set: HomeworkSet; summary: ReanalysisSummary } | undefined> {
    const running = setRuns.get(setId)
    if (running) return running
    const run = this.runRetry(setId).finally(() => setRuns.delete(setId))
    setRuns.set(setId, run)
    return run
  }

  /**
   * (Re)generate the hints + solution for one question. Draft, revealed-hint
   * progress, revealed-solution state and the conversation are preserved; the
   * hint progress is clamped to the new hint count. Concurrent calls for the
   * same question are coalesced.
   */
  generateContent(questionId: string): Promise<HomeworkQuestion | undefined> {
    return this.startGenerate(questionId).then((result) => result.question)
  }

  /**
   * Start (or join) the generation for one question. Batch generation and the
   * single-question "Regenerate" button both go through here, so a manual retry
   * while a batch is running never fires the same request twice.
   */
  private startGenerate(questionId: string): Promise<GeneratedQuestionResult> {
    const running = questionRuns.get(questionId)
    if (running) return running
    const run = this.runGenerateContent(questionId).finally(() =>
      questionRuns.delete(questionId),
    )
    questionRuns.set(questionId, run)
    return run
  }

  /**
   * Start (or join) the professor-answer-based generation for one question.
   * Shares the question coalescing map with the ordinary generation, so the two
   * can never run on the same question at the same time.
   */
  private startAnswerGenerate(questionId: string): Promise<GeneratedQuestionResult> {
    const running = questionRuns.get(questionId)
    if (running) return running
    const run = this.runGenerateAnswerContent(questionId).finally(() =>
      questionRuns.delete(questionId),
    )
    questionRuns.set(questionId, run)
    return run
  }

  saveDraft(questionId: string, draftText: string): Promise<HomeworkQuestion | undefined> {
    return this.homework.updateQuestion(questionId, { draftText })
  }

  /** Reveal the next pre-generated hint (no AI call). */
  async revealNextHint(questionId: string): Promise<HomeworkQuestion | undefined> {
    const question = await this.homework.getQuestion(questionId)
    if (!question) return undefined
    const next = Math.min(question.hints.length, question.revealedHints + 1)
    if (next === question.revealedHints) return question
    return this.homework.updateQuestion(questionId, { revealedHints: next })
  }

  /** Reveal the pre-generated solution; keeps the student's draft untouched. */
  async revealSolution(questionId: string): Promise<HomeworkQuestion | undefined> {
    return this.homework.updateQuestion(questionId, { solutionRevealed: true })
  }

  /** Bring a retired question back into the walkthrough. */
  restoreQuestion(questionId: string): Promise<HomeworkQuestion | undefined> {
    return this.homework.updateQuestion(questionId, { retired: false, retiredAt: undefined })
  }

  /** Explicitly delete a question and its record (a deliberate student action). */
  async deleteQuestion(questionId: string): Promise<void> {
    await this.homework.deleteQuestion(questionId)
  }

  /** One turn of the per-question help conversation. */
  async ask(questionId: string, message: string): Promise<HomeworkMessage> {
    const question = await this.homework.getQuestion(questionId)
    if (!question) throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
    const trimmed = message.trim()
    if (!trimmed) throw new AppError(t('homework.emptyMessage'), 'INVALID_INPUT')

    const sourceText = await this.sourceText(question)
    const history = question.messages.slice(-CHAT_HISTORY_TURNS).map((item) => ({
      role: item.role,
      content: item.content,
    }))
    const messages: ChatMessage[] = [
      { role: 'system', content: prompts.homeworkQa.buildSystemPrompt() },
      {
        role: 'user',
        content: prompts.homeworkQa.buildUserPrompt({
          question: question.prompt,
          sourceText,
          history,
          message: trimmed,
          language: currentLanguage(),
        }),
      },
    ]
    const reply = await this.requireAI().chat(messages)
    const content = (reply.content ?? '').trim()
    if (!content) throw new AppError(t('homework.emptyReply'), 'EMPTY_TUTOR_RESPONSE')

    const now = Date.now()
    const student: HomeworkMessage = {
      id: crypto.randomUUID(),
      role: 'student',
      content: trimmed,
      createdAt: now,
    }
    const assistant: HomeworkMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      createdAt: now + 1,
    }
    // Merge from the latest row so a concurrent regeneration can't drop turns.
    const latest = (await this.homework.getQuestion(questionId)) ?? question
    const next = [...latest.messages, student, assistant].slice(-HOMEWORK_MESSAGE_LIMIT)
    await this.homework.updateQuestion(questionId, { messages: next })
    return assistant
  }

  // -------------------------------------------------------------------------

  private async runRetry(
    setId: string,
  ): Promise<{ set: HomeworkSet; summary: ReanalysisSummary } | undefined> {
    const existing = await this.homework.getSet(setId)
    if (!existing) return undefined
    // Re-check inside the write so a delete that lands mid-flight is not
    // resurrected by this status update.
    let analyzing: HomeworkSet | undefined
    await this.db.transaction('rw', this.db.homeworkSets, async () => {
      const current = await this.homework.getSet(setId)
      if (!current) return
      analyzing = {
        ...current,
        status: 'analyzing',
        errorMessage: undefined,
        progress: { stage: 'identifying', completed: 0, updatedAt: Date.now() },
        updatedAt: Date.now(),
      }
      await this.homework.upsertSet(analyzing)
    })
    if (!analyzing) return undefined
    return this.runAnalysis(analyzing)
  }

  private async runAnalysis(
    set: HomeworkSet,
  ): Promise<{ set: HomeworkSet; summary: ReanalysisSummary }> {
    const document = await this.loadDocumentOrNull(set.documentId)
    if (!document) {
      return { set: await this.failSet(set, t('homework.documentMissing')), summary: EMPTY_REANALYSIS_SUMMARY }
    }
    const chunks = await this.chunks.listByDocument(document.id)
    if (chunks.length === 0) {
      return { set: await this.failSet(set, t('homework.noContent')), summary: EMPTY_REANALYSIS_SUMMARY }
    }

    // Extraction/OCR stage: chunks exist but hold too little readable text.
    // This is not the model's fault, so it gets its own message.
    const readableChars = chunks.reduce((total, chunk) => total + chunk.text.trim().length, 0)
    if (readableChars < MIN_ANALYZER_TEXT_CHARS) {
      return {
        set: await this.failSet(set, t('homework.noReadableText')),
        summary: EMPTY_REANALYSIS_SUMMARY,
      }
    }

    let analysis: BatchAnalysis
    try {
      analysis = await this.analyzeBatches(document, chunks, async (completed, total) => {
        await this.setProgress(set.id, { stage: 'identifying', completed, total })
      })
    } catch (err) {
      // A provider-level failure (no provider, connect failure) or an account
      // fatal error (out of credit / rejected key) aborts before any commit:
      // every existing question and student record stays untouched.
      return { set: await this.failSet(set, friendlyAIError(err)), summary: EMPTY_REANALYSIS_SUMMARY }
    }

    const incoming = analysis.questions
    if (incoming.length === 0) {
      // Zero usable questions has several distinct causes; report the real one.
      if (analysis.firstError !== undefined) {
        return {
          set: await this.failSet(set, friendlyAIError(analysis.firstError)),
          summary: EMPTY_REANALYSIS_SUMMARY,
        }
      }
      if (analysis.invalidSourceRanges > 0) {
        return {
          set: await this.failSet(
            set,
            t('homework.sourcesUnverified', { count: analysis.invalidSourceRanges }),
          ),
          summary: EMPTY_REANALYSIS_SUMMARY,
        }
      }
      return {
        set: await this.failSet(set, t('homework.noQuestions')),
        summary: EMPTY_REANALYSIS_SUMMARY,
      }
    }

    // Some questions were read; if other ranges failed, keep the good ones and
    // tell the user which ranges still need a retry.
    const note =
      analysis.failedRanges > 0
        ? t('homework.partialNote', {
            recognized: incoming.length,
            ranges: analysis.failedRanges,
          })
        : undefined

    const { summary, pendingIds } = await this.commitReanalysis(set, document, incoming, note)

    // Generate the content the commit marked pending, with a bounded number in
    // flight at once (a long sequential chain is the main source of the wait).
    // Each failure is isolated and only affects its own question.
    let failed = 0
    if (pendingIds.length > 0) {
      failed = await this.generatePending(set.id, pendingIds)
    }
    await this.finishSet(set.id)

    const finalSet = (await this.homework.getSet(set.id)) ?? set
    return { set: finalSet, summary: { ...summary, failed } }
  }

  /** Persist live progress. Best-effort: a deleted set is simply not updated. */
  private async setProgress(
    setId: string,
    progress: Omit<HomeworkProgress, 'updatedAt'>,
  ): Promise<void> {
    await this.homework.updateSet(setId, { progress: { ...progress, updatedAt: Date.now() } })
  }

  /** Mark the run's terminal `ready` state and clear the live progress. */
  private async finishSet(setId: string): Promise<void> {
    await this.homework.updateSet(setId, { status: 'ready', progress: undefined })
  }

  /**
   * Prepare hints + solutions for the pending questions with bounded
   * concurrency. Stops scheduling new questions as soon as the provider reports
   * a fatal account problem (out of credit / rejected key) instead of hammering
   * it; questions that never ran are marked failed with the same actionable
   * reason so they keep a retry button rather than spinning forever.
   */
  private async generatePending(setId: string, ids: readonly string[]): Promise<number> {
    const total = ids.length
    const queue = [...ids]
    let completed = 0
    let failed = 0
    let fatal: HomeworkErrorKind | undefined

    const worker = async (): Promise<void> => {
      while (queue.length > 0 && !fatal) {
        const id = queue.shift()!
        const { question, kind } = await this.startGenerate(id)
        if (question?.generationStatus === 'failed') failed += 1
        if (kind && isAccountFatalError(kind)) fatal = kind
        completed += 1
        await this.setProgress(setId, { stage: 'generating', completed, total })
      }
    }

    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(CONTENT_CONCURRENCY, total)) }, () => worker()),
    )

    if (fatal) {
      const message =
        fatal === 'quota' ? t('friendlyError.quotaExceeded') : t('friendlyError.authFailed')
      for (const id of queue) {
        const updated = await this.homework.updateQuestion(id, {
          generationStatus: 'failed',
          generationError: message,
        })
        if (updated) failed += 1
      }
    }
    return failed
  }

  /**
   * Read the questions in bounded batches.
   *
   * Each batch is sent on its own so a long assignment never becomes one giant,
   * slow request; the request streams, so the budget is idle-based rather than
   * a hard cap on total generation time. A batch that returns questions whose
   * sources cannot be matched gets one bounded correction request. One failing
   * batch never discards the questions another batch read.
   */
  private async analyzeBatches(
    document: Document,
    chunks: readonly DocumentChunk[],
    onProgress?: (completed: number, total: number) => void | Promise<void>,
  ): Promise<BatchAnalysis> {
    const ai = this.requireAI()
    const system = prompts.homeworkAnalyzer.buildSystemPrompt()
    const { batches, droppedChunks } = planAnalyzerBatches(chunks)

    // Progress unit = one batch. A batch that has to be halved adds a unit, so
    // the bar only ever moves on work that really finished.
    const state = { completed: 0, total: batches.length }
    const emit = async (): Promise<void> => {
      await onProgress?.(state.completed, state.total)
    }

    const buildUser = (batch: readonly DocumentChunk[], reminder?: string): string =>
      prompts.homeworkAnalyzer.buildUserPrompt({
        documentName: document.name,
        documentText: buildDocumentText(batch),
        language: 'mixed',
      }) + (reminder ? `\n\n${reminder}` : '')

    const inputCharsFor = (batch: readonly DocumentChunk[], reminder?: string): number =>
      system.length + buildUser(batch, reminder).length

    const runBatch = async (
      batch: readonly DocumentChunk[],
      budget: number,
      reminder?: string,
    ): Promise<{ raw: number; normalized: NormalizedQuestion[] }> => {
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: buildUser(batch, reminder) },
      ]
      const { data } = await ai.streamJSON<unknown>(messages, undefined, { maxTokens: budget })
      return {
        raw: countCandidateQuestions(data),
        normalized: normalizeQuestions(data, batch, document),
      }
    }

    /**
     * Send one request with a budget derived from its own input. Reacts to the
     * provider's real error instead of one blanket retry:
     *  - a rejected output cap is retried once with a smaller budget,
     *  - a truncation is retried once with a larger budget (up to the ceiling),
     *  - transient failures (rate limit / timeout / unavailable) are retried
     *    with a short backoff, never in an unbounded loop.
     */
    const runBatchResilient = async (
      batch: readonly DocumentChunk[],
      reminder?: string,
    ): Promise<{ raw: number; normalized: NormalizedQuestion[] }> => {
      let budget = planAnalyzerOutputBudget(inputCharsFor(batch, reminder), ai.maxOutputTokens)
      let retries = 0
      for (;;) {
        try {
          return await runBatch(batch, budget, reminder)
        } catch (err) {
          if (retries >= MAX_REQUEST_RETRIES) throw err
          const kind = classifyHomeworkError(err)
          if (kind === 'output-limit') {
            const halved = Math.max(1, Math.floor(Math.min(budget, ai.maxOutputTokens) / 2))
            budget = Math.max(halved, Math.min(MIN_OUTPUT_TOKENS, ai.maxOutputTokens))
            retries += 1
            continue
          }
          if (kind === 'truncated') {
            const ceiling = Math.min(ANALYZER_OUTPUT_CEILING, ai.maxOutputTokens)
            const next = Math.min(ceiling, budget * 2)
            if (next <= budget) throw err
            budget = next
            retries += 1
            continue
          }
          if (isRetryableHomeworkError(kind)) {
            retries += 1
            await delay(RETRY_BASE_DELAY_MS * retries)
            continue
          }
          throw err
        }
      }
    }

    const collected: NormalizedQuestion[] = []
    let invalidSourceRanges = 0
    let failedRanges = 0
    let firstError: unknown

    const processBatch = async (batch: readonly DocumentChunk[], depth: number): Promise<void> => {
      try {
        let result = await runBatchResilient(batch)
        if (result.raw > 0 && result.normalized.length === 0) {
          // The model proposed questions but the source ids did not match any
          // real chunk. Try once more with an explicit reminder; still invalid
          // ids are never guessed into the database.
          result = await runBatchResilient(batch, ANALYZER_CORRECTION_REMINDER)
          if (result.raw > 0 && result.normalized.length === 0) invalidSourceRanges += 1
        }
        collected.push(...result.normalized)
      } catch (err) {
        const kind = classifyHomeworkError(err)
        // No credit / rejected key: stop the whole run so we stop hammering.
        if (isAccountFatalError(kind)) throw err
        const splittable =
          (kind === 'context-too-long' || kind === 'truncated') &&
          batch.length > 1 &&
          depth < MAX_BATCH_SPLIT_DEPTH
        if (splittable) {
          // Too much text for one request: halve it and keep the document order
          // and the real chunk ids. A single oversized chunk cannot be split
          // further, so it falls through to a reported unread range.
          const mid = Math.ceil(batch.length / 2)
          state.total += 1
          await processBatch(batch.slice(0, mid), depth + 1)
          await processBatch(batch.slice(mid), depth + 1)
          return
        }
        failedRanges += 1
        if (firstError === undefined) firstError = err
      }
      state.completed += 1
      await emit()
    }

    await emit()
    for (const batch of batches) {
      await processBatch(batch, 0)
    }

    if (droppedChunks > 0) failedRanges += 1

    return {
      questions: dedupeByKey(collected, (question) => normalizePrompt(question.prompt)),
      invalidSourceRanges,
      failedRanges,
      ...(firstError !== undefined ? { firstError } : {}),
    }
  }

  /**
   * Commit the whole re-analysis in ONE transaction: match incoming questions
   * onto their previous rows (keeping the id and every student field), revive a
   * retired row when a question comes back, retire unmatched old rows, insert
   * genuinely new rows, and update the set. Because the old rows are read
   * inside the transaction, a draft or message saved while the AI was running
   * is always preserved.
   *
   * Matching order is deliberate: active rows win first (a retired row must
   * never steal an active association), then still-unplaced questions may revive
   * a retired row — but only when the retired match is unambiguous, so a guess
   * can never attach the wrong student's work.
   */
  private async commitReanalysis(
    set: HomeworkSet,
    document: Document,
    incoming: readonly NormalizedQuestion[],
    note?: string,
  ): Promise<ReanalysisCommit> {
    const now = Date.now()
    const summary: ReanalysisSummary = { ...EMPTY_REANALYSIS_SUMMARY }
    const pendingIds: string[] = []

    await this.db.transaction('rw', this.db.homeworkSets, this.db.homeworkQuestions, async () => {
      // If the assignment was deleted while the AI was running, drop the whole
      // result instead of resurrecting the card.
      if (!(await this.homework.getSet(set.id))) {
        throw new AppError(t('homework.setRemoved'), 'HOMEWORK_SET_GONE')
      }
      const all = await this.homework.listQuestions(set.id)
      const active = all.filter((question) => !question.retired)
      const retiredRows = all.filter((question) => question.retired)

      const incomingMatchable = incoming.map(normalizedToMatchable)
      const activeResult = matchHomeworkQuestions(incomingMatchable, active.map(toMatchable))
      const activePairByNew = new Map<number, QuestionMatch>()
      for (const pair of activeResult.pairs) activePairByNew.set(pair.newIndex, pair)

      // A question matched to an active row that the student never touched can
      // be re-pointed at a retired row that DOES hold work. This heals the old
      // "active blank + archived record" duplicate, but only when the retired
      // match is at least as reliable as the active one, so an active
      // association is never stolen by a weaker guess.
      const blankActiveNew = new Set<number>()
      for (const pair of activeResult.pairs) {
        const prior = active[pair.oldIndex]
        if (prior && !hasStudentWork(prior)) blankActiveNew.add(pair.newIndex)
      }

      const eligibleNew = [...new Set([...activeResult.unmatchedNew, ...blankActiveNew])]
      const retiredResult = matchRetiredCandidates(
        incomingMatchable,
        eligibleNew,
        retiredRows.map(toMatchable),
      )

      const reviveByNew = new Map<number, QuestionMatch>()
      const supersededActiveNew = new Set<number>()
      for (const pair of retiredResult.pairs) {
        const retiredPrior = retiredRows[pair.oldIndex]
        if (!retiredPrior) continue
        if (activeResult.unmatchedNew.includes(pair.newIndex)) {
          reviveByNew.set(pair.newIndex, pair)
        } else if (blankActiveNew.has(pair.newIndex) && hasStudentWork(retiredPrior)) {
          const activePair = activePairByNew.get(pair.newIndex)
          if (activePair && pair.score >= activePair.score) {
            reviveByNew.set(pair.newIndex, pair)
            supersededActiveNew.add(pair.newIndex)
          }
        }
      }

      const rows: HomeworkQuestion[] = incoming.map((question, index) => {
        const chunkIds = groundedChunkIds(question)
        const fingerprint = homeworkContentFingerprint({
          prompt: question.prompt,
          number: question.number,
          chunkIds,
        })

        const revived = reviveByNew.get(index)
        if (revived) {
          // Reuse the archived row's id and every student field; only the place
          // in the walkthrough and (if the wording moved) the AI content change.
          const prior = retiredRows[revived.oldIndex]!
          const unchanged = prior.contentFingerprint === fingerprint
          const next: HomeworkQuestion = {
            ...prior,
            order: index,
            number: question.number,
            prompt: question.prompt,
            sourceRefs: question.sourceRefs,
            contentFingerprint: fingerprint,
            retired: false,
            retiredAt: undefined,
            answerStatus: answerKeptForMatch(prior, question.number),
            updatedAt: now,
          }
          if (!unchanged) {
            next.generationStatus = 'pending'
            pendingIds.push(prior.id)
          }
          summary.restored += 1
          return next
        }

        const pair = activePairByNew.get(index)
        if (pair) {
          const prior = active[pair.oldIndex]!
          const unchanged = prior.contentFingerprint === fingerprint
          const next: HomeworkQuestion = {
            ...prior,
            order: index,
            number: question.number,
            prompt: question.prompt,
            sourceRefs: question.sourceRefs,
            contentFingerprint: fingerprint,
            answerStatus: answerKeptForMatch(prior, question.number),
            updatedAt: now,
          }
          if (unchanged) {
            summary.matched += 1
          } else {
            // Keep the old hints/solution until the new ones are ready; the row
            // keeps the id, draft, revealed hints, solution flag and messages.
            next.generationStatus = 'pending'
            pendingIds.push(prior.id)
            summary.regenerated += 1
          }
          return next
        }

        const created: HomeworkQuestion = {
          id: crypto.randomUUID(),
          projectId: set.projectId,
          setId: set.id,
          documentId: document.id,
          documentName: document.name,
          order: index,
          ...(question.number ? { number: question.number } : {}),
          prompt: question.prompt,
          sourceRefs: question.sourceRefs,
          hints: [],
          generationStatus: 'pending',
          promptVersion: HOMEWORK_QUESTION_PROMPT_VERSION,
          draftText: '',
          revealedHints: 0,
          solutionRevealed: false,
          messages: [],
          contentFingerprint: fingerprint,
          createdAt: now,
          updatedAt: now,
        }
        pendingIds.push(created.id)
        summary.added += 1
        return created
      })

      // Active rows that no longer matched move to the archive (records kept).
      for (const oldIndex of activeResult.unmatchedOld) {
        const question = active[oldIndex]!
        await this.homework.upsertQuestion({
          ...question,
          retired: true,
          retiredAt: now,
          updatedAt: now,
        })
        summary.retired += 1
      }

      // Blank active duplicates that a restored archive row replaced are removed
      // — they hold no student input, so nothing is lost. Archived rows that
      // were not restored are left exactly as they were.
      for (const newIndex of supersededActiveNew) {
        const pair = activePairByNew.get(newIndex)
        const blank = pair ? active[pair.oldIndex] : undefined
        if (blank) await this.homework.deleteQuestion(blank.id)
      }

      for (const row of rows) await this.homework.upsertQuestion(row)

      // Stay `analyzing` while the pending hints+solutions are generated; the
      // run flips to `ready` only when that stage finishes. Progress is written
      // atomically with the questions so a refresh right after the commit still
      // shows the correct stage.
      const pending = pendingIds.length > 0
      await this.homework.upsertSet({
        ...set,
        status: pending ? 'analyzing' : 'ready',
        questionCount: rows.length,
        errorMessage: undefined,
        analysisNote: note,
        progress: pending
          ? { stage: 'generating', completed: 0, total: pendingIds.length, updatedAt: now }
          : undefined,
        updatedAt: now,
      })
    })

    return { summary, pendingIds }
  }

  private async runGenerateContent(questionId: string): Promise<GeneratedQuestionResult> {
    const question = await this.homework.getQuestion(questionId)
    if (!question) return {}
    // A question confirmed against the professor answer always regenerates
    // from that answer, including after a re-analysis marks its content stale.
    if (question.answerStatus === 'matched' && (question.answerText ?? '').trim().length > 0) {
      return this.runGenerateAnswerContent(questionId)
    }
    await this.homework.updateQuestion(questionId, {
      generationStatus: 'pending',
      generationError: undefined,
    })
    try {
      const ai = this.requireAI()
      const sourceText = await this.sourceText(question)
      let content: { hints: string[]; solution: string }
      try {
        content = normalizeQuestionContent(await requestHomeworkQuestionJSON(
          ai, question.prompt, sourceText, currentLanguage(), 'combined',
          splitHomeworkSubparts(question.prompt).length >= 2 ? 1 : 6,
        ))
      } catch (err) {
        const kind = classifyHomeworkError(err)
        const parts = splitHomeworkSubparts(question.prompt)
        if ((kind === 'truncated' || kind === 'output-limit') && parts.length >= 2) {
          // A ten-part exercise can exceed one model response even at the
          // student's 32k setting (providers impose their own smaller cap).
          // Generate each part independently; commit only after all succeed.
          const results: Array<{ label: string; hints: string[]; solution: string }> = []
          for (const part of parts) {
            results.push({ label: part.label, ...await prepareHomeworkQuestion(
              ai, part.prompt, '', currentLanguage(),
            ) })
          }
          const hintGroups: string[][] = [[], [], [], []]
          results.forEach((result, index) => {
            hintGroups[Math.min(3, Math.floor(index * 4 / results.length))]!.push(`(${result.label}) ${result.hints[0]}`)
          })
          content = {
            hints: hintGroups.filter((group) => group.length > 0).map((group) => group.join('\n')),
            solution: results.map((result) => `### (${result.label})\n\n${result.solution}`).join('\n\n'),
          }
        } else if (kind === 'truncated') {
          // A single question may still exceed the model's response limit.
          // Prepare hints and solution in separate requests, then commit both
          // together so a partial result never replaces the student's record.
          content = await prepareHomeworkQuestionInStages(
            ai, question.prompt, sourceText, currentLanguage(),
          )
        } else {
          throw err
        }
      }
      const { hints, solution } = content
      const updated = await this.homework.applyGeneratedContent(
        questionId,
        hints,
        solution,
        HOMEWORK_QUESTION_PROMPT_VERSION,
      )
      return { question: updated }
    } catch (err) {
      // Keep the row (and any previous hints/solution + all student fields).
      const updated = await this.homework.updateQuestion(questionId, {
        generationStatus: 'failed',
        generationError: friendlyAIError(err),
      })
      return { question: updated, kind: classifyHomeworkError(err) }
    }
  }

  /**
   * Prepare hints + solution grounded in the professor answer already stored on
   * the question. On success the previous AI solution (when there was one) is
   * kept in `previousSolution` so it is never silently overwritten; on failure
   * the existing hints/solution and every student field stay untouched.
   */
  private async runGenerateAnswerContent(questionId: string): Promise<GeneratedQuestionResult> {
    const question = await this.homework.getQuestion(questionId)
    if (!question) return {}
    const answer = (question.answerText ?? '').trim()
    if (!answer) return { question }
    await this.homework.updateQuestion(questionId, {
      generationStatus: 'pending',
      generationError: undefined,
    })
    try {
      const ai = this.requireAI()
      const sourceText = await this.sourceText(question)
      const content = normalizeQuestionContent(await requestHomeworkQuestionJSON(
        ai,
        question.prompt,
        sourceText,
        currentLanguage(),
        'combined',
        splitHomeworkSubparts(question.prompt).length >= 2 ? 1 : 6,
        answer,
      ))
      const previousSolution =
        !question.answerBased && (question.solution ?? '').trim() ? question.solution : undefined
      const updated = await this.homework.applyAnswerBasedContent(
        questionId,
        content.hints,
        content.solution,
        HOMEWORK_QUESTION_PROMPT_VERSION,
        previousSolution,
      )
      return { question: updated }
    } catch (err) {
      const updated = await this.homework.updateQuestion(questionId, {
        generationStatus: 'failed',
        generationError: friendlyAIError(err),
      })
      return { question: updated, kind: classifyHomeworkError(err) }
    }
  }

  private async failSet(set: HomeworkSet, message: string): Promise<HomeworkSet> {
    // A set deleted mid-run must stay deleted, not be re-created as "failed".
    if (!(await this.homework.getSet(set.id))) return set
    // Never touch the questions here: on a failed re-analysis the existing
    // questions and every student record must stay exactly as they were.
    const failed: HomeworkSet = {
      ...set,
      status: 'failed',
      errorMessage: message,
      analysisNote: undefined,
      progress: undefined,
      updatedAt: Date.now(),
    }
    await this.homework.upsertSet(failed)
    return failed
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'NO_PROVIDER')
    return this.ai
  }

  private async sourceText(question: HomeworkQuestion): Promise<string> {
    const ids = new Set(groundedChunkIds({ prompt: question.prompt, sourceRefs: question.sourceRefs }))
    if (ids.size === 0) return question.prompt
    const chunks = await this.chunks.listByDocument(question.documentId)
    const selected = chunks.filter((chunk) => ids.has(chunk.id))
    return selected.length > 0 ? buildDocumentText(selected) : question.prompt
  }

  /** Render at most two original PDF pages locally. The second page helps when
   * a diagram follows a question across a page break. No bytes leave device. */
  async loadQuestionSourcePages(question: HomeworkQuestion): Promise<Array<{ page: number; image: Blob }>> {
    const document = await this.loadDocumentOrNull(question.documentId)
    if (!document || document.projectId !== question.projectId || document.type !== 'pdf') return []
    const page = question.sourceRefs.find((ref) => ref.documentId === document.id && ref.page)?.page
    if (!page || page < 1) return []
    const needsFollowingPage = /\b(?:figure|diagram|shown|below|network)\b|图|如下图|如图/.test(question.prompt.toLowerCase())
    if (!needsFollowingPage && !question.sourceRefs.some((ref) => ref.quotePending)) return []
    const stored = await this.documents.getBytes(document.id)
    if (!stored) return []
    const source = new Blob([stored.bytes], { type: stored.mimeType })
    const pages = needsFollowingPage ? [page, page + 1] : [page]
    const images: Array<{ page: number; image: Blob }> = []
    for (const pageNumber of pages) {
      const rendered = await renderPdfPageImage(source, pageNumber, 1.5, {
        number: question.number ?? '',
        continuation: pageNumber !== page,
      })
      if (rendered) images.push({ page: pageNumber, image: new Blob([rendered.bytes], { type: rendered.mimeType }) })
    }
    return images
  }

  /** Repair the displayed citation of an older saved question without an AI
   * call or a write to the student's record. Never guess across documents. */
  async resolveQuestionSources(question: HomeworkQuestion): Promise<SourceReference[]> {
    const document = await this.loadDocumentOrNull(question.documentId)
    if (!document || document.projectId !== question.projectId) return question.sourceRefs
    const chunks = await this.chunks.listByDocument(document.id)
    return question.sourceRefs.map((ref) => {
      if (!ref.quotePending || ref.documentId !== document.id) return ref
      const own = chunks.find((chunk) => chunk.id === ref.chunkId)
      const ownExcerpt = own && locateQuestionExcerpt(own.text, question.prompt, question.number)
      if (ownExcerpt && own) return toSourceRef(own, document, question.prompt, question.number)
      const matches = chunks.filter((chunk) =>
        chunk.pageNumber === ref.page && Boolean(locateQuestionExcerpt(chunk.text, question.prompt, question.number)),
      )
      return matches.length === 1
        ? toSourceRef(matches[0]!, document, question.prompt, question.number)
        : ref
    })
  }

  private async loadDocument(id: string): Promise<Document> {
    const document = await this.loadDocumentOrNull(id)
    if (!document) throw new AppError(t('homework.documentMissing'), 'NOT_FOUND')
    return document
  }

  private async loadDocumentOrNull(id: string): Promise<Document | null> {
    try {
      const document = await this.documents.get(id)
      return document ?? null
    } catch {
      return null
    }
  }
}

function currentLanguage(): 'zh' | 'en' {
  return getUILanguage() === 'zh-CN' ? 'zh' : 'en'
}

/** Increase the output room only when the model actually stops early. A model
 * that rejects a larger max_tokens gets a shorter prompt at a smaller budget.
 * Each (budget, compactness) pair is tried once, with a hard request limit. */
async function requestHomeworkQuestionJSON(
  ai: AIService,
  question: string,
  sourceText: string,
  language: 'zh' | 'en',
  mode: HomeworkQuestionMode,
  maxAttempts = 6,
  professorAnswer?: string,
): Promise<unknown> {
  const hasProfessorAnswer = Boolean(professorAnswer?.trim())
  const userPrompt = prompts.homeworkQuestion.buildUserPrompt({
    question,
    sourceText,
    language,
    ...(hasProfessorAnswer ? { professorAnswer } : {}),
  })
  const initialSystem = prompts.homeworkQuestion.buildSystemPrompt(mode, false, hasProfessorAnswer)
  const userCap = Number.isFinite(ai.maxOutputTokens) && ai.maxOutputTokens > 0
    ? ai.maxOutputTokens : 4_096
  let budget = planQuestionOutputBudget(initialSystem.length + userPrompt.length, ai.maxOutputTokens)
  let compact = false
  const attempted = new Set<string>()
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const key = `${budget}:${compact}`
    if (attempted.has(key)) break
    attempted.add(key)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.homeworkQuestion.buildSystemPrompt(mode, compact, hasProfessorAnswer),
      },
      { role: 'user', content: userPrompt },
    ]
    try {
      // Streaming uses an idle timeout, so a long but active solution can finish.
      const { data } = await ai.streamJSON<unknown>(messages, undefined, { maxTokens: budget })
      return data
    } catch (err) {
      lastError = err
      const kind = classifyHomeworkError(err)
      if (kind === 'output-limit') {
        const smaller = Math.max(Math.min(MIN_OUTPUT_TOKENS, userCap), Math.floor(budget / 2))
        if (smaller === budget) throw err
        budget = smaller
        compact = true
      } else if (kind === 'truncated') {
        if (!compact && budget >= 8_192) {
          compact = true
        } else if (budget < userCap) {
          budget = Math.min(userCap, Math.max(budget + MIN_OUTPUT_TOKENS, budget * 2))
        } else if (!compact) {
          compact = true
        } else {
          throw err
        }
      } else {
        throw err
      }
      if (attempt === maxAttempts - 1) throw err
    }
  }
  // The last retry could only revisit a rejected budget/format pair.
  throw lastError ?? new AppError(t('homework.contentIncomplete'), 'INVALID_RESPONSE')
}

async function prepareHomeworkQuestion(
  ai: AIService,
  question: string,
  sourceText: string,
  language: 'zh' | 'en',
): Promise<{ hints: string[]; solution: string }> {
  try {
    return normalizeQuestionContent(await requestHomeworkQuestionJSON(
      ai, question, sourceText, language, 'combined',
    ))
  } catch (err) {
    if (classifyHomeworkError(err) !== 'truncated') throw err
    return prepareHomeworkQuestionInStages(ai, question, sourceText, language)
  }
}

async function prepareHomeworkQuestionInStages(
  ai: AIService,
  question: string,
  sourceText: string,
  language: 'zh' | 'en',
): Promise<{ hints: string[]; solution: string }> {
  const hintData = asRecord(await requestHomeworkQuestionJSON(
    ai, question, sourceText, language, 'hints',
  ))
  const hints = asStringArray(hintData?.hints).map((hint) => hint.trim())
    .filter(Boolean).slice(0, HOMEWORK_MAX_HINTS)
  if (hints.length === 0) throw new AppError(t('homework.contentIncomplete'), 'INVALID_RESPONSE')
  const solutionData = asRecord(await requestHomeworkQuestionJSON(
    ai, question, sourceText, language, 'solution',
  ))
  const solution = asTrimmedString(solutionData?.solution)
  if (!solution) throw new AppError(t('homework.contentIncomplete'), 'INVALID_RESPONSE')
  return { hints, solution }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Whether a confirmed professor-answer link still holds after a re-analysis.
 *
 * A question matched by content keeps its answer only when its printed number
 * did not change. If the number moved, the old mapping is no longer trustworthy
 * and the question is downgraded to `needs_review` — the answer is never blindly
 * applied to a question that now has a different number.
 */
function answerKeptForMatch(
  prior: HomeworkQuestion,
  incomingNumber: string | undefined,
): HomeworkQuestion['answerStatus'] {
  if (prior.answerStatus !== 'matched') return prior.answerStatus
  const before = prior.number ? normalizeAnswerNumber(prior.number) : ''
  const after = incomingNumber ? normalizeAnswerNumber(incomingNumber) : ''
  return before === after ? 'matched' : 'needs_review'
}

function groundedChunkIds(question: {
  prompt: string
  sourceRefs?: readonly SourceReference[]
}): string[] {
  return (question.sourceRefs ?? [])
    .map((ref) => ref.chunkId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function toMatchable(question: HomeworkQuestion): MatchableQuestion {
  return {
    prompt: question.prompt,
    ...(question.number ? { number: question.number } : {}),
    chunkIds: groundedChunkIds(question),
  }
}

function normalizedToMatchable(question: NormalizedQuestion): MatchableQuestion {
  return {
    prompt: question.prompt,
    ...(question.number ? { number: question.number } : {}),
    chunkIds: groundedChunkIds(question),
  }
}

/** Every passage is prefixed with its closed-set chunk label, like the analyzer. */
function buildDocumentText(chunks: readonly DocumentChunk[]): string {
  return chunks
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((chunk) => `[${buildCandidateChunkLabel(chunk)}]\n${chunk.text}`)
    .join('\n\n')
}

/**
 * Build one grounded source reference for a question.
 *
 * The excerpt is the part of the chunk that actually belongs to THIS question,
 * found by matching the question text inside the passage. A chunk that holds
 * two adjacent questions therefore can no longer show the first question's text
 * as the second's evidence. When the question text cannot be located the
 * reference keeps the page/section and a `quotePending` flag, and the UI asks
 * the student to verify the passage instead of showing a wrong excerpt.
 */
function toSourceRef(chunk: DocumentChunk, document: Document, prompt: string, number?: string): SourceReference {
  const ref: SourceReference = { documentId: document.id, documentName: document.name }
  if (chunk.pageNumber !== undefined) ref.page = chunk.pageNumber
  const section = chunk.sectionTitle ?? chunk.section
  if (section) ref.section = section
  const excerpt = locateQuestionExcerpt(chunk.text, prompt, number)
  if (excerpt) {
    ref.quote = excerpt.slice(0, SOURCE_EXCERPT_MAX_CHARS)
  } else {
    ref.quotePending = true
  }
  ref.chunkId = chunk.id
  return ref
}

interface NormalizedQuestion {
  number?: string
  prompt: string
  sourceRefs: SourceReference[]
}

/**
 * Keep only questions that have both text and at least one *real* chunk id.
 *
 * A source value is accepted when it resolves — as a bare id, a `c:<id>`, or a
 * full label — to a chunk sent in this batch. An invented, truncated,
 * cross-batch or ambiguous value simply fails the filter; it is never accepted,
 * and a question with no grounded passage is dropped rather than stored with a
 * fake source.
 */
export function normalizeQuestions(
  raw: unknown,
  chunks: readonly DocumentChunk[],
  document: Document,
): NormalizedQuestion[] {
  const record = asRecord(raw)
  // Accept the documented `{ questions: [...] }` shape, and also a bare array —
  // a model that returns just the list must not be reported as "no questions".
  const items = asArray(record?.questions ?? (Array.isArray(raw) ? raw : undefined))
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const out: NormalizedQuestion[] = []
  for (const item of items) {
    if (out.length >= MAX_QUESTIONS) break
    const entry = asRecord(item)
    if (!entry) continue
    const prompt = asTrimmedString(entry.prompt)
    if (!prompt) continue
    // Accept the label forms the model actually copies (`c:<id>`, full label)
    // as well as the bare id, but only when they resolve to a chunk sent in
    // THIS batch. Everything else is rejected — never guessed.
    const ids = resolveSourceChunkIds(asStringArray(entry.sourceChunkIds), new Set(byId.keys()))
    if (ids.length === 0) continue
    const number = asTrimmedString(entry.number)
    let sourceRefs = ids.map((id) => toSourceRef(byId.get(id)!, document, prompt, number))
    if (sourceRefs.every((ref) => ref.quotePending)) {
      // A PDF page may be split into several chunks; the model can cite the
      // page's earlier chunk even when the numbered question is in the next.
      // Only relink when exactly one real chunk on that same page matches.
      const pages = new Set(sourceRefs.map((ref) => ref.page).filter((page): page is number => page !== undefined))
      const located = chunks.filter((chunk) =>
        chunk.pageNumber !== undefined && pages.has(chunk.pageNumber) &&
        Boolean(locateQuestionExcerpt(chunk.text, prompt, number)),
      )
      if (located.length === 1) sourceRefs = [toSourceRef(located[0]!, document, prompt, number)]
    }
    out.push({
      ...(number ? { number } : {}),
      prompt,
      sourceRefs,
    })
  }
  return out
}

/** Validate the hints + solution returned for one question. */
export function normalizeQuestionContent(raw: unknown): { hints: string[]; solution: string } {
  const record = asRecord(raw)
  const hints = asStringArray(record?.hints)
    .map((hint) => hint.trim())
    .filter(Boolean)
    .slice(0, HOMEWORK_MAX_HINTS)
  const solution = asTrimmedString(record?.solution)
  if (hints.length === 0 || !solution) {
    throw new AppError(t('homework.contentIncomplete'), 'INVALID_RESPONSE')
  }
  return { hints, solution }
}
