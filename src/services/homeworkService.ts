import type { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { asArray, asRecord, asStringArray, asTrimmedString } from '@/infrastructure/ai/validation'
import { AppError } from '@/infrastructure/errors/AppError'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { buildCandidateChunkLabel } from '@/entities/courseContent/topicDependency'
import { resolveMaterialType, type Document } from '@/entities/document/types'
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
  type MatchableQuestion,
  type QuestionMatch,
} from '@/entities/homework/matching'
import {
  EMPTY_REANALYSIS_SUMMARY,
  HOMEWORK_ANALYZER_PROMPT_VERSION,
  HOMEWORK_MAX_HINTS,
  HOMEWORK_MESSAGE_LIMIT,
  HOMEWORK_QUESTION_PROMPT_VERSION,
  type HomeworkMessage,
  type HomeworkQuestion,
  type HomeworkSet,
  type ReanalysisSummary,
} from '@/entities/homework/types'

/** Hard cap on questions extracted from one assignment. */
const MAX_QUESTIONS = 50
/** How many previous chat turns are sent back to the model. */
const CHAT_HISTORY_TURNS = 8

/** Coalesce concurrent re-analyses of the same set / regenerations of a question. */
const setRuns = new Map<string, Promise<{ set: HomeworkSet; summary: ReanalysisSummary } | undefined>>()
const questionRuns = new Map<string, Promise<HomeworkQuestion | undefined>>()

/** The result of committing a re-analysis; `pendingIds` need content generation. */
interface ReanalysisCommit {
  summary: ReanalysisSummary
  pendingIds: string[]
}

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

  constructor(deps: { ai: AIService | null; db?: AppDatabase }) {
    const db = deps.db ?? getDb()
    this.db = db
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

  /** Analyse one homework document into a set of questions (with hints + solutions). */
  async createFromDocument(documentId: string): Promise<HomeworkSet> {
    const document = await this.loadDocument(documentId)
    if (resolveMaterialType(document.materialType) !== 'homework') {
      throw new AppError(t('homework.notHomework'), 'NOT_HOMEWORK')
    }
    const now = Date.now()
    const set: HomeworkSet = {
      id: crypto.randomUUID(),
      projectId: document.projectId,
      documentId: document.id,
      documentName: document.name,
      title: document.name,
      status: 'analyzing',
      language: currentLanguage(),
      questionCount: 0,
      promptVersion: HOMEWORK_ANALYZER_PROMPT_VERSION,
      createdAt: now,
      updatedAt: now,
    }
    await this.homework.upsertSet(set)
    const { set: finalSet } = await this.runAnalysis(set)
    return finalSet
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
    const running = questionRuns.get(questionId)
    if (running) return running
    const run = this.runGenerateContent(questionId).finally(() => questionRuns.delete(questionId))
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
    const set = await this.homework.getSet(setId)
    if (!set) return undefined
    const analyzing: HomeworkSet = {
      ...set,
      status: 'analyzing',
      errorMessage: undefined,
      updatedAt: Date.now(),
    }
    await this.homework.upsertSet(analyzing)
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

    let incoming: NormalizedQuestion[]
    try {
      const ai = this.requireAI()
      const messages: ChatMessage[] = [
        { role: 'system', content: prompts.homeworkAnalyzer.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.homeworkAnalyzer.buildUserPrompt({
            documentName: document.name,
            documentText: buildDocumentText(chunks),
            language: 'mixed',
          }),
        },
      ]
      const { data } = await ai.chatJSON<unknown>(messages)
      incoming = normalizeQuestions(data, chunks, document)
    } catch (err) {
      // The AI failed / returned nothing usable: leave every existing question
      // and record untouched.
      return { set: await this.failSet(set, friendlyAIError(err)), summary: EMPTY_REANALYSIS_SUMMARY }
    }

    if (incoming.length === 0) {
      return { set: await this.failSet(set, t('homework.noQuestions')), summary: EMPTY_REANALYSIS_SUMMARY }
    }

    const { summary, pendingIds } = await this.commitReanalysis(set, document, incoming)

    // Generate the content the commit marked pending. Each failure is isolated
    // and only affects its own question.
    let failed = 0
    for (const id of pendingIds) {
      const question = await this.generateContent(id)
      if (question?.generationStatus === 'failed') failed += 1
    }

    const finalSet = (await this.homework.getSet(set.id)) ?? set
    return { set: finalSet, summary: { ...summary, failed } }
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
  ): Promise<ReanalysisCommit> {
    const now = Date.now()
    const summary: ReanalysisSummary = { ...EMPTY_REANALYSIS_SUMMARY }
    const pendingIds: string[] = []

    await this.db.transaction('rw', this.db.homeworkSets, this.db.homeworkQuestions, async () => {
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

      await this.homework.upsertSet({
        ...set,
        status: 'ready',
        questionCount: rows.length,
        errorMessage: undefined,
        updatedAt: now,
      })
    })

    return { summary, pendingIds }
  }

  private async runGenerateContent(questionId: string): Promise<HomeworkQuestion | undefined> {
    const question = await this.homework.getQuestion(questionId)
    if (!question) return undefined
    await this.homework.updateQuestion(questionId, {
      generationStatus: 'pending',
      generationError: undefined,
    })
    try {
      const ai = this.requireAI()
      const sourceText = await this.sourceText(question)
      const { data } = await ai.chatJSON<unknown>([
        { role: 'system', content: prompts.homeworkQuestion.buildSystemPrompt() },
        {
          role: 'user',
          content: prompts.homeworkQuestion.buildUserPrompt({
            question: question.prompt,
            sourceText,
            language: currentLanguage(),
          }),
        },
      ])
      const { hints, solution } = normalizeQuestionContent(data)
      return this.homework.applyGeneratedContent(
        questionId,
        hints,
        solution,
        HOMEWORK_QUESTION_PROMPT_VERSION,
      )
    } catch (err) {
      // Keep the row (and any previous hints/solution + all student fields).
      return this.homework.updateQuestion(questionId, {
        generationStatus: 'failed',
        generationError: friendlyAIError(err),
      })
    }
  }

  private async failSet(set: HomeworkSet, message: string): Promise<HomeworkSet> {
    // Never touch the questions here: on a failed re-analysis the existing
    // questions and every student record must stay exactly as they were.
    const failed: HomeworkSet = {
      ...set,
      status: 'failed',
      errorMessage: message,
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

function toSourceRef(chunk: DocumentChunk, document: Document): SourceReference {
  const ref: SourceReference = { documentId: document.id, documentName: document.name }
  if (chunk.pageNumber !== undefined) ref.page = chunk.pageNumber
  const section = chunk.sectionTitle ?? chunk.section
  if (section) ref.section = section
  const quote = chunk.text.trim().slice(0, 240)
  if (quote) ref.quote = quote
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
 * An invented id simply fails the filter — it is never accepted, and a question
 * with no grounded passage is dropped rather than stored with a fake source.
 */
export function normalizeQuestions(
  raw: unknown,
  chunks: readonly DocumentChunk[],
  document: Document,
): NormalizedQuestion[] {
  const record = asRecord(raw)
  const items = asArray(record?.questions)
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const out: NormalizedQuestion[] = []
  for (const item of items) {
    if (out.length >= MAX_QUESTIONS) break
    const entry = asRecord(item)
    if (!entry) continue
    const prompt = asTrimmedString(entry.prompt)
    if (!prompt) continue
    const ids = asStringArray(entry.sourceChunkIds).filter((id) => byId.has(id))
    if (ids.length === 0) continue
    const number = asTrimmedString(entry.number)
    out.push({
      ...(number ? { number } : {}),
      prompt,
      sourceRefs: ids.map((id) => toSourceRef(byId.get(id)!, document)),
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
