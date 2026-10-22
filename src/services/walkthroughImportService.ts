import { AIService } from './aiService'
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
import { MIN_OUTPUT_TOKENS } from '@/entities/homework/tokenBudget'
import { formatHomeworkReviewText } from '@/entities/homework/reviewFormatting'
import { checkLinearSystems, involvesRowReduction } from '@/entities/homework/walkthroughChecks'
import {
  buildSourceIndex,
  checkDerivedFromSource,
  issueQuoteFound,
  type DerivationCheck,
} from '@/entities/homework/walkthroughImport'
import {
  generatedSource,
  IMPORTED_OTHER_SECTION_ID,
  mergeSectionWrite,
  normalizeSectionSources,
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
/** First budget of a piece is never below this (unless the cap is lower). */
const IMPORT_MIN_BUDGET = 2_048
/** Hard cap on paid requests for one piece (budget changes + transient retries). */
const IMPORT_MAX_ATTEMPTS = 6

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

/** First output budget of a piece of `chars` characters, never above the cap. */
export function importOutputBudget(chars: number, outputCap: number): number {
  const cap = Number.isFinite(outputCap) && outputCap > 0 ? outputCap : Infinity
  const estimate = Math.ceil(chars * IMPORT_OUTPUT_TOKENS_PER_CHAR) + IMPORT_OUTPUT_OVERHEAD
  return Math.min(cap, Math.max(IMPORT_MIN_BUDGET, estimate))
}
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
}

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
  async prepare(options: WalkthroughImportOptions): Promise<WalkthroughImportPreview> {
    const ai = this.requireAI()
    const control = options.control ?? createGenerationRun()
    const state = await this.walkthroughs.state(options.setId)
    if (state.questions.length === 0)
      throw new AppError(t('homework.walkthrough.noQuestions'), 'VALIDATION_ERROR')
    const document = await this.documents.get(options.documentId)
    if (document.projectId !== state.set.projectId)
      throw new NotFoundError('Document', options.documentId)
    if (document.status !== 'ready')
      throw new AppError(t('walkthroughImport.errors.notReady'), 'VALIDATION_ERROR')
    const chunks = await this.chunks.listByDocument(document.id)
    const sourceText = chunks.map((chunk) => chunk.text).join('\n\n')
    if (!sourceText.trim())
      throw new AppError(t('walkthroughImport.errors.noText'), 'VALIDATION_ERROR')

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
    const subject = await loadProjectSubjectContext(state.set.projectId, this.db)
    const linearSystems =
      subject?.subject === 'linear_algebra' ||
      state.questions.some((question) => involvesRowReduction(question.prompt)) ||
      involvesRowReduction(sourceText.slice(0, 20_000))
    const questions = state.questions.map((question, index) => ({
      id: question.id,
      label: questionLabel(question, index),
      prompt: clip(question.prompt.replace(/\s+/g, ' '), QUESTION_PROMPT_CHARS),
    }))
    const allowed = new Set(questions.map((question) => question.id))
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
              questions,
              sourceText,
              ...(part ? { part } : {}),
              ...(fragment ? { fragment: true } : {}),
            }),
          },
        ]
        let raw: unknown
        try {
          raw = await requestImportJSON(ai, messages, sourceText.length, control.signal)
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
    return this.buildPreview(finished, state, sourceText, linearSystems)
  }

  /** Turn the merged replies into sections, keeping only what the file supports. */
  private buildPreview(
    preview: WalkthroughImportPreview,
    state: Awaited<ReturnType<HomeworkWalkthroughService['state']>>,
    sourceText: string,
    linearSystems: boolean,
  ): WalkthroughImportPreview {
    const merged = mergeImportParts(preview.parts)
    const index = buildSourceIndex(sourceText)
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
    const sections: WalkthroughSection[] = []
    const rejected: RejectedImportSection[] = []
    let droppedIssues = 0

    for (const question of merged.questions) {
      const sectionId = questionSectionId(question.questionId)
      const entry = plan.get(sectionId)
      if (!entry) continue
      const check = checkDerivedFromSource(question.body, index)
      if (!check.ok) {
        rejected.push({ sectionId, questionId: question.questionId, reason: check.reason! })
        continue
      }
      const issues: WalkthroughImportIssue[] = []
      for (const issue of question.issues) {
        if (issueQuoteFound(issue.quote, question.body, index)) issues.push(issue)
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
      if (!body.trim() && suggestions.length === 0) return
      const check = checkDerivedFromSource([body, ...suggestions].join('\n'), index)
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
    return {
      ...preview,
      complete: true,
      sections,
      conflicts: sections
        .filter((section) => importedVersion(stored.get(section.id)) !== undefined)
        .map((section) => section.id),
      keptGenerated: sections
        .filter((section) => generatedSource(stored.get(section.id))?.status === 'ready')
        .map((section) => section.id),
      rejected,
      unknownIds: merged.unknownIds,
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
 * One import request. The first budget follows the piece's size; a reply cut
 * off doubles it up to the resolved output cap (`ai.maxOutputTokens`); cut off
 * at the cap it throws `OutputTruncatedError.atCap` (the caller then reads the
 * piece in halves). A provider that rejects the size gets half; brief outages
 * are retried twice.
 */
async function requestImportJSON(
  ai: AIService,
  messages: ChatMessage[],
  sourceChars: number,
  signal: AbortSignal,
): Promise<unknown> {
  const cap =
    Number.isFinite(ai.maxOutputTokens) && ai.maxOutputTokens > 0 ? ai.maxOutputTokens : Infinity
  let budget = importOutputBudget(sourceChars, ai.maxOutputTokens)
  let rejectedBudget = Infinity
  let retries = 0
  const tried = new Set<number>()
  for (let attempts = 1; ; attempts++) {
    tried.add(budget)
    if (signal.aborted) throw new AbortedError()
    try {
      const { data } = await ai.streamJSON<unknown>(messages, undefined, {
        maxTokens: budget,
        signal,
      })
      return data
    } catch (err) {
      if (signal.aborted) throw new AbortedError()
      const kind = classifyHomeworkError(err)
      if (kind === 'truncated') {
        const next = Math.min(cap, budget * 2, rejectedBudget - 1)
        if (next <= budget || tried.has(next) || attempts >= IMPORT_MAX_ATTEMPTS) {
          // Cut off at the largest budget allowed: more room is impossible.
          const modelMax = ai.modelMaxOutputTokens
          throw new OutputTruncatedError(budget, {
            limit: budget,
            by: modelMax !== undefined && budget >= modelMax ? 'model' : 'setting',
          })
        }
        budget = next
      } else if (attempts >= IMPORT_MAX_ATTEMPTS) {
        throw err
      } else if (kind === 'output-limit') {
        rejectedBudget = Math.min(rejectedBudget, budget)
        const next = Math.max(Math.min(MIN_OUTPUT_TOKENS, cap), Math.floor(budget / 2))
        if (next >= budget || tried.has(next)) throw err
        budget = next
      } else if (isRetryableHomeworkError(kind) && retries < MAX_TRANSIENT_RETRIES) {
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
