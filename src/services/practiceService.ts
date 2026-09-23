import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { PracticeRepository } from '@/entities/practice/repository'
import type {
  PracticeAttempt,
  PracticeQuestion,
  PracticeQuestionOption,
  PracticeSet,
  ProfessorQuestionStyleProfile,
} from '@/entities/practice/types'
import { PRACTICE_STYLE_PROMPT_VERSION, styleConfidenceFor } from '@/entities/practice/types'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import { buildChunkRelinkIndex, chunkContentFingerprint, relinkChunkReference } from '@/entities/chunk/relink'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import type { CourseContext } from '@/entities/courseContext/types'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { resolveMaterialType } from '@/entities/document/types'
import { parsePracticeQuestions } from '@/infrastructure/files/practiceExtraction'
import { compareMath, numericEquivalent } from '@/infrastructure/math/expressionEvaluator'
import { matchChunkToTopic, overlapScore } from './classProgressService'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'
import { fnv1a } from '@/shared/lib/hash'

/** Extraction confidence at or above this is imported without a review step. */
const AUTO_VERIFY_CONFIDENCE = 0.6

const INSTRUCTION_VERBS = [
  'find',
  'calculate',
  'compute',
  'determine',
  'evaluate',
  'solve',
  'derive',
  'show',
  'prove',
  'explain',
  'sketch',
  'simplify',
  'classify',
]

function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Textbook chunk a practice question best matches, for chapter binding. */
function bestTextbookChunk(prompt: string, textbook: DocumentChunk[]): DocumentChunk | undefined {
  let best: { chunk: DocumentChunk; score: number } | null = null
  for (const chunk of textbook) {
    const score = overlapScore(prompt, chunk.text)
    if (!best || score > best.score) best = { chunk, score }
  }
  return best && best.score > 0 ? best.chunk : undefined
}

/**
 * Render the question-style profile as prompt context.
 *
 * Only observed evidence is stated; the sample size is always included so the
 * model cannot overclaim the professor's style.
 */
export function formatQuestionStyleContext(profile: ProfessorQuestionStyleProfile): string {
  const lines: string[] = [
    `Based on ${profile.sampleSize} uploaded practice question(s) (${profile.confidence.replace('_', ' ')} evidence).`,
  ]
  const types = Object.entries(profile.questionTypeDistribution)
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ')
  if (types) lines.push(`Question types observed: ${types}.`)
  const { calculation, conceptual, mixed } = profile.calculationVsConceptual
  lines.push(`Calculation-oriented: ${calculation}, conceptual: ${conceptual}, mixed: ${mixed}.`)
  const optionCounts = Object.entries(profile.optionCountDistribution)
    .map(([count, n]) => `${count}-option: ${n}`)
    .join(', ')
  if (optionCounts) lines.push(`Option counts: ${optionCounts}.`)
  if (profile.visualQuestionCount > 0) {
    lines.push(`Questions that include a figure: ${profile.visualQuestionCount}.`)
  }
  if (profile.instructionPatterns.length > 0) {
    lines.push(`Common instructions: ${profile.instructionPatterns.join(', ')}.`)
  }
  if (profile.wordingPatterns.length > 0) {
    lines.push(`Wording: ${profile.wordingPatterns.join(', ')}.`)
  }
  if (profile.answerFormatPatterns.length > 0) {
    lines.push(`Answer format: ${profile.answerFormatPatterns.join(', ')}.`)
  }
  return lines.join('\n')
}

export interface PracticeProgress {
  total: number
  completed: number
  correct: number
  needsReview: number
}

export interface PracticeFeedback {
  isCorrect?: boolean
  expectedAnswer?: string
  method: PracticeAttempt['method']
  /** 'professor' when the source document supplied the answer. */
  answerSource: PracticeQuestion['answerSource']
}

/**
 * Professor Practice: importing questions, answering them, and deriving the
 * professor's question style.
 *
 * The bank is a separate store from the quiz system, but grading reuses the
 * exact same math evaluator the quiz uses — there is no second grader.
 */
export class PracticeService {
  private db: AppDatabase
  private practice: PracticeRepository
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private analyses: CourseAnalysisRepository
  private contexts: CourseContextRepository
  private visuals: VisualSourceRepository

  constructor(deps: { db?: AppDatabase } = {}) {
    this.db = deps.db ?? getDb()
    this.practice = new PracticeRepository(this.db)
    this.documents = new DocumentRepository(this.db)
    this.chunks = new ChunkRepository(this.db)
    this.analyses = new CourseAnalysisRepository(this.db)
    this.contexts = new CourseContextRepository(this.db)
    this.visuals = new VisualSourceRepository(this.db)
  }

  /** Every practice question in a project (read-only). */
  listQuestionsByProject(projectId: string): Promise<PracticeQuestion[]> {
    return this.practice.listQuestionsByProject(projectId)
  }

  /**
   * Stage the questions whose cited textbook chunk needs re-pointing.
   *
   * **Pure with respect to storage**: it reads, computes, and returns the rows
   * that would change — it writes nothing. The caller commits them inside the
   * transaction that also writes the content they belong to, so a re-pointed
   * reference can never become visible on its own.
   *
   * Re-processing a document regenerates every chunk id, so a stored `chunkId`
   * goes stale without the question changing. Resolution order:
   *
   *   1. the chunk still exists → keep it (backfill the fingerprint);
   *   2. a live chunk has the same content fingerprint → re-point at it;
   *   3. legacy row without a fingerprint → same document + page, best text
   *      overlap;
   *   4. nothing matched → keep the old reference and flag `needsRelink`.
   *
   * A question is **never deleted**.
   */
  async planChunkRelink(projectId: string): Promise<PracticeQuestion[]> {
    const questions = await this.practice.listQuestionsByProject(projectId)
    const candidates = questions.filter((question) => question.chunkId !== undefined)
    if (candidates.length === 0) return []

    const liveChunks = await this.chunks.listByProject(projectId)
    const index = buildChunkRelinkIndex(liveChunks)
    const byDocument = new Map<string, DocumentChunk[]>()
    for (const chunk of liveChunks) {
      const list = byDocument.get(chunk.documentId) ?? []
      list.push(chunk)
      byDocument.set(chunk.documentId, list)
    }

    const staged: PracticeQuestion[] = []
    for (const question of candidates) {
      const resolved = relinkChunkReference(
        {
          chunkId: question.chunkId,
          ...(question.chunkFingerprint ? { fingerprint: question.chunkFingerprint } : {}),
        },
        index,
      )
      if (!resolved) continue

      if (!resolved.needsRelink) {
        // Either still live, or re-pointed by an identical fingerprint. Only
        // stage a write when something actually changes.
        if (
          resolved.chunkId === question.chunkId &&
          resolved.fingerprint === question.chunkFingerprint &&
          !question.needsRelink
        ) {
          continue
        }
        staged.push({
          ...question,
          chunkId: resolved.chunkId,
          ...(resolved.fingerprint ? { chunkFingerprint: resolved.fingerprint } : {}),
          ...(resolved.previousChunkId ? { previousChunkId: resolved.previousChunkId } : {}),
          needsRelink: false,
          relinkReason: undefined,
        })
        continue
      }

      // Legacy rows predate the fingerprint: fall back to same-page text
      // overlap before declaring the reference lost.
      if (!question.chunkFingerprint) {
        const pool = byDocument.get(question.documentId) ?? []
        const samePage =
          question.pageNumber !== undefined
            ? pool.filter((chunk) => chunk.pageNumber === question.pageNumber)
            : []
        const search = samePage.length > 0 ? samePage : pool
        let best: { chunk: DocumentChunk; score: number } | null = null
        for (const chunk of search) {
          const score = overlapScore(question.prompt, chunk.text)
          if (!best || score > best.score) best = { chunk, score }
        }
        if (best && best.score > 0) {
          staged.push({
            ...question,
            chunkId: best.chunk.id,
            chunkFingerprint: chunkContentFingerprint(best.chunk),
            previousChunkId: question.chunkId,
            needsRelink: false,
            relinkReason: undefined,
          })
          continue
        }
      }

      // Keep the original reference; a human can review it.
      staged.push({
        ...question,
        needsRelink: true,
        relinkReason: resolved.relinkReason ?? 'source-chunk-missing',
      })
    }

    if (staged.length > 0) {
      logger.debug('Professor practice chunk relink staged', {
        projectId,
        staged: staged.length,
        flagged: staged.filter((question) => question.needsRelink).length,
      })
    }
    return staged
  }

  listSets(projectId: string): Promise<PracticeSet[]> {
    return this.practice.listSets(projectId)
  }

  listQuestions(setId: string): Promise<PracticeQuestion[]> {
    return this.practice.listQuestionsBySet(setId)
  }

  listAttempts(setId: string): Promise<PracticeAttempt[]> {
    return this.practice.listAttemptsBySet(setId)
  }

  async updateQuestion(id: string, patch: Partial<PracticeQuestion>): Promise<PracticeQuestion | undefined> {
    return this.practice.updateQuestion(id, patch)
  }

  /**
   * Parse a professor-practice document into a question bank.
   *
   * Pages are parsed separately so each question keeps its page (and any
   * figure preserved for that page). One-off and cached — never re-run just
   * because the practice page is opened.
   */
  async importDocument(documentId: string): Promise<PracticeSet> {
    const document = await this.documents.get(documentId)
    if (resolveMaterialType(document.materialType) !== 'professor_practice') {
      throw new AppError(t('errors.notProfessorPractice'), 'NOT_PRACTICE_MATERIAL')
    }

    const chunks = await this.chunks.listByDocument(documentId)
    const topics = await this.analyses.listTopics(document.projectId)
    // Textbook chunks carry the chapter/section a question maps to.
    const textbookChunks = (await this.chunks.listByProject(document.projectId)).filter(
      (chunk) => resolveMaterialType(chunk.materialType) === 'textbook',
    )

    const byPage = new Map<number, typeof chunks>()
    for (const chunk of chunks) {
      const page = chunk.pageNumber ?? 0
      const list = byPage.get(page) ?? []
      list.push(chunk)
      byPage.set(page, list)
    }

    const now = Date.now()
    const setId = crypto.randomUUID()
    const questions: PracticeQuestion[] = []
    let order = 0

    for (const [page, pageChunks] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      const text = pageChunks.map((chunk) => chunk.text).join('\n\n')
      const { questions: parsed } = parsePracticeQuestions(text)
      const visuals = page > 0 ? await this.visuals.listByDocumentPage(documentId, page) : []

      for (const question of parsed) {
        const match = matchChunkToTopic(question.prompt, topics)
        const options = this.toOptions(question.options, question.answer)
        const structure = bestTextbookChunk(question.prompt, textbookChunks)
        questions.push({
          id: crypto.randomUUID(),
          projectId: document.projectId,
          setId,
          documentId,
          documentName: document.name,
          order: order++,
          ...(page > 0 ? { pageNumber: page } : {}),
          ...(pageChunks[0]?.id ? { chunkId: pageChunks[0].id } : {}),
          ...(question.number ? { number: question.number } : {}),
          type: question.type,
          prompt: question.prompt,
          options,
          ...(question.answer ? { expectedAnswer: question.answer } : {}),
          answerSource: question.answer ? 'professor' : 'none',
          ...(visuals[0]?.id ? { visualSourceId: visuals[0].id } : {}),
          ...(match ? { topicId: match.topicId } : {}),
          ...(structure?.chapterId ? { chapterId: structure.chapterId } : {}),
          ...(structure?.sectionId ? { sectionId: structure.sectionId } : {}),
          confidence: question.confidence,
          status: question.confidence >= AUTO_VERIFY_CONFIDENCE ? 'verified' : 'needs_review',
          createdAt: now,
        })
      }
    }

    const set: PracticeSet = {
      id: setId,
      projectId: document.projectId,
      documentId,
      documentName: document.name,
      name: document.name,
      questionCount: questions.length,
      sourceHash: fnv1a(chunks.map((chunk) => chunk.id).join('|')),
      createdAt: now,
      updatedAt: now,
    }

    await this.practice.upsertSet(set)
    await this.practice.addQuestions(questions)
    await this.refreshStyleProfile(document.projectId)

    logger.info('Professor practice imported', {
      documentId,
      questions: questions.length,
    })
    return set
  }

  /** Grade and store one attempt, reusing the quiz's math evaluator. */
  async recordAttempt(questionId: string, userAnswer: string): Promise<PracticeFeedback> {
    const question = await this.practice.getQuestion(questionId)
    if (!question) throw new AppError(t('errors.practiceQuestionNotFound'), 'NOT_FOUND')

    const previous = await this.practice.listAttemptsByQuestion(questionId)
    const graded = this.grade(question, userAnswer)

    await this.practice.addAttempt({
      id: crypto.randomUUID(),
      projectId: question.projectId,
      setId: question.setId,
      questionId,
      userAnswer,
      ...(graded.isCorrect !== undefined ? { isCorrect: graded.isCorrect } : {}),
      method: graded.method,
      attemptNumber: previous.length + 1,
      submittedAt: Date.now(),
    })

    return {
      ...(graded.isCorrect !== undefined ? { isCorrect: graded.isCorrect } : {}),
      ...(question.expectedAnswer ? { expectedAnswer: question.expectedAnswer } : {}),
      method: graded.method,
      answerSource: question.answerSource,
    }
  }

  async progress(setId: string): Promise<PracticeProgress> {
    const questions = await this.practice.listQuestionsBySet(setId)
    const attempts = await this.practice.listAttemptsBySet(setId)
    const latest = new Map<string, PracticeAttempt>()
    for (const attempt of attempts) latest.set(attempt.questionId, attempt)

    let correct = 0
    let needsReview = 0
    for (const attempt of latest.values()) {
      if (attempt.isCorrect === true) correct++
      else needsReview++
    }
    return { total: questions.length, completed: latest.size, correct, needsReview }
  }

  /**
   * Recompute the professor's question-style profile from the imported
   * questions. Every figure is a count over real questions, and `sampleSize`
   * caps how confidently it may be phrased.
   */
  async refreshStyleProfile(projectId: string): Promise<ProfessorQuestionStyleProfile | undefined> {
    const questions = await this.practice.listQuestionsByProject(projectId)
    if (questions.length === 0) return undefined

    const topics = await this.analyses.listTopics(projectId)
    const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]))

    const typeDistribution: ProfessorQuestionStyleProfile['questionTypeDistribution'] = {}
    const optionCountDistribution: Record<string, number> = {}
    const instructionCounts = new Map<string, number>()
    const topicCounts = new Map<string, number>()
    let visualQuestionCount = 0
    let calculation = 0
    let conceptual = 0
    let totalLength = 0

    for (const question of questions) {
      typeDistribution[question.type] = (typeDistribution[question.type] ?? 0) + 1
      if (question.options.length > 0) {
        const key = String(question.options.length)
        optionCountDistribution[key] = (optionCountDistribution[key] ?? 0) + 1
      }
      if (question.visualSourceId) visualQuestionCount++
      if (question.type === 'numeric' || question.type === 'math_expr') calculation++
      else if (question.type === 'true_false' || /\bexplain\b|\bwhy\b|concept/i.test(question.prompt)) {
        conceptual++
      }
      if (question.topicId) topicCounts.set(question.topicId, (topicCounts.get(question.topicId) ?? 0) + 1)

      totalLength += question.prompt.length
      const lower = question.prompt.toLowerCase()
      for (const verb of INSTRUCTION_VERBS) {
        if (new RegExp(`\\b${verb}\\b`).test(lower)) {
          instructionCounts.set(verb, (instructionCounts.get(verb) ?? 0) + 1)
        }
      }
    }

    const mixed = questions.length - calculation - conceptual
    const medianLength = Math.round(totalLength / questions.length)

    const profile: ProfessorQuestionStyleProfile = {
      sampleSize: questions.length,
      confidence: styleConfidenceFor(questions.length),
      questionTypeDistribution: typeDistribution,
      optionCountDistribution,
      visualQuestionCount,
      calculationVsConceptual: { calculation, conceptual, mixed },
      wordingPatterns: [
        medianLength < 120 ? 'concise problem statements' : 'longer, multi-sentence prompts',
      ],
      instructionPatterns: [...instructionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([verb, count]) => `${verb} (${count})`),
      answerFormatPatterns: [
        ...(calculation > 0 ? ['exact calculated answers'] : []),
        ...(Object.keys(optionCountDistribution).length > 0 ? ['multiple-choice letters'] : []),
      ],
      topicDistribution: [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([topicId, count]) => ({
          topicId,
          ...(topicNames.get(topicId) ? { topicName: topicNames.get(topicId)! } : {}),
          count,
        })),
      generatedAt: Date.now(),
      promptVersion: PRACTICE_STYLE_PROMPT_VERSION,
    }

    const existing = await this.contexts.get(projectId)
    const base: CourseContext = existing ?? {
      id: projectId,
      projectId,
      noteLinks: [],
      lectureLinks: [],
      sourceHash: '',
      updatedAt: Date.now(),
    }
    await this.contexts.upsert({ ...base, questionStyleProfile: profile, updatedAt: Date.now() })

    return profile
  }

  private toOptions(labels: string[], answer: string | undefined): PracticeQuestionOption[] {
    const answerLetter = answer && /^[A-Ea-e]$/.test(answer.trim()) ? answer.trim().toUpperCase() : undefined
    return labels.map((label, index) => {
      const letter = String.fromCharCode(65 + index)
      return {
        id: `opt-${index + 1}`,
        label,
        isCorrect: answerLetter !== undefined && answerLetter === letter,
      }
    })
  }

  private grade(
    question: PracticeQuestion,
    userAnswer: string,
  ): { isCorrect?: boolean; method: PracticeAttempt['method'] } {
    const expected = question.expectedAnswer
    if (!expected) return { method: 'none' }

    switch (question.type) {
      case 'single_choice':
      case 'true_false': {
        const expectedLetter = this.resolveChoiceLabel(question, expected)
        return {
          isCorrect: normalizeAnswer(userAnswer) === normalizeAnswer(expectedLetter),
          method: 'exact',
        }
      }
      case 'numeric': {
        const result = numericEquivalent(userAnswer, expected)
        return result === null ? { method: 'none' } : { isCorrect: result, method: 'numeric' }
      }
      case 'math_expr': {
        const comparison = compareMath(userAnswer, expected)
        return comparison.equivalent === null
          ? { method: 'none' }
          : { isCorrect: comparison.equivalent, method: 'symbolic' }
      }
      default:
        // Subjective / unsupported: never auto-grade.
        return { method: 'none' }
    }
  }

  /** An answer key may be a letter (`B`) or the option text itself. */
  private resolveChoiceLabel(question: PracticeQuestion, expected: string): string {
    const trimmed = expected.trim()
    if (/^[A-Ea-e]$/.test(trimmed)) return trimmed.toUpperCase()
    const index = question.options.findIndex(
      (option) => normalizeAnswer(option.label) === normalizeAnswer(trimmed),
    )
    return index >= 0 ? String.fromCharCode(65 + index) : trimmed
  }
}
