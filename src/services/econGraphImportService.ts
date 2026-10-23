/**
 * 「把这张图做成可交互图并出同类题」: a supply-and-demand graph of a
 * recognised past-exam / homework question (a course page, a photo the
 * student uploads, or one of their answer pictures) becomes an exact,
 * interactive market and the source of similar questions.
 *
 *   1. `candidates(question)`: the pictures to read — figures stored with the
 *      question's source pages, the source pages rendered, the answer pictures.
 *   2. `read(question, image)`: the vision model reads the curves, the axis
 *      scale, the change and what is asked (`econ-graph-read/v1`, full output
 *      cap, stoppable); the reply is parsed (`parseMarketSpec`) and solved
 *      (`solveMarket`) locally (`readGraphReply`). Nothing is stored.
 *   3. The student compares the rebuilt diagram with the original and
 *      confirms it (the UI); `compare(question, reading)` recomputes the
 *      professor's answer, when there is one: a disagreement flags the graph
 *      and it is not used for variants.
 *   4. `createVariants(question, reading, count)`: new numbers, same
 *      structure (`marketVariantSet`), stored as a practice set under the
 *      question's set (改编题: `practice.sourceQuestionId`). Every answer is
 *      the engine's.
 */
import type { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { renderPdfPageImage } from '@/infrastructure/files/pdfExtractor'
import { HomeworkRepository } from '@/entities/homework/repository'
import { AnswerImageRepository } from '@/entities/homework/answerImageRepository'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { DocumentRepository } from '@/entities/document/repository'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import {
  compareWithKey,
  readGraphReply,
  type GraphReading,
  type KeyComparison,
} from '@/entities/econ/graphRead'
import { marketVariantSet, type MarketLanguage } from '@/entities/econ/graphGenerator'
import { rubricLinePoints, type MarketQuestion } from '@/entities/econ/graphQuestion'
import { createRng } from '@/entities/homework/practice/random'
import { bytesToDataUrl, isVisionUnsupportedError } from './answerImagesAI'
import { loadProjectSubject } from './projectSubject'
import { t } from '@/i18n'

export type GraphImageSource =
  | { kind: 'visual'; visualSourceId: string; page: number }
  | { kind: 'page'; documentId: string; page: number }
  | { kind: 'answer'; imageId: string; index: number }
  | { kind: 'upload' }

export interface GraphImage {
  source: GraphImageSource
  bytes: ArrayBuffer
  mimeType: string
}

/** A short fingerprint of the marks lines of a professor answer (rubric lines). */
const MARK_LINE =
  /\(\s*\d+(?:\.\d+)?\s*(?:marks?|pts?|points?|分)\s*\)|\[\s*\d+\s*\]|\b[MAB]\d\b|\d\s*分/i

export const MAX_GRAPH_VARIANTS = 6

export class EconGraphImportService {
  private ai: AIService | null
  private db: AppDatabase
  private homework: HomeworkRepository

  constructor(deps: { ai: AIService | null; db?: AppDatabase }) {
    this.ai = deps.ai
    this.db = deps.db ?? getDb()
    this.homework = new HomeworkRepository(this.db)
  }

  hasAI(): boolean {
    return !!this.ai
  }

  /** The action is offered in economics courses only. */
  async available(projectId: string): Promise<boolean> {
    return (await loadProjectSubject(projectId, this.db)) === 'economics'
  }

  /** The pictures of a question that may show its graph (photos first). */
  async candidates(question: HomeworkQuestion): Promise<GraphImage[]> {
    const out: GraphImage[] = []
    // The student's own pictures (photos of the paper) come first.
    const answers = await new AnswerImageRepository(this.db).list(question.id)
    answers.forEach((image, index) =>
      out.push({
        source: { kind: 'answer', imageId: image.id, index: index + 1 },
        bytes: image.bytes,
        mimeType: image.mimeType,
      }),
    )
    const visuals = new VisualSourceRepository(this.db)
    const pages = new Map<string, Set<number>>()
    for (const ref of question.sourceRefs) {
      if (!ref.page) continue
      pages.set(ref.documentId, (pages.get(ref.documentId) ?? new Set()).add(ref.page))
    }
    for (const [documentId, numbers] of pages) {
      for (const page of numbers) {
        const figures = await visuals.listByDocumentPage(documentId, page)
        let found = false
        for (const figure of figures) {
          if (figure.unsupportedFormat) continue
          const blob = await visuals.getImage(figure.id)
          if (!blob) continue
          found = true
          out.push({
            source: { kind: 'visual', visualSourceId: figure.id, page },
            bytes: await blob.arrayBuffer(),
            mimeType: blob.type || figure.imageMimeType,
          })
        }
        if (!found) {
          const rendered = await this.renderPage(documentId, page)
          if (rendered) out.push({ source: { kind: 'page', documentId, page }, ...rendered })
        }
      }
    }
    return out
  }

  private async renderPage(
    documentId: string,
    page: number,
  ): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
    try {
      const documents = new DocumentRepository(this.db)
      const document = await documents.get(documentId)
      const stored = document ? await documents.getBytes(document.id) : null
      if (!document || !stored) return null
      if (document.type === 'image') return { bytes: stored.bytes, mimeType: stored.mimeType }
      if (document.type !== 'pdf') return null
      const rendered = await renderPdfPageImage(
        new Blob([stored.bytes], { type: stored.mimeType }),
        page,
        1.5,
      )
      return rendered ? { bytes: rendered.bytes, mimeType: rendered.mimeType } : null
    } catch {
      return null
    }
  }

  /** Read one picture with the vision model; parsed and solved locally (nothing stored). */
  async read(
    question: Pick<HomeworkQuestion, 'prompt' | 'projectId'>,
    image: Pick<GraphImage, 'bytes' | 'mimeType'>,
    options: { signal?: AbortSignal; language?: MarketLanguage } = {},
  ): Promise<GraphReading> {
    if (!this.ai) throw new AppError(t('econGraph.noAi'), 'MISSING_API_KEY')
    const language = options.language ?? 'zh'
    const messages = [
      { role: 'system' as const, content: prompts.econGraphRead.buildSystemPrompt() },
      {
        role: 'user' as const,
        content: prompts.econGraphRead.buildUserPrompt({ question: question.prompt, language }),
        images: [bytesToDataUrl(image.bytes, image.mimeType)],
      },
    ]
    let data: unknown
    try {
      // The whole output cap (AIService); a stop aborts the request.
      const reply = await this.ai.chatJSON<unknown>(messages, {
        ...(options.signal ? { signal: options.signal } : {}),
        usageKind: 'quiz',
      })
      data = reply.data
    } catch (err) {
      if (!options.signal?.aborted && isVisionUnsupportedError(err))
        throw new AppError(t('econGraph.visionUnsupported'), 'VISION_UNSUPPORTED', err)
      throw err
    }
    const result = readGraphReply(data)
    if (!result.ok)
      throw new AppError(t('econGraph.unreadable', { reason: result.reason }), 'INVALID_RESPONSE')
    return result.reading
  }

  /** The professor's answer recomputed against the rebuilt graph; null without one. */
  compare(question: HomeworkQuestion, reading: GraphReading): KeyComparison | null {
    const key = question.answerStatus === 'matched' ? question.answerText?.trim() : undefined
    if (!key) return null
    return compareWithKey(reading, key)
  }

  /**
   * Similar questions from a CONFIRMED reading (the caller has the student's
   * confirmation and a non-disagreeing comparison), as a practice set under
   * the question's set. Professor marking lines (with marks) of the answer
   * are kept as the drawing parts' rubric.
   */
  async createVariants(
    question: HomeworkQuestion,
    reading: GraphReading,
    options: {
      count?: number
      language?: MarketLanguage
      seed?: string
      comparison?: KeyComparison | null
    } = {},
  ): Promise<HomeworkSet> {
    if (options.comparison?.status === 'disagree')
      throw new AppError(t('econGraph.disagreeBlocked'), 'VALIDATION_ERROR')
    const parent = await this.homework.getSet(question.setId)
    if (!parent || parent.projectId !== question.projectId)
      throw new NotFoundError('HomeworkSet', question.setId)
    const language = options.language ?? 'zh'
    const asks = reading.asks.length
      ? reading.asks
      : [
          {
            label: '',
            question: {
              kind: 'shift_id' as const,
              figure: { ...reading.figure, show: 'before' as const },
            } satisfies MarketQuestion,
          },
        ]
    const rubricLines = this.rubricLines(question)
    const withRubric = asks.map((ask) =>
      ask.question.kind === 'draw_diagram' && rubricLines.length
        ? {
            ...ask,
            question: {
              ...ask.question,
              rubric: { source: 'professor' as const, lines: rubricLines },
            },
          }
        : ask,
    )
    const count = Math.min(MAX_GRAPH_VARIANTS, Math.max(1, Math.round(options.count ?? 3)))
    const rng = createRng(options.seed ?? `${question.id}:${Date.now()}`)
    const now = Date.now()
    const setId = crypto.randomUUID()
    const questions: HomeworkQuestion[] = []
    const seen = new Set<string>()
    for (let attempt = 0; questions.length < count && attempt < count * 4; attempt += 1) {
      const variant = marketVariantSet(withRubric, rng, language)
      if (!variant) continue
      const prompt = [
        variant.stem,
        ...variant.parts.map((part) =>
          part.label ? `(${part.label}) ${part.prompt}` : part.prompt,
        ),
      ].join('\n\n')
      if (seen.has(prompt)) continue
      seen.add(prompt)
      questions.push({
        id: crypto.randomUUID(),
        projectId: question.projectId,
        setId,
        documentId: parent.documentId,
        documentName: parent.documentName,
        order: questions.length,
        number: String(questions.length + 1),
        prompt,
        sourceRefs: [],
        hints: [],
        solution: variant.parts
          .map((part) => (part.label ? `**(${part.label})** ${part.solution}` : part.solution))
          .join('\n\n'),
        generationStatus: 'ready',
        promptVersion: 'econ-graph-read/v1',
        practice: {
          origin: 'local',
          parts: variant.parts.map((part) => ({
            ...(part.label ? { label: part.label } : {}),
            answer: part.answer,
            grader: { kind: 'market', question: part.question },
          })),
          knowledgePoints: [],
          templates: ['market'],
          sourceQuestionId: question.id,
        },
        draftText: '',
        revealedHints: 0,
        solutionRevealed: false,
        messages: [],
        createdAt: now,
        updatedAt: now,
      })
    }
    if (questions.length === 0)
      throw new AppError(t('econGraph.unreadable', { reason: 'variants' }), 'VALIDATION_ERROR')
    const set: HomeworkSet = {
      id: setId,
      projectId: question.projectId,
      documentId: parent.documentId,
      documentName: parent.documentName,
      title: t('econGraph.setTitle', { title: parent.title }),
      status: 'ready',
      language: parent.language,
      questionCount: questions.length,
      promptVersion: 'econ-graph-read/v1',
      kind: 'practice',
      parentSetId: parent.id,
      practice: {
        mode: 'full',
        requested: count,
        dropped: count - questions.length,
        generatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    }
    await this.db.transaction('rw', this.db.homeworkSets, this.db.homeworkQuestions, async () => {
      await this.homework.upsertSet(set)
      await this.homework.addQuestions(questions)
    })
    return set
  }

  /** Marking lines of the professor's answer (lines that carry marks), when matched. */
  private rubricLines(question: HomeworkQuestion): string[] {
    if (question.answerStatus !== 'matched' || !question.answerText) return []
    return question.answerText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && MARK_LINE.test(line) && rubricLinePoints(line) > 0)
      .slice(0, 12)
  }
}
