import { AIService } from './aiService'
import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import type { NormalizedImport } from '@/infrastructure/ai/prompts/walkthrough-import/v1'
import { AbortedError } from '@/infrastructure/ai/errors'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { Document } from '@/entities/document/types'
import { planAnalysisSegments } from '@/entities/courseContent/analysisInput'
import { classifyHomeworkError, isRetryableHomeworkError } from '@/entities/homework/errorKind'
import { planOutputBudget } from '@/entities/homework/tokenBudget'
import { formatHomeworkReviewText } from '@/entities/homework/reviewFormatting'
import { checkLinearSystems, involvesRowReduction } from '@/entities/homework/walkthroughChecks'
import {
  buildSourceIndex,
  checkDerivedFromSource,
  issueQuoteFound,
  type DerivationCheck,
} from '@/entities/homework/walkthroughImport'
import {
  IMPORTED_OTHER_SECTION_ID,
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
import { t } from '@/i18n'

/**
 * Characters of the imported file sent in one request. The reply is about as
 * long as the input (it is the same text re-typeset), so a part must leave
 * room for the whole answer.
 */
export const IMPORT_SEGMENT_CHARS = 12_000
const IMPORT_OUTPUT_CEILING = 16_384
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
  /** Replies of the parts read so far, in order. */
  parts: NormalizedImport[]
  /** Sections to save (empty until complete). */
  sections: WalkthroughSection[]
  /** Sections that already have a ready version (replaced; kept as 上一版). */
  conflicts: string[]
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

    const segments = planAnalysisSegments(
      [{ id: document.id, name: document.name, chunks }],
      (chunk) => chunk.text,
      IMPORT_SEGMENT_CHARS,
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
      options.resume &&
      options.resume.documentId === document.id &&
      options.resume.checkIssues === options.checkIssues &&
      options.resume.partsTotal === segments.length
        ? options.resume
        : undefined
    const parts: NormalizedImport[] = [...(resume?.parts ?? [])]
    const base: WalkthroughImportPreview = {
      setId: options.setId,
      documentId: document.id,
      documentName: document.name,
      language: state.language,
      checkIssues: options.checkIssues,
      complete: false,
      partsTotal: segments.length,
      parts,
      sections: [],
      conflicts: [],
      rejected: [],
      unknownIds: [],
      uncovered: [],
      droppedIssues: 0,
    }
    options.onProgress?.({ done: parts.length, total: segments.length })
    for (let index = parts.length; index < segments.length; index++) {
      // A pause stops between parts; the parts read so far are kept.
      if (!control.shouldContinue()) return { ...base, parts: [...parts] }
      const segment = segments[index]!
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        {
          role: 'user',
          content: prompts.walkthroughImport.buildUserPrompt({
            language: state.language,
            questions,
            sourceText: segment.documents
              .flatMap((doc) => doc.chunks.map((chunk) => chunk.text))
              .join('\n\n'),
            ...(segments.length > 1 ? { part: { index, total: segments.length } } : {}),
          }),
        },
      ]
      let raw: unknown
      try {
        raw = await requestImportJSON(ai, messages, control.signal)
      } catch (err) {
        if (control.signal.aborted) return { ...base, parts: [...parts] }
        throw err
      }
      const normalized = prompts.walkthroughImport.normalizeImport(raw, allowed, {
        checkIssues: options.checkIssues,
      })
      if (!normalized) throw new AppError(t('walkthroughImport.errors.invalid'), 'INVALID_RESPONSE')
      parts.push(normalized)
      options.onProgress?.({ done: parts.length, total: segments.length })
    }
    return this.buildPreview({ ...base, parts }, state, sourceText, linearSystems)
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
        .filter((section) => stored.get(section.id)?.status === 'ready')
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
   * Save a complete preview. When it replaces ready sections the caller must
   * pass `confirmReplace` (the UI asks first); each replaced ready version is
   * kept as `previous` (恢复上一版). Questions whose inputs changed since the
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
          (section) => byId.get(section.id)?.status === 'ready',
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
            return {
              ...section,
              inputHash,
              ...(current?.status === 'ready' ? { previous: versionOf(current) } : {}),
            }
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

/** One import request: generous room (the reply is the whole text), brief outages retried. */
async function requestImportJSON(
  ai: AIService,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<unknown> {
  const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0)
  const maxTokens = planOutputBudget({
    inputChars,
    userMaxTokens: ai.maxOutputTokens,
    ceiling: IMPORT_OUTPUT_CEILING,
    overhead: 4_000,
    min: 4_096,
  })
  for (let retries = 0; ; retries++) {
    if (signal.aborted) throw new AbortedError()
    try {
      const { data } = await ai.streamJSON<unknown>(messages, undefined, { maxTokens, signal })
      return data
    } catch (err) {
      if (signal.aborted) throw new AbortedError()
      const kind = classifyHomeworkError(err)
      if (!isRetryableHomeworkError(kind) || retries >= MAX_TRANSIENT_RETRIES) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (retries + 1)))
    }
  }
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
