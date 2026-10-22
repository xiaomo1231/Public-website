import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { renderPdfPageImage } from '@/infrastructure/files/pdfExtractor'
import { t } from '@/i18n'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { DocumentChunk } from '@/entities/chunk/types'
import { DocumentRepository } from '@/entities/document/repository'
import type { Document } from '@/entities/document/types'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import type {
  HomeworkQuestion,
  HomeworkQuestionEdit,
  HomeworkSelfTest,
  HomeworkSet,
  TeacherMark,
} from '@/entities/homework/types'
import { isPracticeSet } from '@/entities/homework/types'
import type { WalkthroughSection } from '@/entities/homework/walkthrough'
import {
  MATERIAL_CHANGE_SIMILARITY,
  chunkLowConfidence,
  classifyEdit,
  findProofreadRisks,
  normalizeQuestionNumber,
  reconfirmItems,
  suggestImageCompare,
  textSimilarity,
  type ProofreadRisk,
  type ReconfirmKind,
} from '@/entities/homework/proofread'
import { computeQuestionMeta, questionMetaFingerprint } from '@/entities/homework/questionMeta'
import { isHeldOut, type EvalRole } from '@/entities/evaluation/evalRole'
import { MasteryService } from './masteryService'

/** Mastery observations from a held-out self-test carry this question type. */
export const HELD_OUT_SELF_TEST_TYPE = 'held_out_self_test'

/** Edits kept per question (oldest dropped first). */
export const MAX_QUESTION_EDITS = 50

export interface ProofreadEntry {
  question: HomeworkQuestion
  /** The recognised source passage(s) of the question, as extracted. */
  sourceText: string
  risks: ProofreadRisk[]
  answerSourceText?: string
  answerRisks: ProofreadRisk[]
  /** 建议对照原图校对. */
  compareWithImage: boolean
  /** Page of the original the question starts on. */
  page?: number
  reconfirm: ReconfirmKind[]
  /** The question's walkthrough section exists (it counts as used for tuning). */
  hasWalkthroughSection: boolean
}

export interface ProofreadState {
  set: HomeworkSet
  document: Document | null
  answerDocument: Document | null
  entries: ProofreadEntry[]
}

export interface QuestionPatch {
  prompt?: string
  number?: string
  answerText?: string
}

/**
 * 导入校对 and the evaluation-role / metadata bookkeeping of homework
 * questions. Every write is one transaction that reads the current row first;
 * derived content is never rewritten here — it goes stale through its own
 * input hashes (walkthrough sections, review, checks) or through the edit
 * time (`reconfirmItems`), and is confirmed or regenerated on request.
 */
export class HomeworkProofreadService {
  private db: AppDatabase
  private homework: HomeworkRepository
  private documents: DocumentRepository
  private chunks: ChunkRepository

  constructor(deps: { db?: AppDatabase } = {}) {
    this.db = deps.db ?? getDb()
    this.homework = new HomeworkRepository(this.db)
    this.documents = new DocumentRepository(this.db)
    this.chunks = new ChunkRepository(this.db)
  }

  private async requireSet(setId: string): Promise<HomeworkSet> {
    const set = await this.homework.getSet(setId)
    if (!set) throw new NotFoundError('HomeworkSet', setId)
    return set
  }

  private async documentOrNull(id: string | undefined): Promise<Document | null> {
    if (!id) return null
    try {
      return (await this.documents.get(id)) ?? null
    } catch {
      return null
    }
  }

  /** Every walkthrough section of the set's questions (any language), latest first. */
  private async sectionsByQuestion(setId: string): Promise<Map<string, WalkthroughSection>> {
    const rows = await this.db.homeworkWalkthroughs.where('setId').equals(setId).toArray()
    const out = new Map<string, WalkthroughSection>()
    for (const row of rows.sort((a, b) => b.updatedAt - a.updatedAt)) {
      for (const section of row.sections) {
        if (section.kind !== 'question' || !section.questionId) continue
        if (!out.has(section.questionId)) out.set(section.questionId, section)
      }
    }
    return out
  }

  /** Creation times of practice sets made from each question (or from the whole set). */
  private async practiceTimes(set: HomeworkSet): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>()
    const all: number[] = []
    for (const child of await this.homework.listSets(set.projectId)) {
      if (!isPracticeSet(child) || child.parentSetId !== set.id) continue
      const questions = await this.homework.listQuestions(child.id)
      const sources = questions
        .map((question) => question.practice?.sourceQuestionId)
        .filter((id): id is string => Boolean(id))
      // A lite set is built from the whole assignment's summary.
      if (sources.length === 0) all.push(child.createdAt)
      for (const id of sources) out.set(id, [...(out.get(id) ?? []), child.createdAt])
    }
    if (all.length > 0) out.set('*', all)
    return out
  }

  async reconfirmFor(setId: string): Promise<Map<string, ReconfirmKind[]>> {
    const set = await this.requireSet(setId)
    const [questions, sections, practice] = await Promise.all([
      this.homework.listQuestions(setId),
      this.sectionsByQuestion(setId),
      this.practiceTimes(set),
    ])
    const out = new Map<string, ReconfirmKind[]>()
    for (const question of questions) {
      const section = sections.get(question.id)
      out.set(
        question.id,
        reconfirmItems(question, {
          ...(section ? { section } : {}),
          practiceSetsCreatedAt: [
            ...(practice.get(question.id) ?? []),
            ...(practice.get('*') ?? []),
          ],
        }),
      )
    }
    return out
  }

  async load(setId: string): Promise<ProofreadState> {
    const set = await this.requireSet(setId)
    const [document, answerDocument, questions, reconfirm, sections] = await Promise.all([
      this.documentOrNull(set.documentId),
      this.documentOrNull(set.answerDocumentId),
      this.homework.listQuestions(setId),
      this.reconfirmFor(setId),
      this.sectionsByQuestion(setId),
    ])
    const chunks = document ? await this.chunks.listByDocument(document.id) : []
    const answerChunks = answerDocument ? await this.chunks.listByDocument(answerDocument.id) : []
    const byId = new Map<string, DocumentChunk>(
      [...chunks, ...answerChunks].map((chunk) => [chunk.id, chunk]),
    )
    const entries = questions
      .filter((question) => !question.retired)
      .map((question): ProofreadEntry => {
        const sourceChunks = question.sourceRefs
          .map((ref) => (ref.chunkId ? byId.get(ref.chunkId) : undefined))
          .filter((chunk): chunk is DocumentChunk => Boolean(chunk))
        const sourceText = sourceChunks.map((chunk) => chunk.text).join('\n\n')
        const risks = findProofreadRisks(question.prompt, sourceText || undefined)
        const answerSource = (question.answerChunkIds ?? [])
          .map((id) => byId.get(id))
          .filter((chunk): chunk is DocumentChunk => Boolean(chunk))
        const answerSourceText = answerSource.map((chunk) => chunk.text).join('\n\n')
        const answerRisks = question.answerText
          ? findProofreadRisks(question.answerText, answerSourceText || undefined)
          : []
        const lowConfidence = [...sourceChunks, ...answerSource].some(chunkLowConfidence)
        const page = question.sourceRefs.find((ref) => ref.page)?.page
        return {
          question,
          sourceText,
          risks,
          ...(answerSourceText ? { answerSourceText } : {}),
          answerRisks,
          compareWithImage: suggestImageCompare([...risks, ...answerRisks], lowConfidence),
          ...(page ? { page } : {}),
          reconfirm: reconfirm.get(question.id) ?? [],
          hasWalkthroughSection: sections.has(question.id),
        }
      })
    return { set, document, answerDocument, entries }
  }

  /** The original page as an image (PDF pages rendered locally; image files as stored). */
  async renderPage(documentId: string, page: number): Promise<Blob | null> {
    const document = await this.documentOrNull(documentId)
    if (!document) return null
    const stored = await this.documents.getBytes(document.id)
    if (!stored) return null
    if (document.type === 'image') return new Blob([stored.bytes], { type: stored.mimeType })
    if (document.type !== 'pdf' || page < 1) return null
    const rendered = await renderPdfPageImage(
      new Blob([stored.bytes], { type: stored.mimeType }),
      page,
      1.5,
    )
    return rendered ? new Blob([rendered.bytes], { type: rendered.mimeType }) : null
  }

  /**
   * Save a proofreading correction. The edit history records before / after
   * and the kind of correction; a matched professor answer is downgraded to
   * 「需重新确认」 when the printed number no longer matches its answer
   * number, or the question text changed materially.
   */
  async saveQuestion(questionId: string, patch: QuestionPatch): Promise<HomeworkQuestion> {
    if (patch.prompt !== undefined && !patch.prompt.trim())
      throw new AppError(t('proofread.errors.emptyPrompt'), 'VALIDATION_ERROR')
    const saved = await this.db.transaction('rw', this.db.homeworkQuestions, async () => {
      const existing = await this.db.homeworkQuestions.get(questionId)
      if (!existing) return undefined
      const now = Date.now()
      const edits: HomeworkQuestionEdit[] = []
      const record = (field: HomeworkQuestionEdit['field'], before: string, after: string) => {
        if (before === after) return
        edits.push({
          at: now,
          by: 'student',
          field,
          before,
          after,
          kinds: classifyEdit(field, before, after),
        })
      }
      const next: HomeworkQuestion = { ...existing }
      if (patch.prompt !== undefined) {
        record('prompt', existing.prompt, patch.prompt)
        next.prompt = patch.prompt
      }
      if (patch.number !== undefined) {
        const number = patch.number.trim()
        record('number', existing.number ?? '', number)
        if (number) next.number = number
        else delete next.number
      }
      if (patch.answerText !== undefined && existing.answerText !== undefined) {
        if (!patch.answerText.trim())
          throw new AppError(t('proofread.errors.emptyAnswer'), 'VALIDATION_ERROR')
        record('answerText', existing.answerText, patch.answerText)
        next.answerText = patch.answerText
      }
      if (edits.length === 0) return existing
      if (existing.answerStatus === 'matched') {
        const numberMoved =
          patch.number !== undefined &&
          existing.answerNumber !== undefined &&
          normalizeQuestionNumber(next.number) !== normalizeQuestionNumber(existing.answerNumber)
        const textMoved =
          patch.prompt !== undefined &&
          textSimilarity(existing.prompt, next.prompt) < MATERIAL_CHANGE_SIMILARITY
        if (numberMoved || textMoved) {
          next.answerStatus = 'needs_review'
          next.answerLinkStale = true
        }
      }
      next.edits = [...(existing.edits ?? []), ...edits].slice(-MAX_QUESTION_EDITS)
      next.updatedAt = now
      await this.db.homeworkQuestions.put(next)
      return next
    })
    if (!saved) throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
    return saved
  }

  /** 已核对 on / off. */
  async setVerified(questionId: string, verified: boolean): Promise<HomeworkQuestion> {
    const saved = await this.homework.updateQuestion(questionId, {
      verifiedAt: verified ? Date.now() : undefined,
    })
    if (!saved) throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
    return saved
  }

  /**
   * 重新确认 the professor-answer link after a correction: the student says the
   * answer still belongs to this question.
   */
  async reconfirmAnswerLink(questionId: string): Promise<HomeworkQuestion> {
    const saved = await this.db.transaction('rw', this.db.homeworkQuestions, async () => {
      const existing = await this.db.homeworkQuestions.get(questionId)
      if (!existing || !existing.answerText) return undefined
      const next: HomeworkQuestion = {
        ...existing,
        answerStatus: 'matched',
        answerLinkStale: undefined,
        // The printed number it is linked under is now the corrected one.
        ...(existing.number ? { answerNumber: existing.number } : {}),
        updatedAt: Date.now(),
      }
      await this.db.homeworkQuestions.put(next)
      return next
    })
    if (!saved) throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
    return saved
  }

  async setTeacherMark(questionId: string, mark: Omit<TeacherMark, 'at'> | null): Promise<void> {
    await this.homework.updateQuestion(questionId, {
      teacherMark: mark ? { ...mark, at: Date.now() } : undefined,
    })
  }

  /**
   * 自测 (held-out self-test): store the result on the question and add one
   * mastery observation tagged `held_out_self_test` (knowledge point from the
   * question's local metadata, else the set title). A self-marked or
   * AI-judged result counts half, a local check fully; `uncertain` adds
   * nothing. Never written to the mistake book (no follow-up, no variants).
   */
  async recordSelfTest(
    questionId: string,
    result: Omit<HomeworkSelfTest, 'at'> & { method?: 'local' | 'ai' },
  ): Promise<void> {
    const question = await this.homework.getQuestion(questionId)
    if (!question) throw new AppError(t('homework.questionMissing'), 'NOT_FOUND')
    const set = await this.requireSet(question.setId)
    const { method, ...stored } = result
    await this.homework.updateQuestion(questionId, { selfTest: { ...stored, at: Date.now() } })
    if (result.verdict === 'uncertain') return
    await new MasteryService(this.db).recordObservation(
      question.projectId,
      question.meta?.knowledgePoints[0] ?? set.title,
      question.meta?.topicIds[0],
      {
        at: Date.now(),
        isCorrect: result.verdict === 'correct',
        difficulty: 'basic',
        questionType: HELD_OUT_SELF_TEST_TYPE,
        ...(result.verdict === 'partial' ? { credit: 0.5 } : {}),
        weight: result.by === 'check' && method === 'local' ? 1 : 0.5,
      },
    )
  }

  // -------------------------------------------------------------------------
  // Evaluation roles
  // -------------------------------------------------------------------------

  async setQuestionEvalRole(questionId: string, role: EvalRole | undefined): Promise<void> {
    await this.homework.updateQuestion(questionId, { evalRole: role })
  }

  /**
   * The whole set's role. It is copied onto the set's document and its chunks
   * (so the uploaded file is held out of course context too), in one
   * transaction.
   */
  async setSetEvalRole(setId: string, role: EvalRole | undefined): Promise<void> {
    const set = await this.requireSet(setId)
    await this.db.transaction(
      'rw',
      [this.db.homeworkSets, this.db.documents, this.db.chunks],
      async () => {
        const current = await this.db.homeworkSets.get(setId)
        if (!current) return
        await this.db.homeworkSets.put({ ...current, evalRole: role, updatedAt: Date.now() })
        await writeDocumentRole(this.db, set.documentId, role)
      },
    )
  }

  /** Any document's role (past exams, practice files, …), copied onto its chunks. */
  async setDocumentEvalRole(documentId: string, role: EvalRole | undefined): Promise<void> {
    await this.db.transaction('rw', [this.db.documents, this.db.chunks], async () => {
      await writeDocumentRole(this.db, documentId, role)
    })
  }

  // -------------------------------------------------------------------------
  // Knowledge points + exam scope (local)
  // -------------------------------------------------------------------------

  /**
   * Recompute each question's knowledge points and exam-scope links when
   * their inputs changed. Local only; rows are written only when different.
   */
  async refreshMeta(setId: string): Promise<number> {
    const set = await this.requireSet(setId)
    const topics = (await new CourseAnalysisRepository(this.db).listTopics(set.projectId)).map(
      (topic) => ({
        id: topic.id,
        name: topic.name,
        ...(topic.description ? { description: topic.description } : {}),
      }),
    )
    const syllabi = (await this.documents.listByProject(set.projectId))
      .filter((document) => document.syllabus && !isHeldOut(document))
      .map((document) => ({ documentId: document.id, syllabus: document.syllabus! }))
    let written = 0
    for (const question of await this.homework.listQuestions(setId)) {
      if (question.retired) continue
      const fingerprint = questionMetaFingerprint(question.prompt, topics, syllabi)
      if (question.meta?.fingerprint === fingerprint) continue
      const meta = computeQuestionMeta(question.prompt, topics, syllabi)
      await this.homework.updateQuestion(question.id, { meta })
      written += 1
    }
    return written
  }
}

async function writeDocumentRole(
  db: AppDatabase,
  documentId: string,
  role: EvalRole | undefined,
): Promise<void> {
  const document = await db.documents.get(documentId)
  if (!document) return
  await db.documents.put({ ...document, evalRole: role })
  const chunks = await db.chunks.where('documentId').equals(documentId).toArray()
  for (const chunk of chunks) await db.chunks.put({ ...chunk, evalRole: role })
}
