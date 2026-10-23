import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import {
  QUESTION_TYPES,
  questionTypesForSubject,
  type Question,
  type QuestionType,
} from '@/entities/question/types'
import type { QuestionAttempt, QuestionEvaluation } from '@/entities/questionAttempt/types'
import type {
  Quiz,
  QuizBank,
  QuizBankEntry,
  QuizConfig,
  QuizDifficulty,
  QuizKnowledgeStat,
  QuizLanguage,
  QuizResumeSlot,
  QuizResumeState,
  QuizScore,
} from '@/entities/quiz/types'
import { knowledgeStatPercent } from '@/entities/quiz/types'
import { scoredOralPoints } from '@/entities/question/oral'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import { prompts } from '@/infrastructure/ai/prompts'
import type {
  QuizGenerationOutput,
  GeneratedQuizQuestion as RawGeneratedQuizQuestion,
  QuizSystemPromptOptions,
} from '@/infrastructure/ai/prompts/quiz-generator/v10'
import {
  genderAnswerText,
  paradigmAnswerText,
  type GenderNoun,
  type ParadigmTable,
} from '@/entities/question/languageDrills'
import {
  normalizeForSource,
  validateArticleQuestion,
  validateParadigmTable,
} from './languageDrillValidation'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { exhaustedOutputCap, type AIService } from './aiService'
import { evaluateDeterministic, parseTrueFalse } from './answerEvaluationService'
import {
  decideNextDifficulty,
  nextStreaks,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_ORDER,
  stepDifficulty,
} from './adaptiveDifficulty'
import { MasteryService } from './masteryService'
import { planBank, selectNextBankQuestion, usesQuestionBank, type BankCandidate } from './quizBank'
import type { MistakeService } from './mistakeService'
import type { ProjectService } from './projectService'
import {
  formatSnippetForPrompt,
  loadQuizCandidates,
  pickQuizSnippets,
  scopeSnippetsByStructure,
  type SourceSnippet,
} from './sourceContext'
import { DocumentRepository } from '@/entities/document/repository'
import { examTopicsFor, planExamScopeEntries } from '@/entities/syllabus/examPlan'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { buildHabitsBlock, professorConventions } from '@/entities/questionHabits/types'
import { PracticeService, formatQuestionStyleContext } from './practiceService'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import { logger } from '@/infrastructure/logger/logger'
import { AppError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'
import { loadProjectSubject, loadProjectSubjectContext } from './projectSubject'
import { ShortAnswerGrader, tooShortEvaluation } from './shortAnswerGrader'
import { OralExamService } from './oralExamService'
import { checkBlanksWithAi } from './fillBlankChecker'
import { projectTargetLanguage } from './projectTargetLanguage'
import { projectSigFigPolicy } from './projectGradingRules'
import { isSigFigOnlyError } from '@/entities/question/answerDimensions'
import { imbalances, parseEquation } from '@/infrastructure/chemistry/equation'
import { isValidUnit } from '@/infrastructure/math/quantityAnswer'
import { normalizeProgramOutput } from './answerEvaluationService'
import type { SubjectInput } from '@/entities/project/types'
import { isNoneOption, shuffled, shuffledOptions } from '@/shared/lib/shuffle'
import { asSigFigCount } from '@/infrastructure/math/significantFigures'
import {
  asVectorComponents,
  formatVectorSpec,
  type VectorSpec,
} from '@/infrastructure/math/vectorAnswer'
import {
  normalizeChemicalName,
  parseFormulaAnswer,
  type NomenclatureSpec,
} from '@/infrastructure/chemistry/nomenclature'
import { formatForces, isForceType, type ForceSpec } from '@/entities/question/forceList'
import type { SigFigBasis } from '@/entities/question/answerDimensions'
import type { ProfessorConvention } from '@/infrastructure/ai/prompts/quiz-generator/v10'
import type { MarketQuestion } from '@/entities/econ/graphQuestion'
import { isMarketQuestionType } from '@/entities/econ/graphAnswerText'
import { createRng } from '@/entities/homework/practice/random'
import {
  familiesForTopic,
  generateMarketQuestion,
  type MarketLanguage,
} from '@/entities/econ/graphGenerator'
import { verifyMarketCheck } from '@/entities/econ/graphVerify'
import {
  DEFAULT_QUESTION_LANGUAGE,
  examModeKey,
  type QuestionLanguage,
} from '@/entities/user/types'
import { loadCourseLanguage } from './courseLanguage'

/** Scoring points per short answer: enough to grade, few enough to stay distinct. */
const MIN_RUBRIC_POINTS = 2
const MAX_RUBRIC_POINTS = 6
const MAX_RUBRIC_POINT_LENGTH = 200
export interface QuizServiceDeps {
  ai: AIService
  db?: AppDatabase
  questions?: QuestionRepository
  attempts?: QuestionAttemptRepository
  quizzes?: QuizRepository
  analyses?: CourseAnalysisRepository
  chunks?: ChunkRepository
  mastery?: MasteryService
  /** When provided, wrong answers are automatically added to the mistake book. */
  mistakes?: MistakeService
  /** When provided, quiz generation verifies the project exists. */
  projects?: ProjectService
  /** Supplies the professor's question-style profile, when one exists. */
  contexts?: CourseContextRepository
}

export interface GenerateQuizOptions {
  onProgress?: (stage: string, progress: number) => void
  signal?: AbortSignal
  /**
   * Pause / stop. A pause (or a stop, which also aborts the batch in flight)
   * ends the run with the quiz `paused`: the questions generated so far are
   * stored and `continueQuiz` fills the rest. A bare `signal` behaves the same.
   */
  control?: GenerationControl
}

export interface SubmitAnswerResult {
  attempt: QuestionAttempt
  evaluation: QuestionEvaluation
  nextDifficulty: DifficultyLevel
  difficultyReason: string
  isLastQuestion: boolean
  /** A bank quiz: the question served next, chosen by the adaptive model. */
  nextQuestion?: Question
}

export type MoreQuestionsMode = 'same_topic' | 'similar' | 'harder' | 'easier' | 'weakness'

const MAX_GENERATION_ATTEMPTS = 2

/** Questions asked for in one request; larger quizzes are generated in batches. */
const QUIZ_BATCH_SIZE = 5
/** Extra requests for questions a batch did not deliver (dropped or missing). */
const MAX_TOP_UP_ROUNDS = 2
/** Source passages offered: enough to spread a large quiz across the course. */
const MIN_QUIZ_SNIPPETS = 8
const MAX_QUIZ_SNIPPETS = 24
/** "Avoid repeating" names the latest questions only, each by its opening words. */
const AVOID_MAX_QUESTIONS = 30
const AVOID_QUESTION_CHARS = 160

/**
 * The questions a batch is told not to repeat: the latest
 * `AVOID_MAX_QUESTIONS`, whitespace collapsed and cut to their opening words
 * (enough to recognise a question; a vignette or program need not be resent).
 */
export function avoidRepeatingList(asked: readonly string[]): string[] {
  return asked.slice(-AVOID_MAX_QUESTIONS).map((question) => {
    const text = question.replace(/\s+/g, ' ').trim()
    return text.length > AVOID_QUESTION_CHARS ? `${text.slice(0, AVOID_QUESTION_CHARS)}…` : text
  })
}

/** `group` points into the quiz's topic groups (a mixed review spreads its questions over topics). */
type PlanEntry = { slot: number; type: QuestionType; difficulty: DifficultyLevel; group?: number }

function toResumeSlot({ slot, type, difficulty, group }: PlanEntry): QuizResumeSlot {
  return { slot, type, difficulty, ...(group !== undefined ? { group } : {}) }
}

/** Quizzes this tab is generating right now (a stale `generating` row elsewhere is recovered). */
const generatingQuizzes = new Set<string>()
/** A `generating` row untouched this long, and not running here, was interrupted. */
const STALE_GENERATION_MS = 10 * 60_000

/** What one part of a quiz is about: a topic's knowledge points and source passages. */
interface QuizGroup {
  topicId?: string
  /**
   * An exam topic the course material does not cover: no source passages, and
   * its questions are stored as AI-generated without a course source.
   */
  aiOnly?: boolean
  knowledgePoints: string[]
  snippets: SourceSnippet[]
}

/** Source passages offered per topic in a mixed review. */
const SNIPPETS_PER_TOPIC = 3
/** Knowledge points named per topic in a mixed review. */
const POINTS_PER_TOPIC = 3

/**
 * A correct option this much longer than every distractor gives the answer
 * away (models tend to make the right answer the most detailed one).
 */
const ANSWER_LENGTH_RATIO = 1.6
const ANSWER_LENGTH_MARGIN = 12

function answerStandsOut(options: Array<{ label: string; isCorrect: boolean }>): boolean {
  const correct = options.find((o) => o.isCorrect)
  const others = options.filter((o) => !o.isCorrect).map((o) => o.label.length)
  if (!correct || others.length === 0) return false
  const longest = Math.max(...others)
  return (
    correct.label.length > longest * ANSWER_LENGTH_RATIO &&
    correct.label.length - longest >= ANSWER_LENGTH_MARGIN
  )
}

/** The language the generator writes in, from the student's preference and the material. */
export function quizLanguage(
  preference: QuestionLanguage | undefined,
  material: 'zh' | 'en' | 'mixed',
  /** `exam` mode: the course's detected exam language (`loadCourseLanguage`). */
  examLanguage?: string,
): QuizLanguage {
  const choice = preference ?? DEFAULT_QUESTION_LANGUAGE
  // 跟随考试语言: `exam:<code>`; a Chinese or undetected exam falls back to the default.
  if (choice === 'exam') return examModeKey(choice, examLanguage) ?? 'zh_terms'
  return choice === 'source' ? material : choice
}

/** A generated question after validation: language drills carry their checked data. */
export type GeneratedQuizQuestion = Omit<
  RawGeneratedQuizQuestion,
  'sigFigs' | 'forces' | 'market' | 'target' | 'draw'
> & {
  gender?: GenderNoun
  paradigm?: ParadigmTable
  sigFigs?: number
  sigFigsBasis?: SigFigBasis
  vector?: VectorSpec
  nomenclature?: NomenclatureSpec
  forces?: ForceSpec[]
  /** Economics graph questions: the checked market and what is asked. */
  market?: MarketQuestion
}

/** The language a locally built graph question is written in. */
function marketLanguage(language: string | undefined): MarketLanguage {
  return !language || language.startsWith('zh') || language === 'exam:zh' ? 'zh' : 'en'
}

/** A formula reduced for a "does the prompt show it" check. */
function compactFormula(text: string): string {
  return text
    .replace(/\\ce\{([^}]*)\}/g, '$1')
    .replace(/[\s$^{}_]/g, '')
    .toLowerCase()
}

/** Types only some subjects offer (see `questionTypesForSubject`). */
const SUBJECT_TYPES: QuestionType[] = [
  'article_gender',
  'paradigm_table',
  'vector',
  'nomenclature',
  'force_list',
  'shift_id',
  'area_read',
  'draw_diagram',
]

/**
 * The requested types a course may use: a language drill only where
 * `questionTypesForSubject` offers it (a language course; the article drill
 * only for German). Other types pass unchanged. Never empty.
 */
export function offeredQuizTypes(types: QuestionType[], subject: SubjectInput): QuestionType[] {
  const context = typeof subject === 'string' ? { subject } : subject
  const offered = questionTypesForSubject(context?.subject, context?.targetLanguage)
  const kept = types.filter((type) => !SUBJECT_TYPES.includes(type) || offered.includes(type))
  return kept.length > 0 ? kept : [DEFAULT_QUESTION_TYPE]
}

/** The generator describes the language drills to a language course only. */
function drillPromptOptions(subject: SubjectInput): QuizSystemPromptOptions {
  const context = typeof subject === 'string' ? { subject } : subject
  if (context?.subject !== 'language') return {}
  const targetLanguage = 'targetLanguage' in context ? context.targetLanguage : undefined
  return { languageDrills: targetLanguage ? { targetLanguage } : {} }
}

/**
 * Significant figures are described to chemistry and physics courses, and to
 * any course whose professor grades them (habits profile); the final "none of
 * the options" choice only when the professor uses it.
 */
function conventionPromptOptions(
  subject: SubjectInput,
  conventions: readonly string[] | undefined,
): Pick<QuizSystemPromptOptions, 'sigFigs' | 'noneOfTheAbove'> {
  const context = typeof subject === 'string' ? { subject } : subject
  const sigFigs =
    context?.subject === 'chemistry' ||
    context?.subject === 'physics' ||
    Boolean(conventions?.includes('sig_figs'))
  return {
    ...(sigFigs ? { sigFigs: true } : {}),
    ...(conventions?.includes('none_of_above') ? { noneOfTheAbove: true } : {}),
  }
}

/** Used when the model omits `type` entirely. */
const DEFAULT_QUESTION_TYPE: QuestionType = 'multiple_choice'

/**
 * Coerce the model's option array into `{ label, isCorrect }` entries.
 *
 * Returns `null` when the set is unusable: not an array, a non-object entry,
 * an option whose `label` is missing/blank, fewer than two options, or a
 * number of `isCorrect` options other than exactly one.
 *
 * This is what prevents the reported bug — a multiple-choice question whose
 * options rendered as "A. B. C. D." with no content, because blank labels
 * were accepted and stored.
 */
function normalizeChoiceOptions(
  value: unknown,
): Array<{ label: string; isCorrect: boolean }> | null {
  if (!Array.isArray(value)) return null
  const options: Array<{ label: string; isCorrect: boolean }> = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null
    const label = (raw as { label?: unknown }).label
    if (typeof label !== 'string') return null
    const trimmed = label.trim()
    if (!trimmed || options.some((o) => o.label === trimmed)) return null
    options.push({
      label: trimmed,
      isCorrect: (raw as { isCorrect?: unknown }).isCorrect === true,
    })
  }
  if (options.length < 2) return null
  if (options.filter((o) => o.isCorrect).length !== 1) return null
  return options
}

/** 2–6 options with distinct labels (no "|"), any number flagged correct. */
function normalizeOptionSet(value: unknown): Array<{ label: string; isCorrect: boolean }> | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const options: Array<{ label: string; isCorrect: boolean }> = []
  for (const raw of value) {
    const label = raw && typeof raw === 'object' ? (raw as { label?: unknown }).label : undefined
    if (typeof label !== 'string') return null
    const trimmed = label.trim()
    if (!trimmed || trimmed.includes('|') || seen.has(trimmed)) return null
    seen.add(trimmed)
    options.push({ label: trimmed, isCorrect: (raw as { isCorrect?: unknown }).isCorrect === true })
  }
  return options.length >= 2 && options.length <= 6 ? options : null
}

/**
 * The adaptive model's view of a quiz's attempts. A disputed judgement no
 * longer counts, so it reads as unverified (null) and moves nothing.
 */
export function adaptiveHistory(history: QuestionAttempt[]): {
  recentResults: Array<{ isCorrect: boolean | null; difficulty: DifficultyLevel }>
  streaks: { consecutiveCorrect: number; consecutiveWrong: number }
} {
  const counted = (a: QuestionAttempt) => (a.evaluation.disputed ? null : a.evaluation.isCorrect)
  return {
    recentResults: history.map((a) => ({
      isCorrect: counted(a),
      difficulty: a.difficulty as DifficultyLevel,
    })),
    streaks: history.reduce(
      (acc, a) => nextStreaks(counted(a), acc.consecutiveCorrect, acc.consecutiveWrong),
      { consecutiveCorrect: 0, consecutiveWrong: 0 },
    ),
  }
}

/** A bank's entries with their stored questions (missing rows are skipped). */
function bankCandidates(entries: QuizBankEntry[], questions: Question[]): BankCandidate[] {
  const byId = new Map(questions.map((question) => [question.id, question]))
  return entries.flatMap((entry) => {
    const question = byId.get(entry.questionId)
    if (!question) return []
    return [
      {
        questionId: entry.questionId,
        slot: entry.slot,
        difficulty: entry.difficulty,
        knowledgePoint: question.knowledgePoint,
        type: question.type,
      },
    ]
  })
}

/** How much of a chunk to show when the model's quote cannot be verified. */
const SOURCE_EXCERPT_CHARS = 320

/**
 * Text that means the model wrote a summary instead of quoting the source.
 * Such text is never presented to the user as a course excerpt.
 */
const SUMMARY_QUOTE =
  /^(this question is based|based on the (concept|idea|topic|material)|the question (is|was) (based|derived)|it is based on|derived from the)/i

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** True when the quote really occurs in the chunk (whitespace-insensitive). */
function quoteAppearsIn(chunkText: string, quote: string): boolean {
  const haystack = normalizeForMatch(chunkText)
  const needle = normalizeForMatch(quote)
  if (!needle) return false
  if (haystack.includes(needle)) return true
  // The model may have trimmed a long passage — accept a solid prefix.
  const probe = needle.slice(0, 60)
  return probe.length >= 24 && haystack.includes(probe)
}

/** A real excerpt taken straight from the chunk. */
function excerptFrom(chunkText: string): string {
  const collapsed = chunkText.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= SOURCE_EXCERPT_CHARS) return collapsed
  return `${collapsed.slice(0, SOURCE_EXCERPT_CHARS).trimEnd()}…`
}

/**
 * Build a question's citation from **local data only**.
 *
 * The model contributes just a chunk id and a quote; both are verified here:
 *  - an id that was not offered in the prompt is discarded (never invented)
 *  - a quote that is missing, is a summary, or does not occur in the chunk is
 *    replaced by a real excerpt, so a made-up "course quote" can never appear
 *
 * Returns an empty array when the question cannot be grounded, which the UI
 * renders as "no source recorded".
 */
export function resolveSourceReferences(
  sourceChunkId: unknown,
  quote: unknown,
  index: Map<string, SourceSnippet>,
): SourceReference[] {
  if (typeof sourceChunkId !== 'string') return []
  const snippet = index.get(sourceChunkId.trim())
  if (!snippet) return []

  const raw = typeof quote === 'string' ? quote.trim() : ''
  const verified = raw.length > 0 && !SUMMARY_QUOTE.test(raw) && quoteAppearsIn(snippet.text, raw)

  const reference: SourceReference = {
    documentId: snippet.documentId,
    documentName: snippet.documentName,
    quote: verified ? raw : excerptFrom(snippet.text),
    chunkId: snippet.chunkId,
  }
  if (snippet.pageNumber !== undefined) reference.page = snippet.pageNumber
  if (snippet.section) reference.section = snippet.section
  return [reference]
}

export class QuizService {
  private db: AppDatabase
  private questions: QuestionRepository
  private attempts: QuestionAttemptRepository
  private quizzes: QuizRepository
  private analyses: CourseAnalysisRepository
  private chunks: ChunkRepository
  private mastery: MasteryService
  private contexts: CourseContextRepository
  private mistakes: MistakeService | null
  private projects: ProjectService | null
  private ai: AIService

  constructor(deps: QuizServiceDeps) {
    this.db = deps.db ?? getDb()
    this.questions = deps.questions ?? new QuestionRepository(this.db)
    this.attempts = deps.attempts ?? new QuestionAttemptRepository(this.db)
    this.quizzes = deps.quizzes ?? new QuizRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.mastery = deps.mastery ?? new MasteryService(this.db)
    this.contexts = deps.contexts ?? new CourseContextRepository(this.db)
    this.mistakes = deps.mistakes ?? null
    this.projects = deps.projects ?? null
    this.ai = deps.ai
  }

  /**
   * Load a quiz. With `projectId`, a quiz from another course is reported
   * as not found, so a URL cannot open one project's quiz under another.
   */
  async getQuiz(id: string, projectId?: string): Promise<Quiz> {
    const quiz = await this.quizzes.get(id)
    if (!quiz || (projectId !== undefined && quiz.projectId !== projectId)) {
      throw new AppError(t('errors.quizNotFound'), 'NOT_FOUND')
    }
    return quiz
  }

  async listQuizzes(projectId: string): Promise<Quiz[]> {
    return this.quizzes.listByProject(projectId)
  }

  async getQuestions(quizId: string): Promise<Question[]> {
    const quiz = await this.getQuiz(quizId)
    return this.questions.listByIds(quiz.questionIds)
  }

  /**
   * Build an adaptive difficulty plan: starts at the configured difficulty
   * (or `basic` for adaptive mode) and escalates as the plan progresses.
   */
  buildDifficultyPlan(config: QuizConfig): DifficultyLevel[] {
    const base: DifficultyLevel =
      config.difficulty === 'adaptive' ? DEFAULT_DIFFICULTY : config.difficulty
    const plan: DifficultyLevel[] = []
    let current = base
    for (let i = 0; i < config.count; i++) {
      plan.push(current)
      if (config.difficulty === 'adaptive') {
        // Gentle ramp: every 3 questions bump one level until `advanced`.
        if (
          (i + 1) % 3 === 0 &&
          DIFFICULTY_ORDER.indexOf(current) < DIFFICULTY_ORDER.indexOf('advanced')
        ) {
          current = stepDifficulty(current, +1)
        }
      }
    }
    return plan
  }

  buildTypePlan(config: QuizConfig, count: number): QuestionType[] {
    const types = config.types.length > 0 ? config.types : [DEFAULT_QUESTION_TYPE]
    const plan: QuestionType[] = []
    for (let i = 0; i < count; i++) plan.push(types[i % types.length]!)
    return plan
  }

  /** Generate a new quiz from the project's course analysis. */
  async generateQuiz(
    projectId: string,
    config: QuizConfig,
    options: GenerateQuizOptions = {},
  ): Promise<Quiz> {
    // Verify the project exists before touching any project-scoped data, so an
    // unknown id fails as "not found" rather than as a misleading domain error.
    if (this.projects) await this.projects.get(projectId)
    // Oral-exam rehearsal: drawn topics with follow-ups, stored as short answers.
    if (config.mode === 'oral') return this.oral().generate(projectId, config, options)

    const analysis = await this.analyses.getByProject(projectId)
    if (!analysis || analysis.status !== 'ready') {
      throw new AppError(t('errors.analysisMissing'), 'NO_ANALYSIS')
    }
    if (config.count < 1 || config.count > 30) {
      throw new AppError(t('errors.questionCountRange'), 'INVALID_COUNT')
    }
    const control = resolveControl(options.control, options.signal)

    const topic = config.topicId ? await this.analyses.getTopic(config.topicId) : undefined
    const topicName = topic?.name ?? config.topicName ?? t('quiz.mixedReviewName')
    const topicDescription = topic?.description ?? t('quiz.topicDescriptionMixed')
    const knowledgePoints = await this.resolveKnowledgePoints(projectId, config, topic?.name)

    const subjectContext = await loadProjectSubjectContext(projectId)
    const difficultyPlan = this.buildDifficultyPlan(config)
    // A language drill is only asked for in a course that offers it.
    const typePlan = this.buildTypePlan(
      { ...config, types: offeredQuizTypes(config.types, subjectContext) },
      config.count,
    )
    // An adaptive quiz is generated as a bank: several levels per slot, and
    // each answer picks the next question. `PlanEntry.slot` then indexes the
    // bank plan; the quiz slot it fills is `bank.plan[slot].slot`.
    const bank: QuizBank | undefined = usesQuestionBank(config)
      ? {
          start: DEFAULT_DIFFICULTY,
          plan: planBank(config.count, DEFAULT_DIFFICULTY),
          entries: [],
          length: config.count,
        }
      : undefined
    const plan: PlanEntry[] = bank
      ? bank.plan.map((entry, i) => ({
          slot: i,
          difficulty: entry.difficulty,
          type: typePlan[entry.slot]!,
        }))
      : difficultyPlan.map((difficulty, i) => ({
          slot: i,
          difficulty,
          type: typePlan[i]!,
        }))

    const quiz: Quiz = {
      id: crypto.randomUUID(),
      projectId,
      title: t('quiz.topicTitle', { topic: topicName, count: config.count }),
      config,
      questionIds: [],
      status: 'generating',
      // A bank quiz records the levels actually served, as they are served.
      difficultyPlan: bank ? [] : difficultyPlan,
      startedAt: Date.now(),
      promptVersion: prompts.quizGenerator.VERSION,
      ...(bank ? { bank } : {}),
    }
    await this.quizzes.upsert(quiz)
    generatingQuizzes.add(quiz.id)

    try {
      options.onProgress?.('collecting', 10)
      // Every passage the quiz may use, loaded once and shared by its groups.
      const candidates = await loadQuizCandidates({
        documentIds: analysis.documentIds,
        chunks: this.chunks,
        documents: new DocumentRepository(this.db),
        ...(config.chapterId ? { chapterId: config.chapterId } : {}),
        ...(config.sectionId ? { sectionId: config.sectionId } : {}),
      })
      const scope = {
        ...(config.chapterId ? { chapterId: config.chapterId } : {}),
        ...(config.sectionId ? { sectionId: config.sectionId } : {}),
      }
      const groups = await this.planGroups(
        projectId,
        config,
        candidates,
        knowledgePoints,
        topic,
        plan.length,
      )
      // Spread the questions over the groups (one group unless a mixed review).
      // A bank slot's levels share their quiz slot's group.
      groups.forEach((group) => {
        group.snippets = scopeSnippetsByStructure(group.snippets, scope)
      })
      plan.forEach((entry, i) => {
        const quizSlot = bank ? bank.plan[i]!.slot : i
        if (groups.length > 1) entry.group = quizSlot % groups.length
      })

      options.onProgress?.('generating', 30)
      // How the professor writes questions (never what is tested). Absent when
      // no Professor Practice has been imported, so behaviour is unchanged.
      const courseContext = await this.contexts.get(projectId)
      const professorStyleContext = courseContext?.questionStyleProfile
        ? formatQuestionStyleContext(courseContext.questionStyleProfile)
        : undefined
      // 教授出题习惯 (「模仿教授出题」 on and not empty); absent otherwise.
      const professorHabits = buildHabitsBlock(courseContext?.questionHabits)
      // Conventions the generator follows explicitly (final "none" option …).
      const conventions = professorConventions(courseContext?.questionHabits)
      // The quiz's own choice, else the course's, else the global preference.
      const courseLanguage = await loadCourseLanguage(projectId, {
        db: this.db,
        ...(config.questionLanguage ? { override: config.questionLanguage } : {}),
      })
      const preference = courseLanguage.mode
      // Everything needed to fill the plan later is on the row from the start,
      // so a pause (or a closed tab) keeps the questions already generated.
      const resume: QuizResumeState = {
        pending: plan.map(toResumeSlot),
        questionSlots: [],
        groups: groups.map((group) => ({
          ...(group.topicId ? { topicId: group.topicId } : {}),
          ...(group.aiOnly ? { aiOnly: true } : {}),
          knowledgePoints: group.knowledgePoints,
          snippetChunkIds: group.snippets.map((snippet) => snippet.chunkId),
        })),
        knowledgePoints,
        topicName,
        topicDescription,
        language: quizLanguage(preference, analysis.language, courseLanguage.examLanguage),
        ...(professorStyleContext ? { professorStyleContext } : {}),
        ...(professorHabits ? { professorHabits } : {}),
        ...(conventions.conventions.length
          ? { professorConventions: conventions.conventions }
          : {}),
        ...(conventions.noneOptionLabel ? { noneOptionLabel: conventions.noneOptionLabel } : {}),
        updatedAt: Date.now(),
      }
      const withResume: Quiz = { ...quiz, resume }
      await this.quizzes.upsert(withResume)
      return await this.fillPlan(withResume, groups, subjectContext, control, options.onProgress)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.quizGenerationFailed')
      const latest = (await this.quizzes.get(quiz.id)) ?? quiz
      await this.quizzes.upsert({ ...latest, status: 'failed', errorMessage: message })
      throw err
    } finally {
      generatingQuizzes.delete(quiz.id)
    }
  }

  /**
   * 「继续出题」: fill the remaining slots of a paused quiz (same batching and
   * top-up rules), then make it takeable. Pausing again keeps what was added;
   * a failed continuation leaves it paused with its questions.
   */
  async continueQuiz(quizId: string, options: GenerateQuizOptions = {}): Promise<Quiz> {
    const quiz = await this.getQuiz(quizId)
    if (quiz.status !== 'paused') return quiz
    if (quiz.config.mode === 'oral') return this.oral().continue(quiz, options)
    const resume = quiz.resume
    if (!resume) throw new AppError(t('quiz.paused.interrupted'), 'QUIZ_GENERATION_FAILED')
    const analysis = await this.analyses.getByProject(quiz.projectId)
    if (!analysis || analysis.status !== 'ready') {
      throw new AppError(t('errors.analysisMissing'), 'NO_ANALYSIS')
    }
    const control = resolveControl(options.control, options.signal)
    const { errorMessage: _previous, ...rest } = quiz
    void _previous
    const generating: Quiz = { ...rest, status: 'generating' }
    await this.quizzes.upsert(generating)
    generatingQuizzes.add(quiz.id)
    try {
      options.onProgress?.('collecting', 10)
      // The groups' passages, reloaded by the chunk ids chosen when it started.
      const candidates = await loadQuizCandidates({
        documentIds: analysis.documentIds,
        chunks: this.chunks,
        documents: new DocumentRepository(this.db),
        ...(quiz.config.chapterId ? { chapterId: quiz.config.chapterId } : {}),
        ...(quiz.config.sectionId ? { sectionId: quiz.config.sectionId } : {}),
      })
      const byId = new Map(candidates.map((snippet) => [snippet.chunkId, snippet]))
      const groups: QuizGroup[] = resume.groups.map((group) => ({
        ...(group.topicId ? { topicId: group.topicId } : {}),
        ...(group.aiOnly ? { aiOnly: true } : {}),
        knowledgePoints: group.knowledgePoints,
        snippets: group.snippetChunkIds
          .map((id) => byId.get(id))
          .filter((snippet): snippet is SourceSnippet => snippet !== undefined),
      }))
      const subject = await loadProjectSubjectContext(quiz.projectId)
      options.onProgress?.('generating', 30)
      return await this.fillPlan(generating, groups, subject, control, options.onProgress)
    } catch (err) {
      const latest = (await this.quizzes.get(quiz.id)) ?? quiz
      await this.quizzes.upsert({
        ...latest,
        status: 'paused',
        ...(err instanceof Error ? { errorMessage: err.message } : {}),
      })
      throw err
    } finally {
      generatingQuizzes.delete(quiz.id)
    }
  }

  /**
   * A quiz left `generating` by a closed tab or a crash (no request of this
   * tab is working on it and its row has not moved for a while) is not stuck:
   * one that recorded its plan becomes `paused` (its questions stay and can
   * be continued); an older row without a plan becomes `failed`.
   */
  async recoverInterruptedQuizzes(projectId: string, now = Date.now()): Promise<number> {
    let recovered = 0
    for (const quiz of await this.quizzes.listByProject(projectId)) {
      if (quiz.status !== 'generating' || generatingQuizzes.has(quiz.id)) continue
      const touched = quiz.resume?.updatedAt ?? quiz.oralResume?.updatedAt ?? quiz.startedAt
      if (now - touched < STALE_GENERATION_MS) continue
      await this.quizzes.upsert(
        quiz.resume || quiz.oralResume
          ? { ...quiz, status: 'paused' }
          : { ...quiz, status: 'failed', errorMessage: t('quiz.paused.interrupted') },
      )
      recovered += 1
    }
    return recovered
  }

  private oral(): OralExamService {
    return new OralExamService({
      ai: this.ai,
      db: this.db,
      questions: this.questions,
      quizzes: this.quizzes,
      analyses: this.analyses,
      chunks: this.chunks,
      generating: generatingQuizzes,
    })
  }

  /**
   * Generate the quiz's pending slots, storing each batch's questions on the
   * row as soon as they exist. Ends `ready` (questions in plan order), or
   * `paused` when the control asked to stop starting new batches.
   */
  private async fillPlan(
    quiz: Quiz,
    groups: QuizGroup[],
    subject: SubjectInput,
    control: GenerationControl,
    onProgress?: (stage: string, progress: number) => void,
  ): Promise<Quiz> {
    const resume = quiz.resume!
    const topic = quiz.config.topicId
      ? await this.analyses.getTopic(quiz.config.topicId)
      : undefined
    // Only ids actually offered to the model can ever be cited.
    const snippetIndex = new Map(
      groups.flatMap((group) => group.snippets).map((s) => [s.chunkId, s]),
    )
    const existing = await this.questions.listByIds(quiz.questionIds)
    let current: Quiz = quiz
    const total = quiz.bank ? quiz.bank.plan.length : quiz.config.count
    const toInput = (question: GeneratedQuizQuestion, entry: PlanEntry, i: number) => {
      const group = groups[entry.group ?? 0]
      const topicId = group?.topicId ?? topic?.id
      const fallbackPoint =
        group?.knowledgePoints[0] ??
        resume.knowledgePoints[i % Math.max(1, resume.knowledgePoints.length)]
      return {
        projectId: quiz.projectId,
        ...(topicId ? { topicId } : {}),
        knowledgePoint:
          question.knowledgePoint ||
          fallbackPoint ||
          topic?.name ||
          quiz.config.topicName ||
          'General',
        // The question's own (validated) type: a dropped question must never
        // shift the types of the ones after it.
        type: question.type,
        difficulty: entry.difficulty,
        prompt: question.prompt,
        // Models put the answer first; the order the student sees is random.
        // A final "None of the options are correct" choice stays last.
        ...(question.options ? { options: shuffledOptions(question.options) } : {}),
        correctAnswer: question.correctAnswer,
        ...(question.unit ? { unit: question.unit } : {}),
        ...(question.sigFigs
          ? {
              sigFigs: question.sigFigs,
              ...(question.sigFigsBasis ? { sigFigsBasis: question.sigFigsBasis } : {}),
            }
          : {}),
        ...(question.vector ? { vector: question.vector } : {}),
        ...(question.nomenclature ? { nomenclature: question.nomenclature } : {}),
        ...(question.forces ? { forces: question.forces } : {}),
        ...(question.market ? { market: question.market } : {}),
        ...(question.rubric?.length
          ? {
              rubric: question.rubric.map((text, index) => ({ id: `p${index + 1}`, text })),
              // Written by the quiz generator, not the professor.
              rubricSource: 'platform' as const,
            }
          : {}),
        ...(question.orderItems?.length ? { orderItems: question.orderItems } : {}),
        ...(question.matchItems?.length ? { matchItems: question.matchItems } : {}),
        ...(question.blanks?.length ? { blanks: question.blanks } : {}),
        ...(question.gender ? { gender: question.gender } : {}),
        ...(question.paradigm ? { paradigm: question.paradigm } : {}),
        ...(question.solution ? { solution: question.solution } : {}),
        hints: question.hints ?? [],
        // An exam topic without course material has no source to cite.
        sourceRefs: group?.aiOnly
          ? []
          : resolveSourceReferences(question.sourceChunkId, question.quote, snippetIndex),
        ...(group?.aiOnly ? { origin: 'ai_without_source' as const } : {}),
        promptVersion: prompts.quizGenerator.VERSION,
      }
    }

    const outcome = await this.generateInBatches(
      resume.pending.map((entry) => ({ ...entry })),
      groups,
      {
        topicName: resume.topicName,
        topicDescription: resume.topicDescription,
        language: resume.language,
        ...(resume.professorStyleContext
          ? { professorStyleContext: resume.professorStyleContext }
          : {}),
        ...(resume.professorHabits ? { professorHabits: resume.professorHabits } : {}),
        ...(resume.professorConventions?.length
          ? { professorConventions: resume.professorConventions as ProfessorConvention[] }
          : {}),
        ...(resume.noneOptionLabel ? { noneOptionLabel: resume.noneOptionLabel } : {}),
      },
      subject,
      control,
      existing.map((question) => question.prompt),
      async (delivered, pending) => {
        const stored = await this.questions.addMany(
          delivered.map(({ question, entry }, i) =>
            toInput(question, entry, current.questionIds.length + i),
          ),
        )
        const latest = current.resume!
        current = {
          ...current,
          questionIds: [...current.questionIds, ...stored.map((q) => q.id)],
          resume: {
            ...latest,
            pending: pending.map(toResumeSlot),
            questionSlots: [...latest.questionSlots, ...delivered.map(({ entry }) => entry.slot)],
            updatedAt: Date.now(),
          },
        }
        await this.quizzes.upsert(current)
        onProgress?.(
          'generating',
          30 + Math.round((50 * Math.min(total, current.questionIds.length)) / Math.max(1, total)),
        )
      },
    )

    if (outcome.paused) {
      const paused: Quiz = {
        ...current,
        status: 'paused',
        resume: {
          ...current.resume!,
          pending: outcome.pending.map(toResumeSlot),
          updatedAt: Date.now(),
        },
      }
      await this.quizzes.upsert(paused)
      logger.info('Quiz generation paused', {
        quizId: paused.id,
        generated: paused.questionIds.length,
        pending: outcome.pending.length,
      })
      return paused
    }
    if (current.questionIds.length === 0) {
      throw outcome.lastError ?? new AppError(t('errors.noUsableQuestions'), 'MALFORMED_QUIZ')
    }

    onProgress?.('storing', 80)
    if (current.bank) return this.readyBank(current, resume.topicName, onProgress)
    // Keep the plan's order (difficulty ramps up through an adaptive quiz).
    const slots = current.resume!.questionSlots
    const ordered = current.questionIds
      .map((id, i) => ({ id, slot: slots[i] ?? i }))
      .sort((a, b) => a.slot - b.slot)
      .map(({ id }) => id)
    const { resume: _finished, errorMessage: _error, ...rest } = current
    void _finished
    void _error
    const ready: Quiz = {
      ...rest,
      // The title states how many questions there really are.
      title: t('quiz.topicTitle', { topic: resume.topicName, count: ordered.length }),
      questionIds: ordered,
      status: 'ready',
    }
    if (ordered.length < quiz.config.count) {
      logger.warn('Quiz has fewer questions than requested', {
        quizId: quiz.id,
        requested: quiz.config.count,
        generated: ordered.length,
      })
    }
    await this.quizzes.upsert(ready)
    onProgress?.('done', 100)
    logger.info('Quiz generated', { quizId: ready.id, count: ordered.length })
    return ready
  }

  /**
   * A generated bank becomes takeable: every bank question is recorded in
   * `bank.entries` and only the first one (the starting level of slot 0) is
   * served. The quiz is as long as configured, or as the bank if shorter.
   */
  private async readyBank(
    current: Quiz,
    topicName: string,
    onProgress?: (stage: string, progress: number) => void,
  ): Promise<Quiz> {
    const bank = current.bank!
    const slots = current.resume?.questionSlots ?? []
    const entries: QuizBankEntry[] = current.questionIds
      .map((questionId, i) => {
        const planned = bank.plan[slots[i] ?? i] ?? { slot: i, difficulty: bank.start }
        return { questionId, slot: planned.slot, difficulty: planned.difficulty }
      })
      .sort(
        (a, b) =>
          a.slot - b.slot ||
          DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty),
      )
    const questions = await this.questions.listByIds(entries.map((entry) => entry.questionId))
    const first = selectNextBankQuestion({
      candidates: bankCandidates(entries, questions),
      served: new Set(),
      slot: 0,
      target: bank.start,
    })
    if (!first) throw new AppError(t('errors.noUsableQuestions'), 'MALFORMED_QUIZ')
    const length = Math.min(current.config.count, entries.length)
    const { resume: _finished, errorMessage: _error, ...rest } = current
    void _finished
    void _error
    const ready: Quiz = {
      ...rest,
      title: t('quiz.topicTitle', { topic: topicName, count: length }),
      questionIds: [first.questionId],
      difficultyPlan: [first.difficulty],
      status: 'ready',
      bank: { ...bank, entries, length },
    }
    await this.quizzes.upsert(ready)
    onProgress?.('done', 100)
    logger.info('Quiz bank generated', { quizId: ready.id, bank: entries.length, length })
    return ready
  }

  /**
   * After every served question of a bank quiz has an answer, serve the next
   * one at `target` (see `selectNextBankQuestion`). Nothing is served while a
   * served question is still open, once the quiz length is reached, or when
   * the bank is used up.
   */
  private async serveNextFromBank(
    quiz: Quiz,
    history: QuestionAttempt[],
    target: DifficultyLevel,
    previousKnowledgePoint?: string,
  ): Promise<{ quiz: Quiz; question: Question | null }> {
    const bank = quiz.bank
    if (!bank || bank.entries.length === 0) return { quiz, question: null }
    const answered = new Set(history.map((attempt) => attempt.questionId))
    if (
      quiz.questionIds.length >= bank.length ||
      !quiz.questionIds.every((id) => answered.has(id))
    ) {
      return { quiz, question: null }
    }
    const questions = await this.questions.listByIds(bank.entries.map((entry) => entry.questionId))
    const pick = selectNextBankQuestion({
      candidates: bankCandidates(bank.entries, questions),
      served: new Set(quiz.questionIds),
      slot: quiz.questionIds.length,
      target,
      ...(previousKnowledgePoint !== undefined ? { previousKnowledgePoint } : {}),
    })
    if (!pick) return { quiz, question: null }
    const next: Quiz = {
      ...quiz,
      questionIds: [...quiz.questionIds, pick.questionId],
      difficultyPlan: [...quiz.difficultyPlan, pick.difficulty],
    }
    await this.quizzes.upsert(next)
    return { quiz: next, question: questions.find((q) => q.id === pick.questionId) ?? null }
  }

  /**
   * Reopening a bank quiz whose served questions are all answered (the tab
   * closed between an answer and serving the next one): serve the next one
   * as the answer would have. Any other quiz is returned unchanged.
   */
  async resumeQuestionBank(quizId: string): Promise<Quiz> {
    const quiz = await this.getQuiz(quizId)
    if (!quiz.bank?.entries.length || quiz.status === 'completed') return quiz
    const lastId = quiz.questionIds[quiz.questionIds.length - 1]
    const last = lastId ? await this.questions.get(lastId) : undefined
    if (!last) return quiz
    const history = await this.attempts.listByQuiz(quizId)
    if (!history.some((attempt) => attempt.questionId === last.id)) return quiz
    const decision = await this.nextDifficultyFor(quiz, history, last)
    return (await this.serveNextFromBank(quiz, history, decision.difficulty, last.knowledgePoint))
      .quiz
  }

  /** The adaptive model's decision after `question` (disputed answers move nothing). */
  private async nextDifficultyFor(quiz: Quiz, history: QuestionAttempt[], question: Question) {
    const { recentResults, streaks } = adaptiveHistory(history)
    const masteryRow = await this.mastery.get(quiz.projectId, question.knowledgePoint)
    return decideNextDifficulty({
      currentDifficulty: question.difficulty,
      recentResults,
      consecutiveCorrect: streaks.consecutiveCorrect,
      consecutiveWrong: streaks.consecutiveWrong,
      knowledgePointMastery: masteryRow?.mastery ?? 0,
    })
  }

  /**
   * Generate the plan in batches of `QUIZ_BATCH_SIZE`, each with room for its
   * output and its own share of the source passages, then ask again for
   * whatever a batch did not deliver. Each question is matched to the plan
   * entry of its own type, so a dropped question leaves a gap to top up
   * instead of shifting the plan.
   *
   * `onBatch` stores a batch's questions as soon as they exist, with the slots
   * still to generate. The control is checked before every batch: on a pause
   * (or an aborted batch) the remaining slots are returned as `pending`.
   */
  private async generateInBatches(
    plan: PlanEntry[],
    groups: QuizGroup[],
    context: Omit<
      Parameters<typeof prompts.quizGenerator.buildUserPrompt>[0],
      'plan' | 'sourceSnippets' | 'knowledgePoints'
    >,
    subject: SubjectInput,
    control: GenerationControl,
    alreadyAsked: string[],
    onBatch: (
      delivered: Array<{ question: GeneratedQuizQuestion; entry: PlanEntry }>,
      pending: PlanEntry[],
    ) => Promise<void>,
  ): Promise<{ paused: boolean; pending: PlanEntry[]; lastError: unknown }> {
    const asked = [...alreadyAsked]
    const allowedTypes = new Set(plan.map((entry) => entry.type))
    // One system prompt for every batch, top-up and retry of this quiz.
    const types = [...allowedTypes].sort()
    let pending = [...plan]
    let lastError: unknown = null

    // Economics graph questions are built locally when the topic names a
    // scenario (tax, ceiling, shifts …): the market, the template stem and
    // every answer come from the engine — no AI request, nothing to trust.
    // A graph slot whose topic names none goes to the AI (quiz-generator v10).
    const local: Array<{ question: GeneratedQuizQuestion; entry: PlanEntry }> = []
    for (const entry of pending) {
      if (!isMarketQuestionType(entry.type)) continue
      if (!control.shouldContinue()) return { paused: true, pending, lastError }
      const group = groups[entry.group ?? 0]
      const families = familiesForTopic(
        [context.topicName, ...(group?.knowledgePoints ?? [])].join(' '),
      )
      if (!families) continue
      const built = generateMarketQuestion({
        kind: entry.type,
        families,
        rng: createRng(`${context.topicName}:${entry.slot}:${asked.length}:${Math.random()}`),
        language: marketLanguage(context.language),
      })
      local.push({
        entry,
        question: {
          prompt: built.stem,
          type: entry.type,
          correctAnswer: built.answer,
          solution: built.solution,
          knowledgePoint: group?.knowledgePoints[0] ?? '',
          difficulty: entry.difficulty,
          hints: [],
          market: built.question,
        },
      })
    }
    if (local.length > 0) {
      const done = new Set(local.map((item) => item.entry))
      pending = pending.filter((entry) => !done.has(entry))
      asked.push(...local.map((item) => item.question.prompt))
      await onBatch(local, pending)
    }
    if (pending.length === 0) return { paused: false, pending, lastError }

    // Top-up rounds share the passages out like the first round did, instead
    // of sending every passage for a question or two.
    let shares = 0
    for (let round = 0; round <= MAX_TOP_UP_ROUNDS && pending.length > 0; round++) {
      const batches: PlanEntry[][] = []
      for (let i = 0; i < pending.length; i += QUIZ_BATCH_SIZE)
        batches.push(pending.slice(i, i + QUIZ_BATCH_SIZE))
      if (round === 0) shares = batches.length
      const missing: PlanEntry[] = []
      const remaining = (from: number): PlanEntry[] => [...missing, ...batches.slice(from).flat()]
      for (const [index, batch] of batches.entries()) {
        if (!control.shouldContinue()) return { paused: true, pending: remaining(index), lastError }
        const shareCount = Math.max(shares, batches.length)
        const { knowledgePoints, snippets } = this.batchMaterial(
          batch,
          groups,
          index % shareCount,
          shareCount,
        )
        const delivered: Array<{ question: GeneratedQuizQuestion; entry: PlanEntry }> = []
        try {
          const questions = await this.generateWithRetry(
            {
              ...context,
              knowledgePoints,
              plan: batch,
              sourceSnippets: snippets,
              ...(asked.length > 0 ? { avoidRepeating: avoidRepeatingList(asked) } : {}),
            },
            subject,
            types,
            control.signal,
          )
          const open = [...batch]
          for (const question of questions) {
            // Its own type's slot first; a question of another type the quiz
            // asked for still fills a gap (keeping its own type). A type that
            // was never requested is dropped.
            let at = open.findIndex((entry) => entry.type === question.type)
            if (at < 0 && allowedTypes.has(question.type)) at = open.length > 0 ? 0 : -1
            if (at < 0) continue
            delivered.push({ question, entry: open.splice(at, 1)[0]! })
          }
          missing.push(...open)
        } catch (err) {
          // A stop aborts the batch: an interruption, never a failure.
          if (isAbortError(err, control.signal)) {
            return { paused: true, pending: remaining(index), lastError }
          }
          // Already retried inside `generateWithRetry`; top-up rounds only ask
          // for questions a successful request left out.
          lastError = err
        }
        if (delivered.length > 0) {
          asked.push(...delivered.map((d) => d.question.prompt))
          await onBatch(delivered, remaining(index + 1))
        }
      }
      pending = missing
    }
    return { paused: false, pending, lastError }
  }

  /**
   * What one batch is given. A single group (a topic quiz) shares its
   * passages out over the batches; in a mixed review each batch gets exactly
   * the topics its questions belong to.
   */
  private batchMaterial(
    batch: PlanEntry[],
    groups: QuizGroup[],
    index: number,
    batchCount: number,
  ): { knowledgePoints: string[]; snippets: string[] } {
    if (groups.length <= 1) {
      const only = groups[0] ?? { knowledgePoints: [], snippets: [] }
      const all = only.snippets
      const share =
        all.length >= batchCount * 4 ? all.filter((_, i) => i % batchCount === index) : all
      return { knowledgePoints: only.knowledgePoints, snippets: share.map(formatSnippetForPrompt) }
    }
    const used = [...new Set(batch.map((entry) => entry.group ?? 0))]
      .map((g) => groups[g]!)
      .filter(Boolean)
    const seen = new Set<string>()
    const snippets = used
      .flatMap((group) => group.snippets)
      .filter((snippet) => !seen.has(snippet.chunkId) && seen.add(snippet.chunkId))
    return {
      knowledgePoints: [...new Set(used.flatMap((group) => group.knowledgePoints))],
      snippets: snippets.map(formatSnippetForPrompt),
    }
  }

  /**
   * The parts a quiz is generated from. A mixed review over a course with
   * several topics gets one group per topic — every topic when they fit in the
   * question count, otherwise a random selection — so it cannot settle on one
   * topic. Every other quiz is a single group.
   */
  private async planGroups(
    projectId: string,
    config: QuizConfig,
    candidates: SourceSnippet[],
    knowledgePoints: string[],
    topic: Awaited<ReturnType<CourseAnalysisRepository['getTopic']>>,
    /** Questions to generate (a bank holds more than the quiz length). */
    generated: number = config.count,
  ): Promise<QuizGroup[]> {
    if (config.examScope) return this.planExamGroups(projectId, config, candidates)
    const single = (): QuizGroup[] => [
      {
        ...(topic ? { topicId: topic.id } : {}),
        knowledgePoints,
        snippets: pickQuizSnippets(candidates, {
          ...(topic?.sourceChunkIds?.length ? { preferChunkIds: topic.sourceChunkIds } : {}),
          keywords: knowledgePoints,
          limit: Math.min(MAX_QUIZ_SNIPPETS, Math.max(MIN_QUIZ_SNIPPETS, generated + 3)),
        }),
      },
    ]
    if (config.mode !== 'mixed' || config.topicId || config.focusKnowledgePoints?.length)
      return single()
    const topics = await this.analyses.listTopics(projectId)
    if (topics.length < 2) return single()
    const chosen =
      topics.length <= config.count
        ? topics
        : shuffled(topics)
            .slice(0, config.count)
            .sort((a, b) => a.order - b.order)
    const concepts = await this.analyses.listConcepts(projectId)
    return chosen.map((each) => {
      const points = concepts
        .filter((concept) => concept.topicIds.includes(each.id))
        .map((concept) => concept.name)
        .slice(0, POINTS_PER_TOPIC)
      const keywords = points.length > 0 ? points : [each.name]
      return {
        topicId: each.id,
        knowledgePoints: keywords,
        snippets: pickQuizSnippets(candidates, {
          ...(each.sourceChunkIds?.length ? { preferChunkIds: each.sourceChunkIds } : {}),
          keywords: [each.name, ...keywords],
          limit: SNIPPETS_PER_TOPIC,
          // A topic's passages only; never filler from elsewhere in the book.
          fill: false,
        }),
      }
    })
  }

  /**
   * Groups for a quiz over a syllabus exam scope (or one exam topic of it).
   * A matched exam topic is quizzed from its course topics' passages and
   * knowledge points; an unmatched one — only when the student opted in — is
   * a group with no passages whose questions carry no course source.
   */
  private async planExamGroups(
    projectId: string,
    config: QuizConfig,
    candidates: SourceSnippet[],
  ): Promise<QuizGroup[]> {
    const selection = config.examScope!
    const document = await new DocumentRepository(this.db)
      .get(selection.documentId)
      .catch(() => undefined)
    if (!document || document.projectId !== projectId || !document.syllabus) {
      throw new AppError(t('syllabus.errors.notFound'), 'NOT_FOUND')
    }
    const topics = await this.analyses.listTopics(projectId)
    const byId = new Map(topics.map((each) => [each.id, each]))
    const entries = planExamScopeEntries(
      examTopicsFor(document.syllabus.scopes, selection),
      new Set(byId.keys()),
      { includeUnmatched: selection.includeUnmatched, count: config.count },
    )
    if (entries.length === 0) {
      throw new AppError(t('syllabus.errors.nothingToQuiz'), 'EXAM_SCOPE_EMPTY')
    }
    const concepts = await this.analyses.listConcepts(projectId)
    return entries.map((entry): QuizGroup => {
      if (entry.kind === 'unmatched') {
        return { knowledgePoints: [entry.text], snippets: [], aiOnly: true }
      }
      const matched = entry.topicIds.map((id) => byId.get(id)!)
      const points = concepts
        .filter((concept) => concept.topicIds.some((id) => entry.topicIds.includes(id)))
        .map((concept) => concept.name)
        .slice(0, POINTS_PER_TOPIC)
      const keywords = points.length > 0 ? points : matched.map((each) => each.name)
      return {
        topicId: matched[0]!.id,
        knowledgePoints: keywords,
        snippets: pickQuizSnippets(candidates, {
          preferChunkIds: matched.flatMap((each) => each.sourceChunkIds ?? []),
          keywords: [...matched.map((each) => each.name), ...keywords],
          limit: SNIPPETS_PER_TOPIC,
          fill: false,
        }),
      }
    })
  }

  private async generateWithRetry(
    input: Parameters<typeof prompts.quizGenerator.buildUserPrompt>[0],
    subject: SubjectInput,
    /** Every type the quiz plans: the system prompt describes only these. */
    types: QuestionType[],
    signal?: AbortSignal,
  ): Promise<GeneratedQuizQuestion[]> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(
          prompts.quizGenerator.buildSystemPrompt({
            ...drillPromptOptions(subject),
            ...conventionPromptOptions(subject, input.professorConventions),
            types,
          }),
          subject,
        ),
      },
      { role: 'user', content: prompts.quizGenerator.buildUserPrompt(input) },
    ]
    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        // Sent at the output cap (AIService): a cut-off response is rejected
        // as a whole, so the batch never starts with less room.
        const { data } = await this.ai.chatJSON<QuizGenerationOutput>(
          messages,
          signal ? { signal } : {},
        )
        const questions = this.validateGenerated(data, input.plan.length, {
          sourceText: input.sourceSnippets.join('\n\n'),
        })
        return questions
      } catch (err) {
        // A stopped request is not retried and not reported as a failure.
        if (isAbortError(err, signal)) throw err
        lastError = err
        logger.warn('Quiz generation attempt failed', { attempt, error: (err as Error)?.message })
        // Out of the whole output cap: the same request would end the same way.
        if (exhaustedOutputCap(err)) break
      }
    }
    throw new AppError(
      t('errors.invalidQuiz', {
        reason: lastError instanceof Error ? lastError.message : 'unknown error',
      }),
      'QUIZ_GENERATION_FAILED',
    )
  }

  /** Defensive validation of AI output — never trust the shape blindly. */
  validateGenerated(
    data: QuizGenerationOutput,
    expected: number,
    context: {
      /**
       * The source passages the questions were generated from. Language
       * drills must copy their nouns and forms from it; without it they are
       * dropped.
       */
      sourceText?: string
    } = {},
  ): GeneratedQuizQuestion[] {
    if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) {
      throw new AppError(t('errors.quizMissingArray'), 'MALFORMED_QUIZ')
    }
    const source = context.sourceText ? normalizeForSource(context.sourceText) : ''
    const valid: GeneratedQuizQuestion[] = []
    for (const raw of data.questions) {
      if (!raw || typeof raw !== 'object') continue
      const q = raw as Partial<GeneratedQuizQuestion>
      if (typeof q.prompt !== 'string' || q.prompt.trim().length === 0) continue
      const type = (q.type ?? DEFAULT_QUESTION_TYPE) as QuestionType
      // Reject anything outside the supported quiz types.
      if (!QUESTION_TYPES.includes(type)) continue
      // X / B / fill-blank answers are rebuilt from their structure below, so
      // a missing `correctAnswer` does not disqualify them.
      const rebuilt =
        type === 'multiple_select' ||
        type === 'matching' ||
        type === 'fill_blank' ||
        type === 'article_gender' ||
        type === 'paradigm_table' ||
        type === 'vector' ||
        type === 'nomenclature' ||
        type === 'force_list' ||
        isMarketQuestionType(type)
      let rawAnswer = typeof q.correctAnswer === 'string' ? q.correctAnswer.trim() : ''
      // True/false answers arrive as "正确", "×", JSON booleans…; the grader
      // compares "true"/"false", so anything unreadable is dropped.
      if (type === 'true_false') {
        const truth = parseTrueFalse(q.correctAnswer as unknown)
        if (truth === null) continue
        rawAnswer = truth ? 'true' : 'false'
      }
      if (!rawAnswer && !rebuilt) continue

      let correctAnswer = rawAnswer
      let options: Array<{ label: string; isCorrect: boolean }> | undefined
      if (type === 'multiple_choice') {
        const parsed = normalizeChoiceOptions(q.options)
        if (!parsed) continue
        // A giveaway answer is dropped; the batch tops the gap up.
        // (A correct final "None of the options are correct" is long by nature.)
        const noneIsAnswer = parsed.some((o) => o.isCorrect && isNoneOption(o.label))
        if (!noneIsAnswer && answerStandsOut(parsed.filter((o) => !isNoneOption(o.label)))) {
          logger.debug('Dropped a choice question whose answer stands out by length')
          continue
        }
        options = parsed
        // The stored answer is the option flagged correct (exactly one, see
        // normalizeChoiceOptions). When the model's answer text names a
        // *different* option, the two disagree and the question is dropped
        // rather than guessing which one is right.
        const flagged = parsed.find((o) => o.isCorrect)
        if (!flagged) continue
        if (
          correctAnswer &&
          correctAnswer !== flagged.label &&
          parsed.some((o) => o.label === correctAnswer)
        ) {
          logger.debug('Dropped a choice question whose answer text and flagged option disagree')
          continue
        }
        correctAnswer = flagged.label
      }

      // Numeric: a unit is kept only when it is a real, convertible unit and
      // the value is a plain number in it; otherwise grading stays unit-free.
      let unit: string | undefined
      if (type === 'numeric' && typeof q.unit === 'string' && q.unit.trim()) {
        const candidate = q.unit.trim()
        if (isValidUnit(candidate) && Number.isFinite(Number(correctAnswer))) unit = candidate
      }
      // Significant figures: an integer 1–10 on a numeric answer; the stored
      // reference is written with exactly that many (1500 → 1.50e+3).
      let sigFigs: number | undefined
      let sigFigsBasis: SigFigBasis | undefined
      if (type === 'numeric') {
        sigFigs = asSigFigCount(q.sigFigs)
        const value = Number(correctAnswer)
        if (sigFigs && Number.isFinite(value) && value !== 0) {
          correctAnswer = String(value.toPrecision(sigFigs)).replace('e+', 'e')
          sigFigsBasis = q.sigFigsBasis === 'stated' ? 'stated' : 'data'
        } else sigFigs = undefined
      }
      // Vector: 2 or 3 numeric components and an optional valid unit.
      let vector: VectorSpec | undefined
      if (type === 'vector') {
        const components = asVectorComponents(q.components)
        const unitText = typeof q.unit === 'string' ? q.unit.trim() : ''
        if (!components || (unitText && !isValidUnit(unitText))) continue
        if (components.every((value) => value === 0)) continue
        vector = { components, ...(unitText ? { unit: unitText } : {}) }
        correctAnswer = formatVectorSpec(vector)
      }
      // Nomenclature: the formula must parse; the asked-for side must not be
      // printed in the prompt.
      let nomenclature: NomenclatureSpec | undefined
      if (type === 'nomenclature') {
        const direction =
          q.direction === 'formula_to_name' || q.direction === 'name_to_formula'
            ? q.direction
            : null
        const formula =
          typeof q.formula === 'string' ? q.formula.replace(/\\ce\{([^}]*)\}/g, '$1').trim() : ''
        const names = (Array.isArray(q.names) ? q.names : [])
          .filter((name): name is string => typeof name === 'string')
          .map((name) => name.replace(/\s+/g, ' ').trim())
          .filter((name) => name && name.length <= 120)
          .slice(0, 6)
        if (!direction || !formula || names.length === 0 || !parseFormulaAnswer(formula)) continue
        const giveaway =
          direction === 'formula_to_name'
            ? normalizeChemicalName(q.prompt).includes(normalizeChemicalName(names[0]!))
            : compactFormula(q.prompt).includes(compactFormula(formula))
        if (giveaway) {
          logger.debug('Dropped a nomenclature question that shows its answer')
          continue
        }
        nomenclature = { direction, formula, names }
        correctAnswer = direction === 'name_to_formula' ? formula : names[0]!
      }
      // Free-body diagram: 1–8 forces of known types with finite directions.
      let forces: ForceSpec[] | undefined
      if (type === 'force_list') {
        const raw = Array.isArray(q.forces) ? q.forces : []
        forces = raw.flatMap((force) => {
          const angle = Number(force?.angle)
          const magnitude = force?.magnitude == null ? undefined : Number(force.magnitude)
          if (!isForceType(force?.type) || !Number.isFinite(angle)) return []
          return [
            {
              type: force.type,
              angle: ((angle % 360) + 360) % 360,
              ...(magnitude !== undefined && Number.isFinite(magnitude) && magnitude >= 0
                ? { magnitude }
                : {}),
            },
          ]
        })
        if (forces.length === 0 || forces.length > 8 || forces.length !== raw.length) continue
        correctAnswer = formatForces(forces)
      }
      // Economics graph question: the market must parse and solve, what it
      // asks must apply, and the answer is the engine's (the model's stated
      // answer is checked and replaced when it disagrees).
      let market: MarketQuestion | undefined
      let marketSolution: string | undefined
      if (isMarketQuestionType(type)) {
        const verified = verifyMarketCheck(
          {
            prompt: q.prompt,
            answer: rawAnswer,
            solution: typeof q.solution === 'string' ? q.solution : '',
          },
          {
            kind: type,
            market: (raw as Partial<RawGeneratedQuizQuestion>).market,
            target: (raw as Partial<RawGeneratedQuizQuestion>).target,
            draw: (raw as Partial<RawGeneratedQuizQuestion>).draw,
          },
          marketLanguage(/[一-鿿]/.test(q.prompt) ? 'zh' : 'en'),
        )
        if (!verified.ok) {
          logger.debug('Dropped a graph question the market engine rejects', {
            reason: verified.reason,
          })
          continue
        }
        if (verified.corrected)
          logger.debug('Corrected a graph question answer to the engine value')
        market = verified.question
        correctAnswer = verified.answer
        marketSolution = verified.solution
      }
      // A short answer is scored by its points, so it needs 2–6 distinct
      // ones; with fewer it cannot be graded fairly and is dropped.
      let rubric: string[] | undefined
      if (type === 'short_answer') {
        const seen = new Set<string>()
        rubric = (Array.isArray(q.rubric) ? q.rubric : [])
          .filter((point): point is string => typeof point === 'string')
          .map((point) => point.trim().slice(0, MAX_RUBRIC_POINT_LENGTH))
          .filter((point) => {
            const key = point.toLowerCase()
            if (!point || seen.has(key)) return false
            seen.add(key)
            return true
          })
          .slice(0, MAX_RUBRIC_POINTS)
        if (rubric.length < MIN_RUBRIC_POINTS) continue
      }
      // A chemical equation is only kept when the reference itself parses and
      // balances; otherwise the grader would mark correct answers wrong.
      if (type === 'chem_equation') {
        const reference = parseEquation(correctAnswer)
        if (!reference.ok || imbalances(reference.equation).length > 0) continue
      }
      // Ordering: 3–8 distinct single-line items; the answer is rebuilt from
      // them so the two can never disagree.
      let orderItems: string[] | undefined
      if (type === 'ordering') {
        const seen = new Set<string>()
        orderItems = (Array.isArray(q.orderItems) ? q.orderItems : [])
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, 160))
          .filter((item) => {
            if (!item || seen.has(item)) return false
            seen.add(item)
            return true
          })
        if (orderItems.length < 3 || orderItems.length > 8) continue
        correctAnswer = orderItems.join('\n')
      }
      // X-type: 4–6 distinct options, at least two correct; the answer text
      // is rebuilt from the flagged options.
      if (type === 'multiple_select') {
        const parsed = normalizeOptionSet(q.options)
        if (!parsed || parsed.length < 4 || parsed.filter((o) => o.isCorrect).length < 2) continue
        options = parsed
        correctAnswer = parsed
          .filter((o) => o.isCorrect)
          .map((o) => o.label)
          .join(' | ')
      }
      // B-type: shared options, 2–5 stems, one valid option index per stem.
      let matchItems: string[] | undefined
      if (type === 'matching') {
        const parsed = normalizeOptionSet(q.options)
        const stems = (Array.isArray(q.matchItems) ? q.matchItems : [])
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, 200))
          .filter(Boolean)
        const answers = Array.isArray(q.matchAnswers) ? q.matchAnswers : []
        if (
          !parsed ||
          parsed.length < 3 ||
          stems.length < 2 ||
          stems.length > 5 ||
          answers.length !== stems.length
        )
          continue
        if (answers.some((a) => !Number.isInteger(a) || a < 0 || a >= parsed.length)) continue
        options = parsed.map((o) => ({ label: o.label, isCorrect: false }))
        matchItems = stems
        correctAnswer = answers.map((a) => parsed[a]!.label).join(' | ')
      }
      // Fill-blank: one accepted-answer list per ____ in the prompt.
      let blanks: string[][] | undefined
      if (type === 'fill_blank') {
        const count = (q.prompt.match(/_{3,}/g) ?? []).length
        blanks = (Array.isArray(q.blanks) ? q.blanks : []).map((list) =>
          (Array.isArray(list) ? list : [])
            .filter((answer): answer is string => typeof answer === 'string')
            .map((answer) => answer.trim().slice(0, 60))
            .filter((answer) => answer && !answer.includes('\n'))
            .slice(0, 6),
        )
        if (
          count < 1 ||
          count > 4 ||
          blanks.length !== count ||
          blanks.some((list) => list.length === 0)
        )
          continue
        correctAnswer = blanks.map((list) => list[0]!).join(' | ')
      }
      // Language drills: the noun / forms must be copied from the source and
      // the structure consistent; the answer is rebuilt from the checked data.
      let gender: GenderNoun | undefined
      if (type === 'article_gender') {
        const checked = source ? validateArticleQuestion(q, source) : null
        if (!checked) {
          logger.debug('Dropped an article question not grounded in the source')
          continue
        }
        gender = checked
        correctAnswer = genderAnswerText(checked)
      }
      let paradigm: ParadigmTable | undefined
      if (type === 'paradigm_table') {
        const checked = source ? validateParadigmTable(q.table, source) : null
        if (!checked) {
          logger.debug('Dropped a paradigm table that is inconsistent or not in the source')
          continue
        }
        paradigm = checked
        correctAnswer = paradigmAnswerText(checked)
      }
      // Code output needs the program in the prompt; without it the question
      // cannot be answered, so it is dropped.
      if (type === 'code_output') {
        if (!/```/.test(q.prompt)) continue
        // The untrimmed text: leading spaces on the first line are output.
        correctAnswer = normalizeProgramOutput(q.correctAnswer as string)
        if (!correctAnswer) continue
      }

      valid.push({
        prompt: q.prompt.trim(),
        type,
        ...(options ? { options } : {}),
        correctAnswer,
        ...(unit ? { unit } : {}),
        ...(sigFigs ? { sigFigs, ...(sigFigsBasis ? { sigFigsBasis } : {}) } : {}),
        ...(vector ? { vector } : {}),
        ...(nomenclature ? { nomenclature } : {}),
        ...(forces ? { forces } : {}),
        ...(rubric ? { rubric } : {}),
        ...(orderItems ? { orderItems } : {}),
        ...(matchItems ? { matchItems } : {}),
        ...(blanks ? { blanks } : {}),
        ...(gender ? { gender } : {}),
        ...(paradigm ? { paradigm } : {}),
        ...(market ? { market } : {}),
        solution: marketSolution ?? (typeof q.solution === 'string' ? q.solution : ''),
        // Empty when the model gave none: the caller resolves it from the
        // question's group / topic, with 'General' only as the last resort.
        knowledgePoint: typeof q.knowledgePoint === 'string' ? q.knowledgePoint.trim() : '',
        difficulty: (q.difficulty ?? 'basic') as DifficultyLevel,
        hints: Array.isArray(q.hints)
          ? q.hints.filter((h): h is string => typeof h === 'string')
          : [],
        // Citation hints from the model — resolved against local chunks later.
        ...(typeof q.sourceChunkId === 'string' && q.sourceChunkId.trim()
          ? { sourceChunkId: q.sourceChunkId.trim() }
          : {}),
        ...(typeof q.quote === 'string' && q.quote.trim() ? { quote: q.quote.trim() } : {}),
      })
      if (valid.length >= expected) break
    }
    if (valid.length === 0) {
      throw new AppError(t('errors.noUsableQuestions'), 'MALFORMED_QUIZ')
    }
    return valid
  }

  private async resolveKnowledgePoints(
    projectId: string,
    config: QuizConfig,
    topicName?: string,
  ): Promise<string[]> {
    // Explicit focus wins — review sessions and "practice this mistake".
    if (config.focusKnowledgePoints?.length) {
      return config.focusKnowledgePoints.slice(0, 8)
    }
    const concepts = await this.analyses.listConcepts(projectId)
    const topicIds = config.topicId ? new Set([config.topicId]) : null
    const relevant = concepts.filter((c) =>
      topicIds ? c.topicIds.some((id) => topicIds.has(id)) : true,
    )
    const names = relevant.map((c) => c.name)
    // Up to 8 points spread over the whole list (it follows the textbook), not
    // its first few; a mixed review starts at a random place so repeated
    // reviews cover different parts.
    if (names.length > 8) {
      const offset = config.topicId ? 0 : Math.floor(Math.random() * names.length)
      return Array.from(
        { length: 8 },
        (_, i) => names[(offset + Math.floor((i * names.length) / 8)) % names.length]!,
      )
    }
    if (names.length > 0) return names
    return topicName ? [topicName] : []
  }

  async startQuiz(quizId: string): Promise<Quiz> {
    const quiz = await this.getQuiz(quizId)
    // An unfinished quiz is taken only once 「继续出题」 has completed it.
    if (quiz.status === 'paused' || quiz.status === 'generating') {
      throw new AppError(t('quiz.paused.notTakeable'), 'QUIZ_PAUSED')
    }
    // Starting again never reopens a finished quiz (its score stays).
    if (quiz.status === 'completed' || quiz.status === 'in_progress') return quiz
    const next: Quiz = { ...quiz, status: 'in_progress' }
    await this.quizzes.upsert(next)
    return next
  }

  /**
   * Submit an answer. Evaluates deterministically, records the attempt,
   * updates mastery, and returns the adjusted difficulty for the next item.
   */
  async submitAnswer(
    quizId: string,
    questionId: string,
    userAnswer: string,
    opts: {
      durationMs?: number
      hintsUsed?: number
      aiFallback?: boolean
      /**
       * A configured AI is available: grade short answers by their scoring
       * points and check unmatched fill-blank terms for exact equivalents.
       */
      gradeShortAnswer?: boolean
      /**
       * Stops the AI check. A stopped check cancels the whole submission:
       * the error is rethrown and no attempt is recorded.
       */
      signal?: AbortSignal
      /**
       * Submitted after the countdown ran out. A blank short answer then
       * scores 0 points locally (no AI call) and is labelled as timed out
       * instead of "could not be graded".
       */
      timedOut?: boolean
    } = {},
  ): Promise<SubmitAnswerResult> {
    const quiz = await this.getQuiz(quizId)
    const question = await this.questions.get(questionId)
    if (!question) throw new AppError(t('errors.questionNotFound'), 'NOT_FOUND')

    const timedOutBlank =
      opts.timedOut === true && question.type === 'short_answer' && userAnswer.trim() === ''
    let evaluation = timedOutBlank
      ? { ...tooShortEvaluation(question, ''), note: t('quiz.timedOutBlank') }
      : question.type === 'short_answer' && opts.gradeShortAnswer
        ? await new ShortAnswerGrader(this.ai).grade(
            question,
            userAnswer.trim(),
            await loadProjectSubjectContext(quiz.projectId, this.db),
            opts.signal ? { signal: opts.signal } : {},
          )
        : evaluateDeterministic(
            question,
            userAnswer,
            question.type === 'fill_blank' || question.type === 'paradigm_table'
              ? { targetLanguage: await projectTargetLanguage(quiz.projectId, this.db) }
              : question.type === 'numeric'
                ? {
                    ...(question.sigFigs
                      ? { sigFigPolicy: await projectSigFigPolicy(quiz.projectId, this.db) }
                      : {}),
                    ...(question.unit
                      ? {}
                      : { subject: await loadProjectSubject(quiz.projectId, this.db) }),
                  }
                : {},
          )
    // Blanks that did not match locally may be exact synonyms: the AI says
    // which (only when one is configured); the score stays local. A chemical
    // name (nomenclature) is checked the same way.
    if (
      (question.type === 'fill_blank' || question.type === 'nomenclature') &&
      opts.gradeShortAnswer &&
      evaluation.isCorrect === false &&
      evaluation.blanks?.length
    ) {
      evaluation = await checkBlanksWithAi(
        this.ai,
        question,
        evaluation,
        opts.signal ? { signal: opts.signal } : {},
      )
    }
    if (
      evaluation.isCorrect === null &&
      opts.aiFallback &&
      question.type !== 'short_answer' &&
      // A graph answer the engine cannot read is not guessed by the AI.
      !isMarketQuestionType(question.type)
    ) {
      evaluation = await this.evaluateWithAI(question, userAnswer, evaluation, opts.signal)
    }

    const attempt: QuestionAttempt = {
      id: crypto.randomUUID(),
      projectId: quiz.projectId,
      questionId,
      quizId,
      ...(question.topicId ? { topicId: question.topicId } : {}),
      knowledgePoint: question.knowledgePoint,
      questionType: question.type,
      difficulty: question.difficulty,
      userAnswer,
      evaluation,
      ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
      ...(timedOutBlank ? { timedOut: true } : {}),
      hintsUsed: opts.hintsUsed ?? 0,
      createdAt: Date.now(),
    }
    await this.attempts.add(attempt)
    await this.mastery.record(attempt)

    // Wrong answers flow into the mistake book automatically — and so does a
    // significant-figure slip the course rule did not deduct for.
    if ((evaluation.isCorrect === false || isSigFigOnlyError(evaluation)) && this.mistakes) {
      try {
        await this.mistakes.recordFromAttempt(attempt, question)
      } catch (err) {
        logger.warn('Failed to record mistake', { questionId, error: (err as Error)?.message })
      }
    }

    // Adaptive adjustment for the *next* question.
    const history = await this.attempts.listByQuiz(quizId)
    const decision = await this.nextDifficultyFor(quiz, history, question)

    // A bank quiz serves its next question at the decided level.
    const { quiz: served, question: nextQuestion } = await this.serveNextFromBank(
      quiz,
      history,
      decision.difficulty,
      question.knowledgePoint,
    )

    // Distinct questions, not attempts: a resumed quiz may re-answer one.
    const answered = new Set(history.map((a) => a.questionId))
    const isLastQuestion = served.questionIds.every((id) => answered.has(id))
    if (isLastQuestion) {
      await this.completeQuiz(quizId)
    }
    return {
      attempt,
      evaluation,
      nextDifficulty: decision.difficulty,
      difficultyReason: decision.reason,
      isLastQuestion,
      ...(nextQuestion ? { nextQuestion } : {}),
    }
  }

  private async evaluateWithAI(
    question: Question,
    userAnswer: string,
    fallback: QuestionEvaluation,
    signal?: AbortSignal,
  ): Promise<QuestionEvaluation> {
    try {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'You grade a single student answer. Respond with JSON: {"isCorrect": boolean, "feedback": string, "confidence": number}. Be lenient with equivalent phrasing but strict on correctness.',
        },
        {
          role: 'user',
          content: `Question: ${question.prompt}\nExpected: ${question.correctAnswer}\nStudent: ${userAnswer}`,
        },
      ]
      const { data } = await this.ai.chatJSON<{
        isCorrect: boolean
        feedback?: string
        confidence?: number
      }>(messages, signal ? { signal } : undefined)
      // A reply without a real verdict grades nothing (never a silent "wrong").
      if (typeof data?.isCorrect !== 'boolean') return fallback
      return {
        isCorrect: data.isCorrect,
        method: 'ai',
        confidence: typeof data.confidence === 'number' ? data.confidence : 0.7,
        ...(fallback.expected ? { expected: fallback.expected } : {}),
        ...(fallback.normalizedUser ? { normalizedUser: fallback.normalizedUser } : {}),
        ...(data.feedback ? { explanation: data.feedback } : {}),
        note: t('errors.judgedByAi'),
      }
    } catch (err) {
      if (isAbortError(err, signal)) throw err
      logger.warn('AI answer evaluation failed; keeping unverified', {
        error: (err as Error)?.message,
      })
      return fallback
    }
  }

  /**
   * The student disputes an AI judgement (short answers). The attempt keeps
   * its result for reference but stops counting: it leaves the score, the
   * mistake book and the knowledge point's mastery, which is rebuilt from the
   * remaining history.
   */
  async disputeAttempt(attemptId: string): Promise<QuestionAttempt> {
    const attempt = await this.attempts.get(attemptId)
    if (!attempt) throw new AppError(t('errors.questionNotFound'), 'NOT_FOUND')
    if (attempt.evaluation.disputed) return attempt
    const updated = await this.attempts.update({
      ...attempt,
      evaluation: { ...attempt.evaluation, disputed: true },
    })

    if (this.mistakes) {
      await this.mistakes.removeAttempt(attempt.projectId, attempt.questionId, attempt.id)
    }
    // Practice work on the same point counts too; a rebuild replaces the row.
    const history = [
      ...(await this.attempts.listByKnowledgePoint(attempt.projectId, attempt.knowledgePoint)),
      ...(await new PracticeService({ db: this.db }).practiceHistory(
        attempt.projectId,
        attempt.knowledgePoint,
      )),
    ]
    await this.mastery.rebuild(attempt.projectId, history)

    if (attempt.quizId) {
      const quiz = await this.quizzes.get(attempt.quizId)
      if (quiz?.status === 'completed') await this.completeQuiz(quiz.id)
    }
    return updated
  }

  async completeQuiz(quizId: string): Promise<Quiz> {
    const quiz = await this.getQuiz(quizId)
    const attempts = await this.attempts.listByQuiz(quizId)
    const score = this.computeScore(quiz, attempts)
    const completed: Quiz = {
      ...quiz,
      status: 'completed',
      score,
      finishedAt: Date.now(),
    }
    await this.quizzes.upsert(completed)
    logger.info('Quiz completed', { quizId, percentage: score.percentage })
    return completed
  }

  /** Pure scoring function — exported for tests via `scoreQuiz`. */
  computeScore(quiz: Quiz, attempts: QuestionAttempt[]): QuizScore {
    return scoreQuiz(quiz, attempts)
  }

  async getAttempts(quizId: string): Promise<QuestionAttempt[]> {
    return this.attempts.listByQuiz(quizId)
  }

  /**
   * Generate a follow-up quiz. `harder` / `easier` shift the difficulty plan;
   * `weakness` targets knowledge points with low mastery.
   */
  async generateMore(
    quizId: string,
    mode: MoreQuestionsMode,
    options: GenerateQuizOptions = {},
  ): Promise<Quiz> {
    const quiz = await this.getQuiz(quizId)
    const baseConfig = quiz.config
    let config: QuizConfig = { ...baseConfig }

    if (mode === 'harder' || mode === 'easier') {
      const base: DifficultyLevel =
        baseConfig.difficulty === 'adaptive' ? DEFAULT_DIFFICULTY : baseConfig.difficulty
      config = {
        ...baseConfig,
        difficulty: stepDifficulty(base, mode === 'harder' ? +1 : -1),
      }
    } else if (mode === 'weakness') {
      const weak = await this.mastery.weakKnowledgePoints(quiz.projectId, 0.65, 4)
      config = {
        ...baseConfig,
        mode: 'weakness',
        ...(weak[0]?.topicId ? { topicId: weak[0].topicId } : {}),
        ...(weak.length > 0 ? { focusKnowledgePoints: weak.map((w) => w.knowledgePoint) } : {}),
        topicName:
          weak.length > 0
            ? t('quizResult.followUp.weaknessLabel', {
                topic: weak.map((w) => w.knowledgePoint).join(', '),
              })
            : t('quizResult.followUp.weakness'),
      }
    }

    const generated = await this.generateQuiz(quiz.projectId, config, options)
    return generated
  }

  async deleteQuiz(quizId: string): Promise<void> {
    await this.quizzes.delete(quizId)
  }
}

/**
 * Pure scoring function. Unverified answers are tracked separately and
 * excluded from the percentage denominator so the score isn't distorted by
 * questions the system could not grade.
 */
export function scoreQuiz(quiz: Quiz, attempts: QuestionAttempt[]): QuizScore {
  const byDifficulty: Record<
    string,
    { correct: number; wrong: number; unverified: number; total: number }
  > = {}
  const byKpMap = new Map<string, QuizKnowledgeStat>()
  let correct = 0
  let wrong = 0
  let unverified = 0
  /** Graded credit: 1 per correct answer, `earned / total` for a short answer. */
  let points = 0

  // The latest attempt per question (a resumed quiz may have re-answered one),
  // whatever order the attempts arrive in.
  const attemptByQuestion = new Map<string, QuestionAttempt>()
  for (const attempt of attempts) {
    const seen = attemptByQuestion.get(attempt.questionId)
    if (!seen || seen.createdAt <= attempt.createdAt)
      attemptByQuestion.set(attempt.questionId, attempt)
  }
  /** Oral quizzes: scoring points pooled over the scored questions. */
  let rubricEarned = 0
  let rubricTotal = 0

  for (const questionId of quiz.questionIds) {
    const attempt = attemptByQuestion.get(questionId)
    const difficulty = attempt?.difficulty ?? 'unknown'
    if (!byDifficulty[difficulty]) {
      byDifficulty[difficulty] = { correct: 0, wrong: 0, unverified: 0, total: 0 }
    }
    const dStat = byDifficulty[difficulty]!
    dStat.total++

    const kp = attempt?.knowledgePoint ?? t('common.unknown')
    if (!byKpMap.has(kp)) {
      byKpMap.set(kp, {
        knowledgePoint: kp,
        correct: 0,
        wrong: 0,
        unverified: 0,
        total: 0,
        points: 0,
      })
    }
    const kStat = byKpMap.get(kp)!
    kStat.total++

    if (!attempt) {
      unverified++
      dStat.unverified++
      kStat.unverified++
      continue
    }
    const evaluation = attempt.evaluation
    const rubric = scoredOralPoints(evaluation)
    if (rubric) {
      rubricEarned += rubric.earned
      rubricTotal += rubric.total
    }
    // A disputed AI judgement is kept for reference but never scored.
    const isCorrect = evaluation.disputed ? null : evaluation.isCorrect
    if (isCorrect === true) {
      correct++
      points += 1
      kStat.points = (kStat.points ?? 0) + 1
      dStat.correct++
      kStat.correct++
    } else if (isCorrect === false) {
      wrong++
      const partial =
        evaluation.score && evaluation.score.total > 0
          ? evaluation.score.earned / evaluation.score.total
          : 0
      points += partial
      kStat.points = (kStat.points ?? 0) + partial
      dStat.wrong++
      kStat.wrong++
    } else {
      unverified++
      dStat.unverified++
      kStat.unverified++
    }
  }

  const gradable = correct + wrong
  // An oral quiz is scored like its per-topic results: a main question with
  // 8 points weighs more than a follow-up with 2. Averaging per question made
  // the headline disagree with the topic scores shown below it.
  const oral = quiz.config?.mode === 'oral'
  const percentage = oral
    ? rubricTotal > 0
      ? Math.round((rubricEarned / rubricTotal) * 100)
      : 0
    : gradable > 0
      ? Math.round((points / gradable) * 100)
      : 0

  // Per knowledge point on the same basis as the overall percentage: a short
  // answer covering 4 of 5 points counts 0.8, not 0 (it is still a mistake).
  const byKnowledgePoint = [...byKpMap.values()]
    .map((k) => ({ ...k, points: Math.round((k.points ?? 0) * 100) / 100 }))
    .sort((a, b) => (knowledgeStatPercent(a) ?? 100) - (knowledgeStatPercent(b) ?? 100))
  const weakKnowledgePoints = byKnowledgePoint
    .filter((k) => {
      const percent = knowledgeStatPercent(k)
      return percent !== null && percent < 60
    })
    .map((k) => k.knowledgePoint)

  return {
    correct,
    wrong,
    unverified,
    total: quiz.questionIds.length,
    points: Math.round(points * 100) / 100,
    percentage,
    ...(oral ? { rubricPoints: { earned: rubricEarned, total: rubricTotal } } : {}),
    byDifficulty,
    byKnowledgePoint,
    weakKnowledgePoints,
  }
}

export type { QuizDifficulty }
