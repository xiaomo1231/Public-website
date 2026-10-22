import { AIService, asTruncatedAtCap } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import type { NormalizedImport } from '@/infrastructure/ai/prompts/walkthrough-import/v1'
import { AbortedError, OutputTruncatedError } from '@/infrastructure/ai/errors'
import { FALLBACK_OUTPUT_TOKENS } from '@/infrastructure/ai/outputLimit'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { Document } from '@/entities/document/types'
import { planAnalysisSegments } from '@/entities/courseContent/analysisInput'
import { classifyHomeworkError, isRetryableHomeworkError } from '@/entities/homework/errorKind'
import { formatHomeworkReviewText } from '@/entities/homework/reviewFormatting'
import { checkLinearSystems, involvesRowReduction } from '@/entities/homework/walkthroughChecks'
import {
  buildSourceIndex,
  checkDerivedFromSource,
  issueQuoteFound,
  type DerivationCheck,
  type SourceIndex,
} from '@/entities/homework/walkthroughImport'
import {
  buildWalkthroughTemplate,
  hasTemplateMarkers,
  parseTemplateImport,
  templateFileName,
  type TemplateProblem,
} from '@/entities/homework/walkthroughTemplate'
import type { DocumentChunk } from '@/entities/chunk/types'
import {
  generatedSource,
  IMPORTED_OTHER_SECTION_ID,
  mergeSectionWrite,
  normalizeSectionSources,
  professorAnswerOf,
  sourceOf,
  questionSectionId,
  walkthroughId,
  type WalkthroughImportIssue,
  type WalkthroughLanguage,
  type WalkthroughSection,
} from '@/entities/homework/walkthrough'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import { loadProjectSubjectContext } from './projectSubject'
import {
  HomeworkWalkthroughService,
  notifyWalkthroughChanged,
  questionLabel,
  versionOf,
  walkthroughRunProgress,
} from './homeworkWalkthroughService'
import { SettingsService } from './settingsService'
import { createGenerationRun, type GenerationControl } from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { fnv1a } from '@/shared/lib/hash'
import { t } from '@/i18n'

/**
 * Output tokens per character of the imported text. The reply is the same
 * text re-typeset, usually longer: Chinese is about a token a character, the
 * LaTeX it gains has its backslashes doubled inside JSON, and every question
 * adds a conclusion and an analysis.
 */
export const IMPORT_OUTPUT_TOKENS_PER_CHAR = 1.3
/** Room for the JSON, the conclusions and the analyses besides the body. */
export const IMPORT_OUTPUT_OVERHEAD = 1_500
/** A part is planned to fill this share of the output cap (the estimate is rough). */
const IMPORT_CAP_SHARE = 0.8
const IMPORT_MIN_SEGMENT_CHARS = 2_000
const IMPORT_MAX_SEGMENT_CHARS = 12_000
/** A piece shorter than this is not split further (it should fit any model). */
export const IMPORT_MIN_PIECE_CHARS = 600

/**
 * Characters of the imported file planned per request, so that the whole
 * reply fits the resolved output cap (`ai.maxOutputTokens`): about 3 900
 * characters for an 8 192-token cap, at most 12 000 however large the cap.
 */
export function importSegmentChars(outputCap: number): number {
  const cap = Number.isFinite(outputCap) && outputCap > 0 ? outputCap : FALLBACK_OUTPUT_TOKENS
  const fit = Math.floor(
    (cap * IMPORT_CAP_SHARE - IMPORT_OUTPUT_OVERHEAD) / IMPORT_OUTPUT_TOKENS_PER_CHAR,
  )
  return Math.min(IMPORT_MAX_SEGMENT_CHARS, Math.max(IMPORT_MIN_SEGMENT_CHARS, fit))
}

/** Part size with the default output cap (8 192 tokens). */
export const IMPORT_SEGMENT_CHARS = importSegmentChars(FALLBACK_OUTPUT_TOKENS)

/** Question text shown to the model next to each id. */
const QUESTION_PROMPT_CHARS = 400
const MAX_TRANSIENT_RETRIES = 2
const RETRY_BASE_DELAY_MS = 700

export interface WalkthroughImportOptions {
  setId: string
  documentId: string
  /** `false` — 只排版，不核对: no mistake-finding (a shorter prompt). */
  checkIssues: boolean
  control?: GenerationControl
  onProgress?: (progress: { done: number; total: number }) => void
  /** A paused preparation to continue with the parts that are left. */
  resume?: WalkthroughImportPreview
  /**
   * 「用 AI 整理剩下的」: `resume` is a template import (or a paused / failed
   * run of this) — only its unreadable question blocks go through the AI.
   */
  rest?: boolean
}

/**
 * Reading part `part` of `total` failed. `partial` keeps everything read so
 * far: pass it back as `resume` to continue from the failed piece.
 */
export class WalkthroughImportPartError extends AppError {
  readonly partial: WalkthroughImportPreview
  readonly part: number
  readonly total: number

  constructor(partial: WalkthroughImportPreview, part: number, cause: unknown) {
    super(importPartMessage(part, partial.partsTotal, cause), 'IMPORT_PART_FAILED', cause)
    this.partial = partial
    this.part = part
    this.total = partial.partsTotal
  }
}

/** The failure in the import's own words: which part, and what to do about it. */
export function importPartMessage(part: number, total: number, cause: unknown): string {
  const params = { part, total }
  if (cause instanceof OutputTruncatedError) {
    if (cause.atCap)
      return t(
        cause.atCap.by === 'model'
          ? 'walkthroughImport.errors.partTooLongModel'
          : cause.atCap.by === 'unknown'
            ? 'walkthroughImport.errors.partTooLongUnknown'
            : 'walkthroughImport.errors.partTooLongSetting',
        { ...params, limit: cause.atCap.limit },
      )
    return t('walkthroughImport.errors.partTruncated', params)
  }
  return t('walkthroughImport.errors.partFailed', { ...params, reason: friendlyAIError(cause) })
}

/** A pause or a stop while a part was being read in pieces. */
class ImportInterrupted extends Error {}

/** A section the import could not use, and why. */
export interface RejectedImportSection {
  sectionId: string
  questionId?: string
  reason: NonNullable<DerivationCheck['reason']>
}

/**
 * The prepared import, before anything is saved. `complete: false` is a
 * paused preparation (the parts read so far are kept in `parts`).
 */
export interface WalkthroughImportPreview {
  setId: string
  documentId: string
  documentName: string
  language: WalkthroughLanguage
  checkIssues: boolean
  complete: boolean
  partsTotal: number
  /** Characters per part the file was planned with (kept when resuming). */
  segmentChars?: number
  /** Replies of the parts read so far, in order. */
  parts: NormalizedImport[]
  /**
   * Pieces of the part in progress already read (by text hash), or `split`
   * when a piece was too long for one reply and is read in halves. Kept so a
   * pause or a retry asks only for what is left.
   */
  pieces?: Record<string, NormalizedImport | 'split'>
  /** Sections to save (empty until complete). */
  sections: WalkthroughSection[]
  /** Sections that already have an imported version (replaced; kept as 上一版). */
  conflicts: string[]
  /** Sections with a generated walkthrough, kept as the other source (切换「生成的讲解」). */
  keptGenerated: string[]
  rejected: RejectedImportSection[]
  /** Ids the model invented (content dropped). */
  unknownIds: string[]
  /** Questions of the assignment the file does not cover. */
  uncovered: string[]
  /** Reported issues whose quote is in neither the section nor the file. */
  droppedIssues: number
  /** The file is a filled-in 讲解模板: read locally, no AI request. */
  mode?: 'template'
  /** Sections read from the template (kept when the rest goes through the AI). */
  templateSections?: WalkthroughSection[]
  /** Question blocks of the template that could not be used as they are. */
  templateProblems?: TemplateProblem[]
  /** The unreadable blocks, as written — what 「用 AI 整理剩下的」 sends. */
  restText?: string
}

/** Between two unreadable template blocks in `restText`. */
const REST_SEPARATOR = '\n\n<!-- walkthrough-rest -->\n\n'

export interface ImportableDocument {
  id: string
  name: string
  materialType: Document['materialType']
  /** Uploaded through 导入讲解 (shown first). */
  imported: boolean
}

/**
 * 导入讲解: turn a walkthrough the student already has into this assignment's
 * 完整讲解. The file goes through the normal processing pipeline (role
 * `walkthrough_import`, reference only); one request per part of its text
 * re-typesets it and splits it by the assignment's question ids. Nothing is
 * saved until `commit`, which asks for confirmation (in the UI) when ready
 * sections would be replaced and keeps those as 上一版.
 */
export class WalkthroughImportService {
  private ai: AIService | null
  private db: AppDatabase
  private documents: DocumentRepository
  private chunks: ChunkRepository
  private repo: WalkthroughRepository
  private walkthroughs: HomeworkWalkthroughService

  constructor(deps: { ai: AIService | null; db?: AppDatabase }) {
    this.ai = deps.ai
    this.db = deps.db ?? getDb()
    this.documents = new DocumentRepository(this.db)
    this.chunks = new ChunkRepository(this.db)
    this.repo = new WalkthroughRepository(this.db)
    this.walkthroughs = new HomeworkWalkthroughService({ ai: null, db: this.db })
  }

  hasAI(): boolean {
    return this.ai !== null
  }

  /** Processed files of the project that can be imported (imported ones first). */
  async importableDocuments(projectId: string): Promise<ImportableDocument[]> {
    const documents = (await this.documents.listByProject(projectId)).filter(
      (document) =>
        document.status === 'ready' &&
        document.materialType !== 'homework' &&
        document.materialType !== 'past_exam' &&
        (document.chunkCount ?? 1) > 0,
    )
    return documents
      .map((document) => ({
        id: document.id,
        name: document.name,
        materialType: document.materialType,
        imported: document.materialType === 'walkthrough_import',
      }))
      .sort((a, b) => Number(b.imported) - Number(a.imported))
  }

  /**
   * Read the file and map it onto the assignment's questions. Pausable between
   * parts: a paused result has `complete: false` and is passed back as
   * `resume` to continue.
   */
  /**
   * 复制模板: the Markdown template of the assignment for an external AI, in
   * the walkthrough language (local, no request).
   */
  async template(setId: string): Promise<{ text: string; fileName: string }> {
    const state = await this.walkthroughs.state(setId)
    if (state.questions.length === 0)
      throw new AppError(t('homework.walkthrough.noQuestions'), 'VALIDATION_ERROR')
    const subject = await loadProjectSubjectContext(state.set.projectId, this.db)
    const linearSystems =
      subject?.subject === 'linear_algebra' ||
      state.questions.some((question) => involvesRowReduction(question.prompt))
    const title = state.set.title || state.set.documentName
    return {
      text: buildWalkthroughTemplate({
        title,
        language: state.language,
        linearSystems,
        questions: state.questions.map((question, index) => ({
          id: question.id,
          label: questionLabel(question, index),
          prompt: question.prompt,
          ...(professorAnswerOf(question) ? { hasProfessorAnswer: true } : {}),
        })),
      }),
      fileName: templateFileName(title, state.language),
    }
  }

  /** Whether a file is a filled-in 讲解模板 (imported locally, without the AI). */
  async isTemplateDocument(documentId: string): Promise<boolean> {
    const document = await this.documents.get(documentId).catch(() => undefined)
    if (!document || document.status !== 'ready') return false
    return (await this.templateText(document)) !== null
  }

  /**
   * The text of a filled-in template, or null. A text / Markdown file is read
   * from its stored bytes (processing trims lines and drops blank ones, which
   * would lose the paragraphs); any other file from its extracted text.
   */
  private async templateText(document: Document, chunks?: DocumentChunk[]): Promise<string | null> {
    if (document.type === 'text') {
      const stored = await this.documents.getBytes(document.id).catch(() => null)
      if (stored) {
        // TextDecoder drops a byte-order mark by default.
        const raw = new TextDecoder('utf-8').decode(stored.bytes)
        if (hasTemplateMarkers(raw)) return raw
      }
    }
    const list = chunks ?? (await this.chunks.listByDocument(document.id))
    const joined = list.map((chunk) => chunk.text).join('\n\n')
    return hasTemplateMarkers(joined) ? joined : null
  }

  async prepare(options: WalkthroughImportOptions): Promise<WalkthroughImportPreview> {
    const state = await this.walkthroughs.state(options.setId)
    if (state.questions.length === 0)
      throw new AppError(t('homework.walkthrough.noQuestions'), 'VALIDATION_ERROR')
    const document = await this.documents.get(options.documentId)
    if (document.projectId !== state.set.projectId)
      throw new NotFoundError('Document', options.documentId)
    if (document.status !== 'ready')
      throw new AppError(t('walkthroughImport.errors.notReady'), 'VALIDATION_ERROR')
    const documentChunks = await this.chunks.listByDocument(document.id)
    const subject = await loadProjectSubjectContext(state.set.projectId, this.db)
    const questions = state.questions.map((question, index) => ({
      id: question.id,
      label: questionLabel(question, index),
      prompt: clip(question.prompt.replace(/\s+/g, ' '), QUESTION_PROMPT_CHARS),
    }))

    const rest =
      options.rest && options.resume?.mode === 'template' && options.resume.restText
        ? options.resume
        : undefined
    if (options.rest && !rest)
      throw new AppError(t('walkthroughImport.errors.nothing'), 'VALIDATION_ERROR')
    if (!rest) {
      const templateText = await this.templateText(document, documentChunks)
      if (templateText !== null) {
        const linearSystems =
          subject?.subject === 'linear_algebra' ||
          state.questions.some((question) => involvesRowReduction(question.prompt)) ||
          involvesRowReduction(templateText.slice(0, 20_000))
        return this.prepareFromTemplate(options, state, document, templateText, linearSystems)
      }
    }

    // 「用 AI 整理剩下的」 reads only the template blocks that could not be used.
    const chunks: DocumentChunk[] = rest
      ? rest
          .restText!.split(REST_SEPARATOR)
          .map((text, order) => ({ ...documentChunks[0]!, id: `rest-${order}`, text, order }))
      : documentChunks
    const sourceText = chunks.map((chunk) => chunk.text).join('\n\n')
    if (!sourceText.trim())
      throw new AppError(t('walkthroughImport.errors.noText'), 'VALIDATION_ERROR')
    const ai = this.requireAI()
    const control = options.control ?? createGenerationRun()

    // A resumed import keeps its parts even when the output cap changed since.
    const sameImport =
      options.resume?.documentId === document.id &&
      options.resume.checkIssues === options.checkIssues
    const segmentChars =
      (sameImport ? options.resume?.segmentChars : undefined) ??
      importSegmentChars(ai.maxOutputTokens)
    const segments = planAnalysisSegments(
      [{ id: document.id, name: document.name, chunks }],
      (chunk) => chunk.text,
      segmentChars,
    )
    const linearSystems =
      subject?.subject === 'linear_algebra' ||
      state.questions.some((question) => involvesRowReduction(question.prompt)) ||
      involvesRowReduction(sourceText.slice(0, 20_000))
    // The rest may only fill questions the template did not already cover.
    const covered = new Set(
      (rest?.templateSections ?? []).map((section) => section.questionId).filter(Boolean),
    )
    const allowed = new Set(
      questions.map((question) => question.id).filter((id) => !covered.has(id)),
    )
    const system = prompts.subjectProfile.withSubject(
      prompts.walkthroughImport.buildSystemPrompt({
        checkIssues: options.checkIssues,
        linearSystems,
      }),
      subject,
    )

    const resume =
      options.resume && sameImport && options.resume.partsTotal === segments.length
        ? options.resume
        : undefined
    const parts: NormalizedImport[] = [...(resume?.parts ?? [])]
    const pieces: Record<string, NormalizedImport | 'split'> = { ...(resume?.pieces ?? {}) }
    const base: WalkthroughImportPreview = {
      setId: options.setId,
      documentId: document.id,
      documentName: document.name,
      language: state.language,
      checkIssues: options.checkIssues,
      complete: false,
      partsTotal: segments.length,
      segmentChars,
      parts,
      sections: [],
      conflicts: [],
      keptGenerated: [],
      rejected: [],
      unknownIds: [],
      uncovered: [],
      droppedIssues: 0,
      ...(rest
        ? {
            mode: 'template' as const,
            templateSections: rest.templateSections ?? [],
            templateProblems: rest.templateProblems ?? [],
            restText: rest.restText!,
          }
        : {}),
    }
    const snapshot = (): WalkthroughImportPreview => ({
      ...base,
      parts: [...parts],
      ...(Object.keys(pieces).length > 0 ? { pieces: { ...pieces } } : {}),
    })
    options.onProgress?.({ done: parts.length, total: segments.length })
    for (let index = parts.length; index < segments.length; index++) {
      // A pause stops between requests; what was read so far is kept.
      if (!control.shouldContinue()) return snapshot()
      const segment = segments[index]!
      const part = segments.length > 1 ? { index, total: segments.length } : undefined
      /** Read `texts` in one reply, or — too long even at the cap — in halves. */
      const read = async (texts: string[], fragment: boolean): Promise<NormalizedImport[]> => {
        const sourceText = texts.join('\n\n')
        const key = fnv1a(sourceText)
        const known = pieces[key]
        if (known && known !== 'split') return [known]
        const split = known === 'split' ? splitImportPieces(texts) : null
        if (split) return [...(await read(split[0], true)), ...(await read(split[1], true))]
        if (!control.shouldContinue()) throw new ImportInterrupted()
        const messages: ChatMessage[] = [
          { role: 'system', content: system },
          {
            role: 'user',
            content: prompts.walkthroughImport.buildUserPrompt({
              language: state.language,
              questions: questions.filter((question) => allowed.has(question.id)),
              sourceText,
              ...(part ? { part } : {}),
              ...(fragment ? { fragment: true } : {}),
            }),
          },
        ]
        let raw: unknown
        try {
          raw = await requestImportJSON(ai, messages, control.signal)
        } catch (err) {
          if (control.signal.aborted) throw new ImportInterrupted()
          // Too long even at the cap: read it in halves (never mid-formula).
          const halves =
            err instanceof OutputTruncatedError && err.atCap ? splitImportPieces(texts) : null
          if (!halves) throw err
          pieces[key] = 'split'
          return [...(await read(halves[0], true)), ...(await read(halves[1], true))]
        }
        const normalized = prompts.walkthroughImport.normalizeImport(raw, allowed, {
          checkIssues: options.checkIssues,
        })
        if (!normalized)
          throw new AppError(t('walkthroughImport.errors.invalid'), 'INVALID_RESPONSE')
        pieces[key] = normalized
        return [normalized]
      }
      try {
        const replies = await read(
          segment.documents.flatMap((doc) => doc.chunks.map((chunk) => chunk.text)),
          false,
        )
        parts.push(replies.length === 1 ? replies[0]! : mergeImportParts(replies))
      } catch (err) {
        if (err instanceof ImportInterrupted || control.signal.aborted) return snapshot()
        throw new WalkthroughImportPartError(snapshot(), index + 1, err)
      }
      // The part is done: its pieces are no longer needed.
      for (const key of Object.keys(pieces)) delete pieces[key]
      options.onProgress?.({ done: parts.length, total: segments.length })
    }
    const { pieces: _read, ...finished } = snapshot()
    return this.buildPreview(
      finished,
      state,
      mergeImportParts(finished.parts),
      buildSourceIndex(sourceText),
      linearSystems,
    )
  }

  /**
   * A filled-in 讲解模板: parsed locally, no AI request. Blocks that cannot be
   * used are listed; those an AI could still read are kept in `restText`.
   */
  private prepareFromTemplate(
    options: WalkthroughImportOptions,
    state: Awaited<ReturnType<HomeworkWalkthroughService['state']>>,
    document: Document,
    text: string,
    linearSystems: boolean,
  ): WalkthroughImportPreview {
    const allowed = new Set(state.questions.map((question) => question.id))
    const parsed = parseTemplateImport(text, allowed)
    const normalized = prompts.walkthroughImport.normalizeImport(parsed.reply, allowed, {
      checkIssues: false,
    })!
    const preview: WalkthroughImportPreview = {
      setId: options.setId,
      documentId: document.id,
      documentName: document.name,
      language: state.language,
      checkIssues: options.checkIssues,
      complete: true,
      partsTotal: 0,
      parts: [],
      sections: [],
      conflicts: [],
      keptGenerated: [],
      rejected: [],
      unknownIds: parsed.unknownIds,
      uncovered: [],
      droppedIssues: 0,
      mode: 'template',
      templateProblems: parsed.problems,
      ...(parsed.rest.length > 0 ? { restText: parsed.rest.join(REST_SEPARATOR) } : {}),
    }
    // The file is the walkthrough itself: nothing to check it against.
    const built = this.buildPreview(
      preview,
      state,
      mergeImportParts([normalized]),
      null,
      linearSystems,
    )
    return { ...built, templateSections: built.sections }
  }

  /**
   * Turn the merged replies into sections, keeping only what the file supports
   * (`index`; null for a template, which is the walkthrough itself). Sections
   * already read from a template are kept and not filled again.
   */
  private buildPreview(
    preview: WalkthroughImportPreview,
    state: Awaited<ReturnType<HomeworkWalkthroughService['state']>>,
    merged: NormalizedImport,
    index: SourceIndex | null,
    linearSystems: boolean,
  ): WalkthroughImportPreview {
    const base = preview.templateSections ?? []
    const taken = new Set(base.map((section) => section.id))
    const plan = new Map(state.plan.map((entry) => [entry.id, entry]))
    const stored = new Map(
      (state.walkthrough?.sections ?? []).map((section) => [section.id, section]),
    )
    const labels = new Map(
      state.questions.map((question, position) => [question.id, questionLabel(question, position)]),
    )
    const now = Date.now()
    const imported = {
      origin: 'imported' as const,
      sourceDocumentId: preview.documentId,
      generatedAt: now,
    }
    const sections: WalkthroughSection[] = [...base]
    const rejected: RejectedImportSection[] = [...preview.rejected]
    let droppedIssues = preview.droppedIssues

    for (const question of merged.questions) {
      const sectionId = questionSectionId(question.questionId)
      const entry = plan.get(sectionId)
      if (!entry || taken.has(sectionId)) continue
      const check = index
        ? checkDerivedFromSource(question.body, index)
        : ({ ok: true } as Pick<DerivationCheck, 'ok' | 'reason'>)
      if (!check.ok) {
        rejected.push({ sectionId, questionId: question.questionId, reason: check.reason! })
        continue
      }
      const issues: WalkthroughImportIssue[] = []
      for (const issue of question.issues) {
        if (index && issueQuoteFound(issue.quote, question.body, index)) issues.push(issue)
        else droppedIssues += 1
      }
      const checks = linearSystems ? checkLinearSystems(question.linearSystems) : []
      sections.push({
        id: sectionId,
        kind: 'question',
        questionId: question.questionId,
        title: labels.get(question.questionId) ?? '?',
        ...(question.analysis ? { analysis: formatHomeworkReviewText(question.analysis) } : {}),
        ...(question.conclusion
          ? { conclusion: formatHomeworkReviewText(question.conclusion) }
          : {}),
        // The author's text, only re-typeset: never altered here.
        body: formatHomeworkReviewText(question.body),
        status: 'ready',
        inputHash: entry.inputHash,
        ...(checks.length > 0 ? { checks } : {}),
        ...(issues.length > 0 ? { issues } : {}),
        ...imported,
      })
    }

    const frameHash = plan.get('overview')!.inputHash
    const frame = (
      id: 'overview' | 'summary' | typeof IMPORTED_OTHER_SECTION_ID,
      body: string,
      suggestions: string[] = [],
    ): void => {
      if ((!body.trim() && suggestions.length === 0) || taken.has(id)) return
      const check = index
        ? checkDerivedFromSource([body, ...suggestions].join('\n'), index)
        : ({ ok: true } as Pick<DerivationCheck, 'ok' | 'reason'>)
      if (!check.ok) {
        rejected.push({ sectionId: id, reason: check.reason! })
        return
      }
      sections.push({
        id,
        kind: id === IMPORTED_OTHER_SECTION_ID ? 'other' : id,
        title: id,
        body: formatHomeworkReviewText(body),
        ...(suggestions.length > 0
          ? { suggestions: suggestions.map(formatHomeworkReviewText) }
          : {}),
        status: 'ready',
        inputHash: frameHash,
        ...imported,
      })
    }
    frame('overview', merged.overview)
    frame('summary', merged.summary, merged.suggestions)
    frame(IMPORTED_OTHER_SECTION_ID, merged.other)

    const covered = new Set(
      sections.map((section) => section.questionId).filter((id): id is string => Boolean(id)),
    )
    const known = new Set(state.questions.map((question) => question.id))
    // After 「用 AI 整理剩下的」 only the problems that are still open remain.
    const restDone = preview.templateSections !== undefined
    const templateProblems = preview.templateProblems?.filter(
      (problem) =>
        !restDone ||
        (problem.reason !== 'no-id' &&
          !(problem.reason === 'unstructured' && covered.has(problem.questionId ?? ''))),
    )
    const { restText: _sent, ...rest } = preview
    return {
      ...(restDone ? rest : preview),
      ...(templateProblems ? { templateProblems } : {}),
      complete: true,
      sections,
      conflicts: sections
        .filter((section) => importedVersion(stored.get(section.id)) !== undefined)
        .map((section) => section.id),
      keptGenerated: sections
        .filter((section) => generatedSource(stored.get(section.id))?.status === 'ready')
        .map((section) => section.id),
      rejected,
      unknownIds: [
        ...new Set([...preview.unknownIds, ...merged.unknownIds.filter((id) => !known.has(id))]),
      ],
      uncovered: state.questions
        .filter((question) => !covered.has(question.id))
        .map((question) => question.id),
      droppedIssues,
    }
  }

  /**
   * Save a complete preview. The imported version is shown from now on; a
   * generated walkthrough of the same section is kept whole as the other
   * source (switchable, never lost). When an earlier import is replaced the
   * caller must pass `confirmReplace` (the UI asks first); that import is kept
   * as `previous` (恢复上一版). Questions whose inputs changed since the
   * preview was made keep the current hash, so they show as up to date.
   */
  async commit(
    preview: WalkthroughImportPreview,
    options: { confirmReplace?: boolean } = {},
  ): Promise<{ saved: number; replaced: number }> {
    if (!preview.complete)
      throw new AppError(t('walkthroughImport.errors.incomplete'), 'VALIDATION_ERROR')
    if (preview.sections.length === 0)
      throw new AppError(t('walkthroughImport.errors.nothing'), 'VALIDATION_ERROR')
    if (walkthroughRunProgress(preview.setId))
      throw new AppError(t('homework.walkthrough.busy'), 'VALIDATION_ERROR')
    const state = await this.walkthroughs.state(preview.setId)
    const plan = new Map(state.plan.map((entry) => [entry.id, entry]))
    const frameHash = plan.get('overview')!.inputHash
    let replaced = 0
    const result = await this.repo.putSections(
      {
        id: walkthroughId(preview.setId, state.language),
        projectId: state.set.projectId,
        setId: preview.setId,
        language: state.language,
      },
      (existing) => {
        const byId = new Map(existing.map((section) => [section.id, section]))
        const replacing = preview.sections.filter(
          (section) => importedVersion(byId.get(section.id)) !== undefined,
        )
        if (replacing.length > 0 && !options.confirmReplace)
          throw new AppError(t('walkthroughImport.errors.confirm'), 'IMPORT_NEEDS_CONFIRMATION')
        replaced = replacing.length
        return preview.sections
          .filter((section) => section.kind !== 'question' || plan.has(section.id))
          .map((section) => {
            const current = byId.get(section.id)
            const inputHash =
              section.kind === 'question' ? plan.get(section.id)!.inputHash : frameHash
            const earlier = importedVersion(current)
            return mergeSectionWrite(current, {
              ...section,
              inputHash,
              ...(earlier ? { previous: versionOf(earlier) } : {}),
            })
          })
      },
    )
    if (!result) throw new NotFoundError('HomeworkSet', preview.setId)
    notifyWalkthroughChanged()
    return { saved: preview.sections.length, replaced }
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'NO_PROVIDER')
    return this.ai
  }
}

/**
 * The replies of all parts as one: a question continued across parts is
 * joined in order; the opening comes from the first part that has one, the
 * summary from the last.
 */
export function mergeImportParts(parts: readonly NormalizedImport[]): NormalizedImport {
  const questions = new Map<string, NormalizedImport['questions'][number]>()
  let overview = ''
  let summary = ''
  let suggestions: string[] = []
  const other: string[] = []
  const unknownIds = new Set<string>()
  for (const part of parts) {
    for (const question of part.questions) {
      const earlier = questions.get(question.questionId)
      if (!earlier) {
        questions.set(question.questionId, {
          ...question,
          issues: [...question.issues],
          linearSystems: [...question.linearSystems],
        })
        continue
      }
      earlier.body = `${earlier.body}\n\n${question.body}`
      if (!earlier.conclusion) earlier.conclusion = question.conclusion
      else if (question.conclusion && question.conclusion !== earlier.conclusion)
        earlier.conclusion = `${earlier.conclusion}\n\n${question.conclusion}`
      if (!earlier.analysis && question.analysis) earlier.analysis = question.analysis
      earlier.issues.push(...question.issues)
      earlier.linearSystems.push(...question.linearSystems)
    }
    if (!overview && part.overview) overview = part.overview
    if (part.summary) summary = part.summary
    if (part.suggestions.length > 0) suggestions = part.suggestions
    if (part.other) other.push(part.other)
    for (const id of part.unknownIds) unknownIds.add(id)
  }
  return {
    questions: [...questions.values()],
    overview,
    summary,
    suggestions,
    other: other.join('\n\n'),
    unknownIds: [...unknownIds],
  }
}

/**
 * One import request, sent at the resolved output cap (AIService). Cut off
 * there it throws `OutputTruncatedError.atCap` at once — the same request
 * would be cut off again — and the caller reads the piece in halves. Brief
 * outages are retried twice.
 */
async function requestImportJSON(
  ai: AIService,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<unknown> {
  let retries = 0
  for (;;) {
    if (signal.aborted) throw new AbortedError()
    try {
      const { data } = await ai.streamJSON<unknown>(messages, undefined, {
        signal,
        // Formatting an existing explanation: little thinking needed.
        reasoning: 'low',
      })
      return data
    } catch (err) {
      if (signal.aborted) throw new AbortedError()
      const kind = classifyHomeworkError(err)
      // Cut off at the cap: more room is impossible. Whose limit: the
      // model's, the setting's, or unknown (自动探测).
      if (kind === 'truncated') throw asTruncatedAtCap(ai, err)
      if (isRetryableHomeworkError(kind) && retries < MAX_TRANSIENT_RETRIES) {
        retries += 1
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** retries))
      } else {
        throw err
      }
    }
  }
}

/**
 * Halve a piece that is too long for one reply: between chunks when it has
 * several, else at the paragraph break nearest its middle that is outside any
 * display formula or environment (never mid-formula). Null when it is too
 * short to split or has no safe break.
 */
export function splitImportPieces(texts: readonly string[]): [string[], string[]] | null {
  if (texts.length > 1) {
    const total = texts.reduce((sum, text) => sum + text.length, 0)
    let best = 1
    let bestGap = Infinity
    let running = 0
    for (let index = 1; index < texts.length; index++) {
      running += texts[index - 1]!.length
      const gap = Math.abs(total / 2 - running)
      if (gap < bestGap) {
        bestGap = gap
        best = index
      }
    }
    return [texts.slice(0, best), texts.slice(best)]
  }
  const text = texts[0] ?? ''
  if (text.length < IMPORT_MIN_PIECE_CHARS) return null
  const middle = text.length / 2
  const margin = IMPORT_MIN_PIECE_CHARS / 4
  // Paragraph breaks first, single line breaks only when there is none.
  for (const pattern of [/\n\s*\n/g, /\n/g]) {
    let best = -1
    for (const match of text.matchAll(pattern)) {
      const at = match.index
      if (at < margin || text.length - at < margin) continue
      if (insideFormula(text.slice(0, at))) continue
      if (best < 0 || Math.abs(at - middle) < Math.abs(best - middle)) best = at
    }
    if (best < 0) continue
    const head = text.slice(0, best).trimEnd()
    const tail = text.slice(best).trimStart()
    if (head && tail) return [[head], [tail]]
  }
  return null
}

/** Whether the text before a break leaves a display formula or an environment open. */
function insideFormula(before: string): boolean {
  if ((before.match(/\$\$/g)?.length ?? 0) % 2 === 1) return true
  if ((before.match(/\\\[/g)?.length ?? 0) > (before.match(/\\\]/g)?.length ?? 0)) return true
  return (before.match(/\\begin\{/g)?.length ?? 0) > (before.match(/\\end\{/g)?.length ?? 0)
}

/** The ready imported version a stored section holds (shown or kept), if any. */
function importedVersion(stored: WalkthroughSection | undefined): WalkthroughSection | undefined {
  if (!stored) return undefined
  const section = normalizeSectionSources(stored)
  if (section.status === 'ready' && sourceOf(section) === 'imported') return section
  const other = section.alternate
  return other?.status === 'ready' && sourceOf(other) === 'imported' ? { ...other } : undefined
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** The import service with the configured AI (or none: preparing then fails clearly). */
export async function buildWalkthroughImportService(): Promise<WalkthroughImportService> {
  const settings = await new SettingsService().get()
  const ai = settings.apiKey.trim()
    ? new AIService({ config: settings, usageKind: 'walkthrough' })
    : null
  return new WalkthroughImportService({ ai, db: getDb() })
}
