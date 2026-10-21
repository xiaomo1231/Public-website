import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import { DocumentRepository } from '@/entities/document/repository'
import { selectAnalysisDocuments } from '@/entities/courseContent/sourceHash'
import { ProjectRepository } from '@/entities/project/repository'
import { UserRepository } from '@/entities/user/repository'
import { InterviewSessionRepository } from '@/entities/interview/repository'
import type {
  InterviewQuestion,
  InterviewScenario,
  InterviewSession,
} from '@/entities/interview/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError, NotFoundError, ValidationError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { targetLanguageOf } from '@/shared/lib/language'
import { fnv1a } from '@/shared/lib/hash'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { t } from '@/i18n'
import type { AIService } from './aiService'
import { looksLikeDialogue } from './phraseCards'
import { ReviewCardService } from './reviewCardService'
import {
  buildInterviewResults,
  readPatientTurn,
  validateGeneratedScenario,
  validateTextbookScenarios,
} from './interviewValidation'

/**
 * Simulated patient interview for a language course's oral exam. Scenario
 * cards come from the textbook (every fact and question found in the course
 * text) or, when there are none, from one generated practice scenario that
 * is labelled as such. The AI patient answers only from the card; each
 * student turn is classified against the closed list of required questions;
 * the English summary is graded from verified quotes, scored locally.
 */

/** Characters of passages per scenario request. */
const PASSAGE_CHARS = 8_000
const MAX_REQUESTS = 8
/** Characters of lesson text for a generated scenario. */
const LESSON_CHARS = 6_000
/** Earlier turns sent with each new turn. */
const HISTORY_TURNS = 12
const MAX_TURN = 500
const MAX_SUMMARY = 4_000

/** Outcome of one scenario extraction run. */
export interface ScenarioExtractionRun {
  scenarios: InterviewScenario[]
  /** Requests answered / planned (a resumed run counts the earlier ones). */
  done: number
  total: number
  /** Stopped early on a pause or stop; run again with `resume` to finish. */
  paused: boolean
}

/**
 * Scenarios read by a paused extraction, per project and per request (keyed by
 * the passages it was given). Kept for this page visit only, so 「继续」 asks
 * only for the passages that were not read yet.
 */
const pausedExtractions = new Map<string, Map<string, InterviewScenario[]>>()

function batchKey(batch: readonly DocumentChunk[]): string {
  return fnv1a(batch.map((chunk) => `${chunk.id}:${chunk.text}`).join('\n\n'))
}

/** True when a paused scenario extraction is waiting to be continued. */
export function hasPausedScenarioExtraction(projectId: string): boolean {
  return pausedExtractions.has(projectId)
}

/** Test hook: forget paused extractions. */
export function clearPausedScenarioExtractionsForTesting(): void {
  pausedExtractions.clear()
}

/**
 * How much a passage looks like a scenario card: a "name, age" line, a
 * complaint, a patient label, a numbered or dashed list.
 */
export function scenarioScore(text: string): number {
  let score = 0
  if (/name\s*,?\s*(age|birth)|hogy hívják|wie heißen sie|név\b/i.test(text)) score += 3
  if (/complaint|panasz|beschwerde|symptom/i.test(text)) score += 2
  if (/^\s*(patient(in)?|páciens|beteg)\s*:?\s*$/im.test(text)) score += 2
  const listed = text.split('\n').filter((line) => /^\s*(\d+\.|[-–—•])\s*\S/.test(line)).length
  if (listed >= 5) score += 1
  if (looksLikeDialogue(text)) score += 1
  return score
}

/** Passages grouped into requests of at most `PASSAGE_CHARS`. */
function planBatches(chunks: DocumentChunk[]): DocumentChunk[][] {
  const batches: DocumentChunk[][] = []
  let size = 0
  for (const chunk of chunks) {
    const last = batches[batches.length - 1]
    if (!last || size + chunk.text.length > PASSAGE_CHARS) {
      batches.push([chunk])
      size = chunk.text.length
    } else {
      last.push(chunk)
      size += chunk.text.length
    }
  }
  return batches
}

/**
 * The passages most likely to hold scenario cards, as many as fit in the
 * request budget, back in document order.
 */
export function selectScenarioChunks(chunks: DocumentChunk[]): DocumentChunk[] {
  const scored = chunks
    .map((chunk, index) => ({ chunk, index, score: scenarioScore(chunk.text) }))
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const budget = PASSAGE_CHARS * MAX_REQUESTS
  const picked: typeof scored = []
  let used = 0
  for (const item of scored) {
    if (used + item.chunk.text.length > budget) continue
    picked.push(item)
    used += item.chunk.text.length
  }
  return picked.sort((a, b) => a.index - b.index).map((item) => item.chunk)
}

export class InterviewService {
  private db: AppDatabase
  private ai: AIService | null
  private repo: InterviewSessionRepository

  constructor(deps: { ai?: AIService | null; db?: AppDatabase } = {}) {
    this.db = deps.db ?? getDb()
    this.ai = deps.ai ?? null
    this.repo = new InterviewSessionRepository(this.db)
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('interview.noProvider'), 'NO_PROVIDER')
    return this.ai
  }

  private async language(projectId: string): Promise<string> {
    const language = targetLanguageOf(await new ProjectRepository(this.db).get(projectId))
    if (!language) throw new ValidationError(t('interview.notLanguageCourse'))
    return language
  }

  private async explanationLanguage(): Promise<'zh' | 'en'> {
    const profile = await new UserRepository(this.db).get().catch(() => undefined)
    return profile?.questionLanguage === 'en' ? 'en' : 'zh'
  }

  private async courseChunks(projectId: string): Promise<DocumentChunk[]> {
    const documents = selectAnalysisDocuments(
      await new DocumentRepository(this.db).listByProject(projectId),
    )
    const chunkRepo = new ChunkRepository(this.db)
    const chunks: DocumentChunk[] = []
    for (const doc of documents) chunks.push(...(await chunkRepo.listByDocument(doc.id)))
    return chunks
  }

  list(projectId: string): Promise<InterviewSession[]> {
    return this.repo.listByProject(projectId)
  }

  async get(projectId: string, id: string): Promise<InterviewSession> {
    const session = await this.repo.get(id)
    if (!session || session.projectId !== projectId) throw new NotFoundError('InterviewSession', id)
    return session
  }

  delete(id: string): Promise<void> {
    return this.repo.delete(id)
  }

  /** Scenario cards found in the course's processed material. */
  async extractScenarios(
    projectId: string,
    options: {
      signal?: AbortSignal
      control?: GenerationControl
      resume?: boolean
      onProgress?: (done: number, total: number) => void
    } = {},
  ): Promise<InterviewScenario[]> {
    return (await this.extractScenariosRun(projectId, options)).scenarios
  }

  /**
   * `extractScenarios` with its progress. A pause lets the request in flight
   * finish and asks no more; a stop aborts it (not a failure). With `resume`
   * the requests a paused run already answered are reused, not sent again.
   */
  async extractScenariosRun(
    projectId: string,
    options: {
      signal?: AbortSignal
      control?: GenerationControl
      resume?: boolean
      onProgress?: (done: number, total: number) => void
    } = {},
  ): Promise<ScenarioExtractionRun> {
    const control = resolveControl(options.control, options.signal)
    const ai = this.requireAI()
    const language = await this.language(projectId)
    const candidates = selectScenarioChunks(await this.courseChunks(projectId))
    const earlier = options.resume ? pausedExtractions.get(projectId) : undefined
    pausedExtractions.delete(projectId)
    if (candidates.length === 0) return { scenarios: [], done: 0, total: 0, paused: false }
    const byId = new Map(candidates.map((chunk) => [chunk.id, chunk]))
    const batches = planBatches(candidates)
    const answered = new Map<string, InterviewScenario[]>()
    let failed = 0
    let firstError: unknown = null
    let paused = false
    for (const [index, batch] of batches.entries()) {
      const key = batchKey(batch)
      const reused = earlier?.get(key)
      if (reused) {
        answered.set(key, reused)
        options.onProgress?.(index + 1, batches.length)
        continue
      }
      if (!control.shouldContinue()) {
        paused = true
        continue
      }
      try {
        const { data } = await ai.chatJSON<unknown>(
          [
            {
              role: 'system',
              content: prompts.interviewScenario.buildSystemPrompt({
                mode: 'extract',
                targetLanguage: language,
              }),
            },
            {
              role: 'user',
              content: prompts.interviewScenario.buildUserPrompt({
                mode: 'extract',
                targetLanguage: language,
                passages: batch.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
              }),
            },
          ],
          { maxTokens: 6144, signal: control.signal },
        )
        answered.set(
          key,
          validateTextbookScenarios(prompts.interviewScenario.readScenarios(data), byId),
        )
      } catch (err) {
        // A stopped request is an interruption, never a failed part.
        if (isAbortError(err, control.signal)) {
          paused = true
          continue
        }
        failed++
        firstError ??= err
        logger.warn('Interview scenario extraction part failed', {
          part: index,
          error: (err as Error)?.message,
        })
      }
      options.onProgress?.(index + 1, batches.length)
    }
    if (paused) pausedExtractions.set(projectId, answered)
    else if (failed === batches.length && firstError) throw firstError
    const seen = new Set<string>()
    const scenarios = batches
      .flatMap((batch) => answered.get(batchKey(batch)) ?? [])
      .filter((scenario) => {
        const key = scenario.facts.map((fact) => fact.fact.toLowerCase()).join('|')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    return { scenarios, done: answered.size + failed, total: batches.length, paused }
  }

  /**
   * The course's required-question list: the checklist of the most recent
   * textbook scenario the student practised, if any.
   */
  async courseRequiredQuestions(projectId: string): Promise<InterviewQuestion[] | undefined> {
    const sessions = await this.repo.listByProject(projectId)
    return sessions.find((session) => session.scenario.source === 'textbook')?.scenario.questions
  }

  /** One simple practice scenario written from the course's lesson passages. */
  async generateScenario(
    projectId: string,
    options: {
      requiredQuestions?: Array<Pick<InterviewQuestion, 'label' | 'englishGloss'>>
      signal?: AbortSignal
    } = {},
  ): Promise<InterviewScenario> {
    const ai = this.requireAI()
    const language = await this.language(projectId)
    const chunks = await this.courseChunks(projectId)
    if (chunks.length === 0) throw new ValidationError(t('interview.noMaterial'))
    const dialogues = chunks.filter((chunk) => looksLikeDialogue(chunk.text))
    const passages: DocumentChunk[] = []
    let size = 0
    for (const chunk of dialogues.length ? dialogues : chunks) {
      if (size + chunk.text.length > LESSON_CHARS && passages.length) break
      passages.push(chunk)
      size += chunk.text.length
    }
    const required = options.requiredQuestions ?? (await this.courseRequiredQuestions(projectId))
    const { data } = await ai.chatJSON<unknown>(
      [
        {
          role: 'system',
          content: prompts.interviewScenario.buildSystemPrompt({
            mode: 'generate',
            targetLanguage: language,
          }),
        },
        {
          role: 'user',
          content: prompts.interviewScenario.buildUserPrompt({
            mode: 'generate',
            targetLanguage: language,
            passages: passages.map((chunk) => ({
              chunkId: chunk.id,
              text: chunk.text.slice(0, LESSON_CHARS),
            })),
            ...(required?.length ? { requiredQuestions: required } : {}),
          }),
        },
      ],
      { maxTokens: 4096, ...(options.signal ? { signal: options.signal } : {}) },
    )
    const scenario = validateGeneratedScenario(
      prompts.interviewScenario.readScenarios(data)[0],
      required,
    )
    if (!scenario) throw new AppError(t('interview.generateInvalid'), 'INVALID_RESPONSE')
    return scenario
  }

  /** Start an interview on a scenario the student picked. */
  async start(
    projectId: string,
    scenario: InterviewScenario,
    options: { examMode?: boolean } = {},
  ): Promise<InterviewSession> {
    const targetLanguage = await this.language(projectId)
    const now = Date.now()
    return this.repo.put({
      id: crypto.randomUUID(),
      projectId,
      targetLanguage,
      scenario,
      examMode: options.examMode === true,
      turns: [],
      summary: '',
      status: 'interviewing',
      createdAt: now,
      updatedAt: now,
    })
  }

  /** Read-modify-write of one session; null when it was deleted meanwhile. */
  private async update(
    id: string,
    change: (session: InterviewSession) => InterviewSession,
  ): Promise<InterviewSession> {
    return this.db.transaction('rw', this.db.interviewSessions, async () => {
      const current = await this.repo.get(id)
      if (!current) throw new NotFoundError('InterviewSession', id)
      return this.repo.put({ ...change(current), updatedAt: Date.now() })
    })
  }

  /**
   * The student's turn and the patient's answer. Nothing is stored when the
   * AI reply is unusable, so the student can send the turn again.
   */
  async ask(
    projectId: string,
    sessionId: string,
    text: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<InterviewSession> {
    const ai = this.requireAI()
    const turn = text.trim().slice(0, MAX_TURN)
    if (!turn) throw new ValidationError(t('interview.emptyTurn'))
    const session = await this.get(projectId, sessionId)
    if (session.status !== 'interviewing') throw new ValidationError(t('interview.ended'))
    const { data } = await ai.chatJSON<unknown>(
      [
        {
          role: 'system',
          content: prompts.interviewPatient.buildSystemPrompt({
            targetLanguage: session.targetLanguage,
          }),
        },
        {
          role: 'user',
          content: prompts.interviewPatient.buildUserPrompt({
            targetLanguage: session.targetLanguage,
            explanationLanguage: await this.explanationLanguage(),
            facts: session.scenario.facts,
            questions: session.scenario.questions,
            history: session.turns
              .slice(-HISTORY_TURNS)
              .map(({ role, text: said }) => ({ role, text: said })),
            studentTurn: turn,
          }),
        },
      ],
      { maxTokens: 1024, ...(options.signal ? { signal: options.signal } : {}) },
    )
    // A stopped turn stores nothing: the session stays as it was.
    options.signal?.throwIfAborted()
    const reply = readPatientTurn(
      data,
      session.scenario.questions.map((q) => q.id),
    )
    if (!reply) throw new AppError(t('interview.replyInvalid'), 'INVALID_RESPONSE')
    const now = Date.now()
    return this.update(sessionId, (current) => ({
      ...current,
      turns: [
        ...current.turns,
        {
          role: 'student',
          text: turn,
          at: now,
          coveredQuestionIds: reply.coveredQuestionIds,
          ...(reply.correction ? { correction: reply.correction } : {}),
        },
        { role: 'patient', text: reply.reply, at: now },
      ],
    }))
  }

  /** Stop asking and move on to the English summary. */
  endInterview(sessionId: string): Promise<InterviewSession> {
    return this.update(sessionId, (current) => ({
      ...current,
      status: current.status === 'graded' ? 'graded' : 'summarizing',
    }))
  }

  /** Keep a summary draft. */
  saveSummary(sessionId: string, summary: string): Promise<InterviewSession> {
    return this.update(sessionId, (current) => ({
      ...current,
      summary: summary.slice(0, MAX_SUMMARY),
    }))
  }

  /**
   * Grade the English summary: per fact, the AI must quote the summary; the
   * quotes are verified and the score computed locally. Communication is an
   * AI estimate. On failure nothing is stored except the summary draft.
   */
  async grade(
    projectId: string,
    sessionId: string,
    summary: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<InterviewSession> {
    const ai = this.requireAI()
    const text = summary.trim().slice(0, MAX_SUMMARY)
    if (text.replace(/\s+/g, '').length < 4) throw new ValidationError(t('interview.summaryEmpty'))
    const session = await this.get(projectId, sessionId)
    await this.saveSummary(sessionId, text)
    const { data } = await ai.chatJSON<unknown>(
      [
        {
          role: 'system',
          content: prompts.interviewSummaryCheck.buildSystemPrompt({
            targetLanguage: session.targetLanguage,
          }),
        },
        {
          role: 'user',
          content: prompts.interviewSummaryCheck.buildUserPrompt({
            targetLanguage: session.targetLanguage,
            explanationLanguage: await this.explanationLanguage(),
            facts: session.scenario.facts,
            studentTurns: session.turns
              .filter((turn) => turn.role === 'student')
              .map((turn) => turn.text),
            summary: text,
          }),
        },
      ],
      { maxTokens: 2048, ...(options.signal ? { signal: options.signal } : {}) },
    )
    // A stopped check grades nothing (the summary draft is kept).
    options.signal?.throwIfAborted()
    if (!data || typeof data !== 'object' || !Array.isArray((data as { facts?: unknown }).facts))
      throw new AppError(t('interview.gradeInvalid'), 'INVALID_RESPONSE')
    return this.update(sessionId, (current) => ({
      ...current,
      summary: text,
      status: 'graded',
      results: buildInterviewResults({ ...current, summary: text }, data),
    }))
  }

  /**
   * Phrase cards for the required questions the student did not ask:
   * front = English gloss, back = the question in the target language.
   * Returns how many cards were added (existing fronts skipped).
   */
  async addMissedToPhraseCards(projectId: string, sessionId: string): Promise<number> {
    const session = await this.get(projectId, sessionId)
    const asked = new Set(
      session.results?.questions.askedIds ??
        session.turns.flatMap((turn) => turn.coveredQuestionIds ?? []),
    )
    const missed = session.scenario.questions.filter(
      (q) => !asked.has(q.id) && q.label.trim() && q.label !== q.englishGloss,
    )
    return new ReviewCardService(this.db).addMany(
      projectId,
      missed.map((q) => ({ front: q.englishGloss, back: q.label, source: 'phrase' as const })),
    )
  }
}
