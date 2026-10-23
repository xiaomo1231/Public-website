import { aiConcurrency, type AIService } from './aiService'
import { createAdaptivePool, isOverloadError, type PoolTaskContext } from '@/shared/lib/concurrency'
import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { HomeworkRepository } from '@/entities/homework/repository'
import { AnswerImageRepository } from '@/entities/homework/answerImageRepository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { StudyPlanRepository } from '@/entities/studyPlan/repository'
import type { PlannedExam } from '@/entities/studyPlan/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import type { KnowledgeMastery } from '@/entities/knowledgeMastery/types'
import {
  isAiMockSet,
  isPastPaperSet,
  type HomeworkQuestion,
  type HomeworkSet,
} from '@/entities/homework/types'
import { isHeldOut } from '@/entities/evaluation/evalRole'
import { DEFAULT_EXAM_MINUTES, type MockExamAttempt } from '@/entities/exam/types'
import { analyzePastExams } from '@/entities/exam/analysis'
import { findFormulaSheet } from '@/entities/exam/paper'
import { scoreMockExam } from '@/entities/exam/scoring'
import {
  allocateTopics,
  defaultDifficulty,
  mirrorStructure,
  MOCK_REVIEW_BATCH,
  resizeStructure,
  type AiMockConfig,
  type AiMockInfo,
  type DefaultReason,
  type MockFigureEngine,
  type MockFigureSpec,
  type MockLanguage,
  type MockSlotState,
  type MockTopicInput,
  type PaperStructure,
  type PreviousMock,
  MAX_MOCK_QUESTIONS,
  MIN_MOCK_QUESTIONS,
} from '@/entities/exam/mockPaper'
import { verifyMockQuestion, type MockRejectCode } from '@/entities/exam/mockPaperVerify'
import type { ProfessorConvention } from '@/entities/questionHabits/types'
import type { SubjectContext } from '@/entities/project/types'
import { classifyHomeworkError, isAccountFatalError } from '@/entities/homework/errorKind'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { t } from '@/i18n'
import type { TranslationKey } from '@/i18n/types'
import { MasteryService } from './masteryService'
import { SyllabusService } from './syllabusService'
import { loadCourseLanguage } from './courseLanguage'
import { loadProjectSubjectContext } from './projectSubject'
import { readMarketFigureSpec } from './econMockFigureEngine'
import { loadProfessorConventions } from './projectGradingRules'
import { logger } from '@/infrastructure/logger/logger'
import type { MockFigureGroupInput } from '@/infrastructure/ai/prompts/mock-paper/v2'
import { loadProfessorHabits } from './questionHabitsService'

/**
 * AI 模拟卷: a mock paper the platform writes in the style of the professor's
 * past paper, stored as an ordinary exam set (`HomeworkSet.kind === 'exam'`,
 * `exam.origin === 'ai_mock'`, sharing the past paper's document — so the
 * paper's formula sheet is shown again and deleting the paper deletes it) and
 * taken in the existing 模拟考试 (timer, no hints, 交卷 then check). Every
 * answer, marking scheme and mark estimate on it is 平台拟定.
 *
 * Generation (the student starts it after a pre-flight and an estimate):
 *   1. one request per question (`mock-paper/v2`) through the shared adaptive
 *      pool (同时进行的 AI 请求数), each with the whole output cap;
 *   2. local checks (`verifyMockQuestion`: structure, marks, recomputed
 *      answers, options, scheme);
 *   3. a batched AI review (≤ 8 questions per request, verdicts only);
 *   4. a question that fails (2 or 3) is written once more with the reason;
 *      failing again, it is dropped and the paper reports the missing slot.
 * Each reviewed question is saved at once; the per-slot state lives on the
 * set (`exam.aiMock.slots`), so 暂停 / 立即停止 / a reload keep everything
 * done and 继续 does the rest. A failed request marks only its slot (重试);
 * an account error (quota, key) stops scheduling.
 *
 * Held-out (独立检验) papers and questions are never a template or an
 * example, and the past papers it mirrors exclude AI mock papers.
 */

export const MOCK_PAPER_PROMPT_VERSION = `mock-paper/${prompts.mockPaper.VERSION}`
const TEMPLATE_CHARS = 1_500
const REVIEW_PAPER_CHARS = 500
const REVIEW_PAPER_TOTAL = 5_000
const MAX_WRITES = 2

export interface MockTemplateOption {
  setId: string
  title: string
  questions: number
  minutes?: number
  totalMarks?: number
  hasFormulaSheet: boolean
  createdAt: number
}

export interface PreviousMockView extends PreviousMock {
  setId: string
  title: string
}

export interface AiMockDefaults {
  projectId: string
  exam?: Pick<PlannedExam, 'id' | 'name' | 'at'>
  templates: MockTemplateOption[]
  /** The default template's structure (null without a usable past paper). */
  structure: PaperStructure | null
  /** Defaults chosen locally (null without a past paper). */
  config: AiMockConfig | null
  reasons: DefaultReason[]
  /** Topics of the scope with their weights' inputs. */
  topics: MockTopicInput[]
  /** Every course topic (for 重点主题). */
  allTopics: Array<{ id: string; name: string }>
  scopes: Array<{ documentId: string; scopeId: string; label: string }>
  conventions: ProfessorConvention[]
  language: MockLanguage
  previous: PreviousMockView[]
}

export interface AiMockProgress {
  stage: 'writing' | 'reviewing'
  slots: MockSlotState[]
}

export interface AiMockRunOptions {
  control?: GenerationControl
  onProgress?: (progress: AiMockProgress) => void
}

export interface AiMockRunResult {
  set: HomeworkSet
  paused: boolean
}

interface RunContext {
  set: HomeworkSet
  subject: SubjectContext | undefined
  topics: Map<string, { name: string; description?: string; concepts: string[] }>
  templates: Map<string, string>
  pastPaper: string
  professorHabits?: string
  conventions: ProfessorConvention[]
  noneOptionLabel?: string
  sigFigs: boolean
}

/** One build per paper at a time (this tab). */
const runs = new Map<string, Promise<AiMockRunResult>>()

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The figure-group part of a slot's prompt (mock-paper/v2): only when the
 * group's shared figure was drawn; otherwise nothing, and the question is
 * written as an ordinary one (the prompt is v1's).
 */
function figureGroupInput(
  info: Pick<AiMockInfo, 'slots' | 'figures'>,
  slot: MockSlotState,
): { figureGroup?: MockFigureGroupInput } {
  const group = slot.figureGroup
  const figure = group ? info.figures?.[group.id] : undefined
  if (!group || !figure) return {}
  const members = info.slots.filter((item) => item.figureGroup?.id === group.id)
  const siblings = members
    .filter((item) => item.id !== slot.id && item.candidate)
    .map((item) => clip(item.candidate!.prompt, 400))
  return {
    figureGroup: {
      position: group.position,
      size: group.size,
      labels: members.map((item) => item.label),
      figure: figure.description,
      ...(siblings.length ? { siblings } : {}),
    },
  }
}

function reasonText(code: MockRejectCode): string {
  return t(`aiMock.reason.${code}` as TranslationKey)
}

/** The planned exam's course topics (its scope), or every topic. */
function examTopicIds(
  exam: PlannedExam | undefined,
  syllabi: Awaited<ReturnType<SyllabusService['listSyllabi']>>,
  scope: AiMockConfig['scope'],
): string[] | null {
  const fromScope = (documentId: string, scopeId: string) =>
    syllabi
      .find((row) => row.document.id === documentId)
      ?.data.scopes.find((item) => item.id === scopeId)
      ?.topics.flatMap((item) => item.topicIds ?? []) ?? []
  if (scope) return fromScope(scope.documentId, scope.scopeId)
  if (!exam) return null
  if (exam.scope.kind === 'topics') return exam.scope.topicIds
  if (exam.scope.kind === 'syllabus') return fromScope(exam.scope.documentId, exam.scope.scopeId)
  return null
}

function masteryOf(rows: KnowledgeMastery[], topic: Topic): number | null {
  const name = topic.name.toLowerCase()
  const matched = rows.filter(
    (row) =>
      row.attempts > 0 && (row.topicId === topic.id || row.knowledgePoint.toLowerCase() === name),
  )
  const attempts = matched.reduce((sum, row) => sum + row.attempts, 0)
  return attempts > 0
    ? matched.reduce((sum, row) => sum + row.mastery * row.attempts, 0) / attempts
    : null
}

/** The latest checked attempt of a paper: its platform-estimated share right. */
export function lastCheckedFraction(
  set: Pick<HomeworkSet, 'exam'>,
): { fraction: number | null; at: number } | null {
  const attempt = [set.exam?.current, ...(set.exam?.attempts ?? [])]
    .filter((a): a is MockExamAttempt => !!a?.checkedAt && !!a.results?.length)
    .sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0))[0]
  return attempt
    ? { fraction: scoreMockExam(attempt.results!).fraction, at: attempt.checkedAt! }
    : null
}

/** The shared market figure printed with a slot of a figure group, when one was drawn. */
function marketFigureOf(
  info: Pick<AiMockInfo, 'figures'>,
  slot: MockSlotState,
): Pick<HomeworkQuestion, 'marketFigure'> {
  const groupId = slot.figureGroup?.id
  const figure = groupId ? readMarketFigureSpec(info.figures?.[groupId])?.figure : undefined
  return figure && groupId ? { marketFigure: { figure, groupId } } : {}
}

export class AiMockPaperService {
  private ai: AIService | null
  private db: AppDatabase
  private homework: HomeworkRepository
  private figureEngine: MockFigureEngine | undefined

  constructor(deps: {
    ai: AIService | null
    db?: AppDatabase
    /**
     * Draws the shared figure of a figure group (several questions on one
     * graph). Optional: without it grouped questions are written normally.
     */
    figureEngine?: MockFigureEngine
  }) {
    this.ai = deps.ai
    this.db = deps.db ?? getDb()
    this.homework = new HomeworkRepository(this.db)
    this.figureEngine = deps.figureEngine
  }

  hasAI(): boolean {
    return this.ai !== null
  }

  isRunning(setId: string): boolean {
    return runs.has(setId)
  }

  /** One AI mock paper (undefined when gone or not one). */
  async getPaper(setId: string): Promise<HomeworkSet | undefined> {
    const set = await this.homework.getSet(setId)
    return set && isAiMockSet(set) ? set : undefined
  }

  /** The course's AI mock papers, newest first. */
  async listPapers(projectId: string): Promise<HomeworkSet[]> {
    return (await this.homework.listSets(projectId))
      .filter(isAiMockSet)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Past papers that can be mirrored: ready, uploaded, not held out, with questions. */
  async templates(projectId: string): Promise<MockTemplateOption[]> {
    const sets = (await this.homework.listSets(projectId)).filter(
      (set) => isPastPaperSet(set) && set.status === 'ready' && !isHeldOut(set),
    )
    const documents = this.db.documents
    const out: MockTemplateOption[] = []
    for (const set of sets) {
      const document = await documents.get(set.documentId)
      if (isHeldOut(document)) continue
      const structure = await this.structureOf(set)
      if (!structure || structure.slots.length === 0) continue
      out.push({
        setId: set.id,
        title: set.title,
        questions: structure.slots.length,
        ...(structure.minutes !== undefined ? { minutes: structure.minutes } : {}),
        ...(structure.totalMarks !== undefined ? { totalMarks: structure.totalMarks } : {}),
        hasFormulaSheet: structure.hasFormulaSheet,
        createdAt: set.createdAt,
      })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** The past paper's structure (held-out questions left out). */
  async structureOf(set: HomeworkSet): Promise<PaperStructure | null> {
    if (!isPastPaperSet(set)) return null
    const questions = (await this.homework.listQuestions(set.id))
      .filter((question) => !question.retired)
      .sort((a, b) => a.order - b.order)
    const chunks = await new ChunkRepository(this.db).listByDocument(set.documentId)
    const sheet = findFormulaSheet(
      chunks.map((chunk) => ({
        id: chunk.id,
        text: chunk.text,
        order: chunk.order,
        ...(chunk.pageNumber !== undefined ? { pageNumber: chunk.pageNumber } : {}),
      })),
    )
    const minutes = set.exam?.durationMinutes ?? set.exam?.detectedMinutes
    // The professor's habit "several questions share one figure" loosens
    // the detection of figure groups on the paper.
    const { figureGroups } = await loadProfessorConventions(set.projectId, this.db)
    return mirrorStructure({
      setId: set.id,
      title: set.title,
      ...(minutes !== undefined ? { minutes } : {}),
      hasFormulaSheet: sheet !== null,
      ...(figureGroups ? { figureGroups: true } : {}),
      questions: questions.map((question) => ({
        id: question.id,
        ...(question.number ? { number: question.number } : {}),
        prompt: question.prompt,
        heldOut: isHeldOut(question, set),
      })),
    })
  }

  /**
   * Everything the 生成模拟卷 dialog shows before anything is sent: the past
   * papers, the structure, the defaults (chosen locally from the plan) and
   * why, the topics with their weights' inputs, and earlier AI mock papers.
   */
  async defaults(
    projectId: string,
    options: { examId?: string; templateSetId?: string; now?: number } = {},
  ): Promise<AiMockDefaults> {
    const now = options.now ?? Date.now()
    const exam = options.examId
      ? await new StudyPlanRepository(this.db).getExam(options.examId)
      : undefined
    const templates = await this.templates(projectId)
    const preferred = exam?.materials.pastExamSetIds ?? []
    const chosen =
      templates.find((item) => item.setId === options.templateSetId) ??
      templates.find((item) => preferred.includes(item.setId)) ??
      templates[0]
    const set = chosen ? await this.homework.getSet(chosen.setId) : undefined
    const structure = set ? await this.structureOf(set) : null
    const topics = await this.scopeTopics(projectId, exam, undefined)
    const courseTopics = await new CourseAnalysisRepository(this.db).listTopics(projectId)
    const syllabi = await new SyllabusService({ db: this.db }).listSyllabi(projectId)
    const previous = await this.previous(projectId, exam?.id)
    const { conventions } = await loadProfessorConventions(projectId, this.db)
    const language = set ? await this.language(projectId, set) : 'zh_terms'

    const reasons: DefaultReason[] = []
    let config: AiMockConfig | null = null
    if (structure && chosen) {
      const level = defaultDifficulty({
        now,
        ...(exam ? { examAt: exam.at, planStartedAt: exam.createdAt } : {}),
        previous,
      })
      const minutes = structure.minutes ?? DEFAULT_EXAM_MINUTES
      reasons.push({
        code: 'structure_from_paper',
        paper: chosen.title,
        questions: structure.slots.length,
      })
      reasons.push(
        structure.minutes !== undefined
          ? { code: 'minutes_from_paper', minutes }
          : { code: 'minutes_default', minutes },
      )
      for (const reason of level.reasons) reasons.push({ code: 'difficulty', reason })
      reasons.push(
        exam && exam.scope.kind !== 'course'
          ? { code: 'topics_exam_scope', exam: exam.name, topics: topics.length }
          : { code: 'topics_course', topics: topics.length },
      )
      reasons.push({ code: 'topics_weighted' })
      if (structure.hasFormulaSheet) reasons.push({ code: 'formula_sheet' })
      config = {
        templateSetId: chosen.setId,
        ...(exam ? { examId: exam.id } : {}),
        difficulty: level.difficulty,
        focusTopicIds: [],
        questionCount: structure.slots.length,
        minutes,
      }
    }
    return {
      projectId,
      ...(exam ? { exam: { id: exam.id, name: exam.name, at: exam.at } } : {}),
      templates,
      structure,
      config,
      reasons,
      topics,
      allTopics: courseTopics.map((topic) => ({ id: topic.id, name: topic.name })),
      scopes: syllabi.flatMap(({ document, data }) =>
        data.scopes.map((scope) => ({
          documentId: document.id,
          scopeId: scope.id,
          label: scope.label,
        })),
      ),
      conventions,
      language,
      previous,
    }
  }

  /**
   * Before any request: an AI is configured, the course has topics (a
   * finished course analysis) and the provider answers.
   */
  async preflight(projectId: string): Promise<void> {
    const ai = this.requireAI()
    const analysis = await new CourseAnalysisRepository(this.db).getByProject(projectId)
    const topics = await new CourseAnalysisRepository(this.db).listTopics(projectId)
    if (analysis?.status !== 'ready' || topics.length === 0)
      throw new AppError(t('aiMock.errors.noAnalysis'), 'NO_ANALYSIS')
    let result: { ok: boolean; error?: string }
    try {
      result = await ai.testConnection()
    } catch (err) {
      throw new AppError(
        t('aiMock.errors.preflight', { reason: friendlyAIError(err) }),
        'PREFLIGHT_FAILED',
        err,
      )
    }
    if (!result.ok)
      throw new AppError(
        t('aiMock.errors.preflight', { reason: result.error ?? '' }),
        'PREFLIGHT_FAILED',
      )
  }

  /** Plan the paper and write it (the set is stored before the first request). */
  async create(
    projectId: string,
    config: AiMockConfig,
    options: AiMockRunOptions = {},
  ): Promise<AiMockRunResult> {
    const set = await this.plan(projectId, config)
    return this.start(set.id, options)
  }

  /**
   * Store the planned paper (every slot `pending`), without any request: the
   * UI then runs it with `resume`, under a run it can pause.
   */
  async plan(projectId: string, config: AiMockConfig): Promise<HomeworkSet> {
    this.requireAI()
    const template = await this.homework.getSet(config.templateSetId)
    if (!template || template.projectId !== projectId || !isPastPaperSet(template))
      throw new NotFoundError('HomeworkSet', config.templateSetId)
    const base = await this.structureOf(template)
    if (!base || base.slots.length === 0)
      throw new AppError(t('aiMock.errors.noTemplate'), 'VALIDATION_ERROR')
    const count = Math.max(
      MIN_MOCK_QUESTIONS,
      Math.min(MAX_MOCK_QUESTIONS, Math.round(config.questionCount)),
    )
    const structure = resizeStructure(base, count)
    const exam = config.examId
      ? await new StudyPlanRepository(this.db).getExam(config.examId)
      : undefined
    const topics = await this.scopeTopics(projectId, exam, config.scope)
    const allocation = allocateTopics(structure.slots, topics, config.focusTopicIds)
    if (allocation.size === 0) throw new AppError(t('aiMock.errors.noTopics'), 'VALIDATION_ERROR')
    const minutes = Math.min(600, Math.max(5, Math.round(config.minutes)))
    const slots: MockSlotState[] = structure.slots.map((slot) => {
      const topic = allocation.get(slot.id)!
      return {
        ...slot,
        topicIds: [topic.id],
        topicNames: [topic.name],
        difficulty: config.difficulty,
        status: 'pending',
        attempts: 0,
      }
    })
    const defaults = await this.defaults(projectId, {
      ...(config.examId ? { examId: config.examId } : {}),
      templateSetId: template.id,
    })
    const language = await this.language(projectId, template)
    const subject = await loadProjectSubjectContext(projectId, this.db)
    const figures = await this.drawFigures(slots, language, subject?.subject)
    const info: AiMockInfo = {
      config: { ...config, questionCount: count, minutes },
      reasons: defaults.reasons,
      language,
      slots,
      hasFormulaSheet: structure.hasFormulaSheet,
      ...(structure.totalMarks !== undefined ? { totalMarks: structure.totalMarks } : {}),
      ...(figures ? { figures } : {}),
    }
    const existing = (await this.listPapers(projectId)).length
    const now = Date.now()
    const set: HomeworkSet = {
      id: crypto.randomUUID(),
      projectId,
      documentId: template.documentId,
      documentName: template.documentName,
      title: t('aiMock.paperTitle', {
        name: exam?.name ?? template.title,
        n: existing + 1,
      }),
      // Not started yet: `paused` until a run picks it up (never a stranded `analyzing`).
      status: 'paused',
      language: template.language,
      questionCount: 0,
      promptVersion: MOCK_PAPER_PROMPT_VERSION,
      kind: 'exam',
      exam: { origin: 'ai_mock', durationMinutes: minutes, aiMock: info },
      progress: { stage: 'generating', completed: 0, total: slots.length, updatedAt: now },
      createdAt: now,
      updatedAt: now,
    }
    await this.homework.upsertSet(set)
    return set
  }

  /**
   * The shared figure of each figure group, from the figure engine. No
   * engine, or a figure it cannot draw (null / an error), leaves that group's
   * questions to be written as ordinary questions.
   */
  private async drawFigures(
    slots: readonly MockSlotState[],
    language: MockLanguage,
    subject?: string,
  ): Promise<Record<string, MockFigureSpec> | undefined> {
    const engine = this.figureEngine
    if (!engine) return undefined
    const groups = new Map<string, MockSlotState[]>()
    for (const slot of slots) {
      const id = slot.figureGroup?.id
      if (id) groups.set(id, [...(groups.get(id) ?? []), slot])
    }
    const figures: Record<string, MockFigureSpec> = {}
    for (const [groupId, members] of groups) {
      const first = members[0]!
      try {
        const figure = await engine({
          groupId,
          topic: { id: first.topicIds[0] ?? '', name: first.topicNames[0] ?? '' },
          slots: members.map((slot) => ({
            id: slot.id,
            label: slot.label,
            kind: slot.kind,
            parts: slot.parts,
            ...(slot.marks !== undefined ? { marks: slot.marks } : {}),
            ...(slot.optionCount ? { optionCount: slot.optionCount } : {}),
          })),
          language,
          ...(subject ? { subject } : {}),
        })
        if (figure?.description.trim()) figures[groupId] = figure
      } catch (err) {
        logger.warn('aiMock.figureEngine failed; writing the group normally', {
          groupId,
          error: (err as Error).message,
        })
      }
    }
    return Object.keys(figures).length ? figures : undefined
  }

  /** 继续: write what is left (failed requests are tried again). */
  async resume(setId: string, options: AiMockRunOptions = {}): Promise<AiMockRunResult> {
    const running = runs.get(setId)
    if (running) return running
    this.requireAI()
    await this.updateInfo(setId, (info) => ({
      ...info,
      slots: info.slots.map(reopenFailed),
    }))
    return this.start(setId, options)
  }

  /** 重试 one question whose request failed (or write a dropped one once more). */
  async retrySlot(
    setId: string,
    slotId: string,
    options: AiMockRunOptions = {},
  ): Promise<AiMockRunResult> {
    const running = runs.get(setId)
    if (running) return running
    this.requireAI()
    await this.updateInfo(setId, (info) => ({
      ...info,
      slots: info.slots.map((slot) => {
        if (slot.id !== slotId) return slot
        if (slot.status === 'dropped') {
          const { dropReason: _drop, ...rest } = slot
          void _drop
          return { ...rest, status: 'pending', attempts: MAX_WRITES - 1 }
        }
        return reopenFailed(slot)
      }),
    }))
    return this.start(setId, options)
  }

  /**
   * 完成（缺题）: keep the questions written so far; the slots still missing
   * are reported as missing. The paper becomes ready to take.
   */
  async finishWithMissing(setId: string): Promise<HomeworkSet> {
    if (runs.has(setId)) throw new AppError(t('aiMock.errors.running'), 'VALIDATION_ERROR')
    let saved: HomeworkSet | undefined
    await this.db.transaction('rw', this.db.homeworkSets, async () => {
      const set = await this.homework.getSet(setId)
      const info = set?.exam?.aiMock
      if (!set || !info) return
      const slots = info.slots.map((slot) =>
        slot.status === 'passed' || slot.status === 'dropped'
          ? slot
          : {
              ...slot,
              status: 'dropped' as const,
              dropReason: slot.error ?? slot.rejected ?? t('aiMock.reason.skipped'),
            },
      )
      const passed = slots.filter((slot) => slot.status === 'passed').length
      saved = {
        ...set,
        status: passed > 0 ? 'ready' : 'failed',
        questionCount: passed,
        progress: undefined,
        ...(passed > 0 ? {} : { errorMessage: t('aiMock.allDropped') }),
        exam: { ...set.exam, aiMock: { ...info, slots, generatedAt: Date.now() } },
        updatedAt: Date.now(),
      }
      await this.homework.upsertSet(saved)
    })
    if (!saved) throw new NotFoundError('HomeworkSet', setId)
    return saved
  }

  /** A build cut off by a reload stays `analyzing`: make it `paused` (继续 picks it up). */
  async recoverInterrupted(setId: string): Promise<HomeworkSet | undefined> {
    if (runs.has(setId)) return undefined
    const set = await this.homework.getSet(setId)
    if (!set || !isAiMockSet(set) || set.status !== 'analyzing') return set
    return this.homework.updateSet(setId, { status: 'paused' })
  }

  /** Delete one AI mock paper (its questions, answer images, walkthrough, notes). */
  async deletePaper(setId: string, projectId: string): Promise<void> {
    const set = await this.homework.getSet(setId)
    if (!set || set.projectId !== projectId || !isAiMockSet(set))
      throw new NotFoundError('HomeworkSet', setId)
    await this.db.transaction(
      'rw',
      [
        this.db.homeworkSets,
        this.db.homeworkQuestions,
        this.db.homeworkWalkthroughs,
        this.db.walkthroughNotes,
        this.db.homeworkAnswerImages,
      ],
      async () => {
        await new AnswerImageRepository(this.db).deleteBySet(setId)
        await new WalkthroughRepository(this.db).deleteBySet(setId)
        await this.db.homeworkQuestions.where('setId').equals(setId).delete()
        await this.db.homeworkSets.delete(setId)
      },
    )
  }

  // ---------------------------------------------------------------------------

  private start(setId: string, options: AiMockRunOptions): Promise<AiMockRunResult> {
    const running = runs.get(setId)
    if (running) return running
    const run = this.advance(setId, options).finally(() => runs.delete(setId))
    runs.set(setId, run)
    return run
  }

  private async advance(setId: string, options: AiMockRunOptions): Promise<AiMockRunResult> {
    const control = resolveControl(options.control)
    const loaded = await this.homework.getSet(setId)
    if (!loaded?.exam?.aiMock) throw new NotFoundError('HomeworkSet', setId)
    const context = await this.runContext(loaded)
    await this.homework.updateSet(setId, { status: 'analyzing', errorMessage: undefined })
    await this.updateInfo(setId, (info) => {
      const { error: _error, ...rest } = info
      void _error
      return rest
    })
    const report = async (stage: AiMockProgress['stage']) => {
      const info = (await this.homework.getSet(setId))?.exam?.aiMock
      if (info) options.onProgress?.({ stage, slots: info.slots })
    }
    let fatal: unknown = null
    const pool = createAdaptivePool({ max: aiConcurrency(this.ai), control })

    for (let round = 0; round < MAX_WRITES * 3; round++) {
      // Write every slot still owed (one request each).
      const pending = (await this.info(setId)).slots.filter((slot) => slot.status === 'pending')
      if (pending.length > 0) {
        await report('writing')
        const outcomes = await pool.run(pending, async (slot, ctx) =>
          this.guard(
            setId,
            [slot.id],
            ctx,
            control,
            (err) => (fatal = err),
            async () => {
              await this.writeSlot(setId, slot.id, context, ctx.control)
              await report('writing')
            },
          ),
        )
        await this.failOverloaded(
          setId,
          outcomes,
          pending.map((slot) => [slot.id]),
        )
      }
      if (fatal || !control.shouldContinue() || control.signal.aborted) break

      // Review what passed the local checks, a few questions per request.
      const written = (await this.info(setId)).slots.filter((slot) => slot.status === 'written')
      if (written.length > 0) {
        await report('reviewing')
        const batches: MockSlotState[][] = []
        for (let i = 0; i < written.length; i += MOCK_REVIEW_BATCH)
          batches.push(written.slice(i, i + MOCK_REVIEW_BATCH))
        const outcomes = await pool.run(batches, async (batch, ctx) =>
          this.guard(
            setId,
            batch.map((slot) => slot.id),
            ctx,
            control,
            (err) => (fatal = err),
            async () => {
              await this.review(
                setId,
                batch.map((slot) => slot.id),
                context,
                ctx.control,
              )
              await report('reviewing')
            },
          ),
        )
        await this.failOverloaded(
          setId,
          outcomes,
          batches.map((batch) => batch.map((slot) => slot.id)),
        )
      }
      if (fatal || !control.shouldContinue() || control.signal.aborted) break
      const left = (await this.info(setId)).slots.some(
        (slot) => slot.status === 'pending' || slot.status === 'written',
      )
      if (!left) break
    }
    return this.settle(setId, fatal, control)
  }

  /**
   * Run one task; an ordinary failure marks only its slots `failed`, an
   * account failure stops the run, a rate limit goes back to the pool and an
   * abort leaves the slots as they were.
   */
  private async guard(
    setId: string,
    slotIds: string[],
    ctx: PoolTaskContext,
    control: GenerationControl,
    onFatal: (err: unknown) => void,
    task: () => Promise<void>,
  ): Promise<void> {
    try {
      await task()
    } catch (err) {
      if (isAbortError(err, control.signal)) throw err
      if (isOverloadError(err)) throw err
      if (isAccountFatalError(classifyHomeworkError(err))) {
        onFatal(err)
        ctx.halt()
        throw err
      }
      await this.markFailed(setId, slotIds, friendlyAIError(err))
    }
  }

  /** Rate-limited tasks the pool gave up on: their slots are failed (重试 later). */
  private async failOverloaded(
    setId: string,
    outcomes: ReadonlyArray<{ status: string; reason?: unknown }>,
    ids: string[][],
  ): Promise<void> {
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status !== 'rejected' || !isOverloadError(outcome.reason)) continue
      await this.markFailed(setId, ids[index]!, friendlyAIError(outcome.reason))
    }
  }

  private async markFailed(setId: string, slotIds: string[], error: string): Promise<void> {
    await this.updateInfo(setId, (info) => ({
      ...info,
      slots: info.slots.map((slot) =>
        slotIds.includes(slot.id) && (slot.status === 'pending' || slot.status === 'written')
          ? { ...slot, status: 'failed', error }
          : slot,
      ),
    }))
  }

  /** End of a run: paused, waiting for 重试 / 完成, ready or failed. */
  private async settle(
    setId: string,
    fatal: unknown,
    control: GenerationControl,
  ): Promise<AiMockRunResult> {
    const info = await this.info(setId)
    const passed = info.slots.filter((slot) => slot.status === 'passed').length
    const open = info.slots.some(
      (slot) => slot.status === 'pending' || slot.status === 'written' || slot.status === 'failed',
    )
    const interrupted = !control.shouldContinue() || control.signal.aborted
    if (fatal || interrupted || open) {
      if (fatal)
        await this.updateInfo(setId, (current) => ({ ...current, error: friendlyAIError(fatal) }))
      const set = await this.homework.updateSet(setId, {
        status: 'paused',
        progress: progressOf(info.slots),
      })
      if (!set) throw new NotFoundError('HomeworkSet', setId)
      return { set, paused: true }
    }
    const set = await this.homework.updateSet(setId, {
      status: passed > 0 ? 'ready' : 'failed',
      questionCount: passed,
      progress: undefined,
      ...(passed > 0 ? {} : { errorMessage: t('aiMock.allDropped') }),
    })
    await this.updateInfo(setId, (current) => ({ ...current, generatedAt: Date.now() }))
    const final = await this.homework.getSet(setId)
    if (!set || !final) throw new NotFoundError('HomeworkSet', setId)
    return { set: final, paused: false }
  }

  private async writeSlot(
    setId: string,
    slotId: string,
    context: RunContext,
    control: GenerationControl,
  ): Promise<void> {
    const ai = this.requireAI()
    const info = await this.info(setId)
    const slot = info.slots.find((item) => item.id === slotId)
    if (!slot || slot.status !== 'pending') return
    // A figure group drawn by the market engine: the question was written
    // locally with it (answers and options from the engine). Checked like an
    // AI reply, then kept without an AI review; a failure falls back to the AI.
    const localRaw = slot.figureGroup
      ? readMarketFigureSpec(info.figures?.[slot.figureGroup.id])?.questions[slot.id]
      : undefined
    if (localRaw && slot.attempts === 0) {
      const local = verifyMockQuestion(localRaw, slot, {
        language: info.language,
        seed: setId,
        economics: true,
      })
      if (local.ok) {
        await this.updateSlot(setId, slotId, (current) => {
          const { error: _error, rejected: _rejected, ...rest } = current
          void _error
          void _rejected
          return {
            ...rest,
            attempts: current.attempts + 1,
            status: 'written',
            candidate: local.candidate,
          }
        })
        await this.saveQuestion(setId, slotId)
        return
      }
    }
    const topic = context.topics.get(slot.topicIds[0] ?? '')
    const template = slot.templateQuestionId ? context.templates.get(slot.templateQuestionId) : ''
    const others = [
      ...new Set(
        info.slots.filter((item) => item.id !== slot.id).flatMap((item) => item.topicNames),
      ),
    ].slice(0, 8)
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.mockPaper.buildSystemPrompt({
            ...(context.sigFigs ? { sigFigs: true } : {}),
            // Economics: supply-and-demand diagram parts the app solves itself.
            ...(context.subject?.subject === 'economics' ? { economics: true } : {}),
          }),
          context.subject,
        ),
      },
      {
        role: 'user',
        content: prompts.mockPaper.buildUserPrompt({
          language: info.language,
          difficulty: slot.difficulty,
          topic: {
            name: topic?.name ?? slot.topicNames[0] ?? '',
            ...(topic?.description ? { description: topic.description } : {}),
            ...(topic?.concepts.length ? { concepts: topic.concepts } : {}),
          },
          slot: {
            type: slot.kind,
            parts: slot.parts,
            ...(slot.marks !== undefined ? { marks: slot.marks } : {}),
            ...(slot.optionCount ? { options: slot.optionCount } : {}),
          },
          ...(template ? { template } : {}),
          ...(context.professorHabits ? { professorHabits: context.professorHabits } : {}),
          ...(context.conventions.length ? { professorConventions: context.conventions } : {}),
          ...(context.noneOptionLabel ? { noneOptionLabel: context.noneOptionLabel } : {}),
          ...(slot.rejected ? { rejected: slot.rejected } : {}),
          ...(others.length ? { otherTopics: others } : {}),
          ...figureGroupInput(info, slot),
        }),
      },
    ]
    const { data } = await ai.streamJSON<unknown>(messages, undefined, { signal: control.signal })
    const raw = prompts.mockPaper.normalizeQuestion(data)
    const result = raw
      ? verifyMockQuestion(raw, slot, {
          language: info.language,
          seed: setId,
          ...(context.subject?.subject === 'economics' ? { economics: true } : {}),
          ...(context.conventions.includes('none_of_above')
            ? { noneOption: context.noneOptionLabel ?? '' }
            : {}),
        })
      : ({ ok: false, code: 'structure' } as const)
    await this.updateSlot(setId, slotId, (current) => {
      const attempts = current.attempts + 1
      const { error: _error, rejected: _rejected, candidate: _candidate, ...rest } = current
      void _error
      void _rejected
      void _candidate
      if (result.ok) return { ...rest, attempts, status: 'written', candidate: result.candidate }
      const reason = reasonText(result.code)
      return attempts < MAX_WRITES
        ? { ...rest, attempts, status: 'pending', rejected: reason }
        : { ...rest, attempts, status: 'dropped', dropReason: reason }
    })
  }

  private async review(
    setId: string,
    slotIds: string[],
    context: RunContext,
    control: GenerationControl,
  ): Promise<void> {
    const ai = this.requireAI()
    const info = await this.info(setId)
    const slots = info.slots.filter(
      (slot) => slotIds.includes(slot.id) && slot.status === 'written' && slot.candidate,
    )
    if (slots.length === 0) return
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.mockPaper.buildReviewSystemPrompt(),
          context.subject,
        ),
      },
      {
        role: 'user',
        content: prompts.mockPaper.buildReviewUserPrompt({
          pastPaper: context.pastPaper,
          questions: slots.map((slot) => ({
            id: slot.id,
            type: slot.kind,
            difficulty: slot.difficulty,
            topic: slot.topicNames.join('; '),
            structure: structureText(slot),
            text: clip(slot.candidate!.prompt, 1_500),
            answers: clip(
              slot
                .candidate!.parts.map(
                  (part) => `${part.label ? `(${part.label}) ` : ''}${part.answer}`,
                )
                .join('; '),
              400,
            ),
            scheme: clip(slot.candidate!.scheme.join('; '), 600),
          })),
        }),
      },
    ]
    const { data } = await ai.streamJSON<unknown>(messages, undefined, { signal: control.signal })
    const verdicts = prompts.practiceReview.normalizeReview(
      data,
      new Set(slots.map((slot) => slot.id)),
    )
    for (const slot of slots) {
      const verdict = verdicts.find((item) => item.id === slot.id) ?? {
        pass: false,
        reason: t('aiMock.reason.noVerdict'),
      }
      if (verdict.pass) await this.saveQuestion(setId, slot.id)
      else
        await this.updateSlot(setId, slot.id, (current) => {
          const { candidate: _candidate, ...rest } = current
          void _candidate
          const reason = verdict.reason || t('aiMock.reason.noVerdict')
          return current.attempts < MAX_WRITES
            ? { ...rest, status: 'pending', rejected: reason }
            : { ...rest, status: 'dropped', dropReason: reason }
        })
    }
  }

  /** A reviewed question becomes a question of the paper at once. */
  private async saveQuestion(setId: string, slotId: string): Promise<void> {
    await this.db.transaction('rw', this.db.homeworkSets, this.db.homeworkQuestions, async () => {
      const set = await this.homework.getSet(setId)
      const info = set?.exam?.aiMock
      const slot = info?.slots.find((item) => item.id === slotId)
      if (!set || !info || !slot?.candidate || slot.status !== 'written') return
      const now = Date.now()
      const candidate = slot.candidate
      const question: HomeworkQuestion = {
        id: slot.questionId ?? crypto.randomUUID(),
        projectId: set.projectId,
        setId,
        documentId: set.documentId,
        documentName: set.documentName,
        order: slot.index,
        number: slot.label,
        prompt: candidate.prompt,
        sourceRefs: [],
        hints: [],
        solution: candidate.solution,
        generationStatus: 'ready',
        promptVersion: MOCK_PAPER_PROMPT_VERSION,
        practice: {
          origin: 'ai',
          parts: candidate.parts.map((part) => ({
            ...(part.label ? { label: part.label } : {}),
            answer: part.answer,
            grader: part.grader,
          })),
          knowledgePoints: slot.topicNames,
          templates: [],
          markingScheme: candidate.scheme,
          topicIds: slot.topicIds,
          difficulty: slot.difficulty,
        },
        ...marketFigureOf(info, slot),
        draftText: '',
        revealedHints: 0,
        solutionRevealed: false,
        messages: [],
        contentAt: now,
        createdAt: now,
        updatedAt: now,
      }
      await this.db.homeworkQuestions.put(question)
      const slots = info.slots.map((item) =>
        item.id === slotId ? { ...item, status: 'passed' as const, questionId: question.id } : item,
      )
      await this.homework.upsertSet({
        ...set,
        questionCount: slots.filter((item) => item.status === 'passed').length,
        progress: progressOf(slots),
        exam: { ...set.exam, aiMock: { ...info, slots } },
        updatedAt: now,
      })
    })
  }

  private async runContext(set: HomeworkSet): Promise<RunContext> {
    const projectId = set.projectId
    const info = set.exam!.aiMock!
    const analyses = new CourseAnalysisRepository(this.db)
    const [topics, concepts] = await Promise.all([
      analyses.listTopics(projectId),
      analyses.listConcepts(projectId),
    ])
    const wanted = new Set(info.slots.flatMap((slot) => slot.topicIds))
    const topicMap = new Map(
      topics
        .filter((topic) => wanted.has(topic.id))
        .map((topic) => [
          topic.id,
          {
            name: topic.name,
            ...(topic.description ? { description: clip(topic.description, 600) } : {}),
            concepts: concepts
              .filter((concept) => concept.topicIds.includes(topic.id))
              .map((concept) => concept.name)
              .slice(0, 12),
          },
        ]),
    )
    // The template: the past paper's own questions, never held-out ones.
    const template = await this.homework.getSet(info.config.templateSetId)
    const templates = new Map<string, string>()
    let pastPaper = ''
    if (template && !isHeldOut(template)) {
      const questions = (await this.homework.listQuestions(template.id))
        .filter((question) => !question.retired && !isHeldOut(question, template))
        .sort((a, b) => a.order - b.order)
      for (const [index, question] of questions.entries()) {
        templates.set(question.id, clip(question.prompt, TEMPLATE_CHARS))
        const line = `[${question.number ?? index + 1}] ${clip(question.prompt.replace(/\s+/g, ' '), REVIEW_PAPER_CHARS)}`
        if (pastPaper.length + line.length < REVIEW_PAPER_TOTAL)
          pastPaper += `${pastPaper ? '\n' : ''}${line}`
      }
    }
    const subject = await loadProjectSubjectContext(projectId, this.db)
    const professorHabits = await loadProfessorHabits(projectId, this.db)
    const { conventions, noneOptionLabel } = await loadProfessorConventions(projectId, this.db)
    return {
      set,
      subject,
      topics: topicMap,
      templates,
      pastPaper,
      ...(professorHabits ? { professorHabits } : {}),
      conventions,
      ...(noneOptionLabel ? { noneOptionLabel } : {}),
      sigFigs:
        subject?.subject === 'chemistry' ||
        subject?.subject === 'physics' ||
        conventions.includes('sig_figs'),
    }
  }

  /** Topics of the paper's scope, with past-paper marks shares and mastery. */
  private async scopeTopics(
    projectId: string,
    exam: PlannedExam | undefined,
    scope: AiMockConfig['scope'],
  ): Promise<MockTopicInput[]> {
    const courseTopics = await new CourseAnalysisRepository(this.db).listTopics(projectId)
    const syllabi = await new SyllabusService({ db: this.db }).listSyllabi(projectId)
    const ids = examTopicIds(exam, syllabi, scope)
    const inScope = ids ? courseTopics.filter((topic) => ids.includes(topic.id)) : courseTopics
    const scoped = inScope.length > 0 ? inScope : courseTopics
    // Marks per topic over the uploaded past papers (not AI mocks, not held out).
    const sets = (await this.homework.listSets(projectId)).filter(
      (set) => isPastPaperSet(set) && set.status === 'ready' && !isHeldOut(set),
    )
    const papers = []
    for (const set of sets) {
      papers.push({
        setId: set.id,
        title: set.title,
        questions: (await this.homework.listQuestions(set.id))
          .filter((question) => !question.retired && !isHeldOut(question, set))
          .map((question) => ({ id: question.id, setId: set.id, prompt: question.prompt })),
      })
    }
    const past = analyzePastExams({ papers, topics: courseTopics })
    const basis = past.totalMarks > 0 ? 'marks' : 'questions'
    const byTopic = new Map(
      past.byTopic.map((row) => [row.topicId, basis === 'marks' ? row.marks : row.questions]),
    )
    const total = scoped.reduce((sum, topic) => sum + (byTopic.get(topic.id) ?? 0), 0)
    const rows = await new MasteryService(this.db).listByProject(projectId)
    return scoped.map((topic) => ({
      id: topic.id,
      name: topic.name,
      ...(total > 0 ? { marksShare: (byTopic.get(topic.id) ?? 0) / total } : {}),
      mastery: masteryOf(rows, topic),
    }))
  }

  /** Earlier AI mock papers (of this exam when given) with their checked results. */
  private async previous(projectId: string, examId?: string): Promise<PreviousMockView[]> {
    const out: PreviousMockView[] = []
    for (const set of await this.listPapers(projectId)) {
      const info = set.exam?.aiMock
      if (!info) continue
      if (examId && info.config.examId && info.config.examId !== examId) continue
      const checked = lastCheckedFraction(set)
      out.push({
        setId: set.id,
        title: set.title,
        difficulty: info.config.difficulty,
        fraction: checked?.fraction ?? null,
        at: checked?.at ?? set.createdAt,
      })
    }
    return out
  }

  private async language(projectId: string, template: HomeworkSet): Promise<MockLanguage> {
    const course = await loadCourseLanguage(projectId, { db: this.db })
    if (course.examKey) return course.examKey
    if (course.mode === 'en') return 'en'
    if (course.mode === 'source') return template.language === 'zh' ? 'zh' : 'en'
    return 'zh_terms'
  }

  private async info(setId: string): Promise<AiMockInfo> {
    const info = (await this.homework.getSet(setId))?.exam?.aiMock
    if (!info) throw new NotFoundError('HomeworkSet', setId)
    return info
  }

  private async updateInfo(setId: string, fn: (info: AiMockInfo) => AiMockInfo): Promise<void> {
    await this.db.transaction('rw', this.db.homeworkSets, async () => {
      const set = await this.homework.getSet(setId)
      const info = set?.exam?.aiMock
      if (!set || !info) return
      const next = fn(info)
      await this.homework.upsertSet({
        ...set,
        exam: { ...set.exam, aiMock: next },
        progress: set.status === 'ready' ? set.progress : progressOf(next.slots),
        updatedAt: Date.now(),
      })
    })
  }

  private updateSlot(
    setId: string,
    slotId: string,
    fn: (slot: MockSlotState) => MockSlotState,
  ): Promise<void> {
    return this.updateInfo(setId, (info) => ({
      ...info,
      slots: info.slots.map((slot) => (slot.id === slotId ? fn(slot) : slot)),
    }))
  }

  private requireAI(): AIService {
    if (!this.ai) throw new AppError(t('homework.noProvider'), 'MISSING_API_KEY')
    return this.ai
  }
}

/** A failed slot goes back to review (it has a question) or to writing. */
function reopenFailed(slot: MockSlotState): MockSlotState {
  if (slot.status !== 'failed') return slot
  const { error: _error, ...rest } = slot
  void _error
  return { ...rest, status: slot.candidate ? 'written' : 'pending' }
}

function progressOf(slots: readonly MockSlotState[]): HomeworkSet['progress'] {
  return {
    stage: 'generating',
    completed: slots.filter((slot) => slot.status === 'passed' || slot.status === 'dropped').length,
    total: slots.length,
    updatedAt: Date.now(),
  }
}

function structureText(slot: MockSlotState): string {
  if (slot.parts.length === 0)
    return `no sub-parts${slot.marks !== undefined ? `; ${slot.marks} marks` : ''}`
  return slot.parts
    .map((part) => `(${part.label})${part.marks !== undefined ? ` ${part.marks} marks` : ''}`)
    .join(', ')
}
