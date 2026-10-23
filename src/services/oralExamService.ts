import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { QuestionRepository } from '@/entities/question/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { DocumentRepository } from '@/entities/document/repository'
import type { NewQuestionInput } from '@/entities/question/types'
import {
  ORAL_MAX_TOPICS,
  type Quiz,
  type QuizConfig,
  type QuizLanguage,
} from '@/entities/quiz/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { SubjectContext } from '@/entities/project/types'
import { examTopicsFor, planExamScopeEntries } from '@/entities/syllabus/examPlan'
import { examModeKey } from '@/entities/user/types'
import { loadCourseLanguage } from './courseLanguage'
import { prompts } from '@/infrastructure/ai/prompts'
import type { OralExamOutput } from '@/infrastructure/ai/prompts/oral-exam/v1'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { ChatMessage } from '@/infrastructure/ai/types'
import { AppError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { shuffled } from '@/shared/lib/shuffle'
import {
  isAbortError,
  resolveControl,
  type GenerationControl,
} from '@/shared/lib/generationControl'
import { t } from '@/i18n'
import { exhaustedOutputCap, type AIService } from './aiService'
import { loadProfessorHabits } from './questionHabitsService'
import { loadProjectSubjectContext } from './projectSubject'
import {
  formatSnippetForPrompt,
  loadQuizCandidates,
  pickQuizSnippets,
  type SourceSnippet,
} from './sourceContext'
import { quizLanguage, resolveSourceReferences, type GenerateQuizOptions } from './quizService'

/**
 * Oral-exam rehearsal (`QuizConfig.mode === 'oral'`).
 *
 * Draws 1–5 topics at random (from a syllabus exam scope, one exam topic, one
 * course topic, or the whole course) and asks `oral-exam/v1` for one examiner
 * question per topic with a model outline, 4–10 scoring points and up to two
 * follow-ups. Everything is stored as ordinary `short_answer` questions that
 * share `oral.group`, so attempts, grading (`ShortAnswerGrader`: points with
 * verbatim evidence, scored locally), mistakes, half-weight mastery, disputes
 * and the result page all work unchanged.
 */

export const ORAL_PROMPT_VERSION = `${prompts.oralExam.PROMPT_KIND}/${prompts.oralExam.VERSION}`

const MIN_MAIN_POINTS = 4
const MAX_MAIN_POINTS = 10
const MIN_FOLLOW_UP_POINTS = 1
const MAX_FOLLOW_UP_POINTS = 3
const MAX_FOLLOW_UPS = 2
const MAX_POINT_LENGTH = 220
const MAX_SOURCES = 3
const SNIPPETS_PER_TOPIC = 6
const POINTS_PER_TOPIC = 6
const MAX_ATTEMPTS = 2

/** One drawn topic: what it is called, which course topics teach it. */
export interface OralDraw {
  topic: string
  topicIds: string[]
  /** An exam topic the course material does not cover (opted in): no sources. */
  aiOnly: boolean
}

export interface ValidatedOralItem {
  question: string
  knowledgePoint: string
  outline: string
  rubric: string[]
  followUps: Array<{ question: string; answer: string; rubric: string[] }>
  sourceRefs: SourceReference[]
}

function text(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Trimmed, distinct (case-insensitive), non-empty points. */
function distinctPoints(value: unknown): string[] {
  const seen = new Set<string>()
  const points: string[] = []
  for (const item of Array.isArray(value) ? value : []) {
    const point = text(item, MAX_POINT_LENGTH)
    const key = point.toLowerCase()
    if (!point || seen.has(key)) continue
    seen.add(key)
    points.push(point)
  }
  return points
}

/**
 * Validate one generated oral item. The main question needs 4–10 distinct
 * points (more are cut to 10); a follow-up needs a question, a model answer
 * and 1–3 points (more are cut to 3), otherwise it is dropped (at most two
 * are kept). Sources are
 * resolved against the offered chunks only; an AI-only topic has none.
 * Returns null when the item is unusable.
 */
export function validateOralItem(
  data: OralExamOutput | null | undefined,
  snippets: Map<string, SourceSnippet>,
  options: { aiOnly: boolean; fallbackPoint: string },
): ValidatedOralItem | null {
  if (!data || typeof data !== 'object') return null
  const question = text(data.question, 600)
  const outline = text(data.outline, 6000)
  const rubric = distinctPoints(data.rubric)
  if (!question || !outline || rubric.length < MIN_MAIN_POINTS) return null

  const followUps: ValidatedOralItem['followUps'] = []
  const asked = new Set([question.toLowerCase()])
  for (const raw of Array.isArray(data.followUps) ? data.followUps : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { question?: unknown; answer?: unknown; rubric?: unknown }
    const followQuestion = text(item.question, 400)
    const answer = text(item.answer, 1500)
    const points = distinctPoints(item.rubric)
    if (!followQuestion || !answer || points.length < MIN_FOLLOW_UP_POINTS) continue
    if (asked.has(followQuestion.toLowerCase())) continue
    asked.add(followQuestion.toLowerCase())
    followUps.push({
      question: followQuestion,
      answer,
      rubric: points.slice(0, MAX_FOLLOW_UP_POINTS),
    })
    if (followUps.length === MAX_FOLLOW_UPS) break
  }

  const sourceRefs: SourceReference[] = []
  if (!options.aiOnly) {
    for (const raw of Array.isArray(data.sources) ? data.sources : []) {
      if (!raw || typeof raw !== 'object') continue
      const source = raw as { chunkId?: unknown; quote?: unknown }
      const [reference] = resolveSourceReferences(source.chunkId, source.quote, snippets)
      if (reference && !sourceRefs.some((ref) => ref.chunkId === reference.chunkId))
        sourceRefs.push(reference)
      if (sourceRefs.length === MAX_SOURCES) break
    }
  }

  return {
    question,
    knowledgePoint: text(data.knowledgePoint, 120) || options.fallbackPoint,
    outline,
    rubric: rubric.slice(0, MAX_MAIN_POINTS),
    followUps,
    sourceRefs,
  }
}

/**
 * International medicine is examined in English; otherwise the student's
 * question language. 跟随考试语言 wins over both (the exam language with
 * Chinese glosses).
 */
export function oralLanguage(
  subject: SubjectContext | undefined,
  preference: Parameters<typeof quizLanguage>[0],
  material: 'zh' | 'en' | 'mixed',
  examLanguage?: string,
): QuizLanguage {
  const exam = examModeKey(preference, examLanguage)
  if (exam) return exam
  if (subject?.subject === 'medicine' && subject.examStyle === 'international') return 'en'
  return quizLanguage(preference, material)
}

export interface OralExamServiceDeps {
  ai: AIService
  db?: AppDatabase
  questions?: QuestionRepository
  quizzes?: QuizRepository
  analyses?: CourseAnalysisRepository
  chunks?: ChunkRepository
  /** Quiz ids being generated in this tab (shared with QuizService's recovery). */
  generating?: Set<string>
}

export class OralExamService {
  private db: AppDatabase
  private questions: QuestionRepository
  private quizzes: QuizRepository
  private analyses: CourseAnalysisRepository
  private chunks: ChunkRepository
  private ai: AIService
  private generating: Set<string> | undefined

  constructor(deps: OralExamServiceDeps) {
    this.db = deps.db ?? getDb()
    this.questions = deps.questions ?? new QuestionRepository(this.db)
    this.quizzes = deps.quizzes ?? new QuizRepository(this.db)
    this.analyses = deps.analyses ?? new CourseAnalysisRepository(this.db)
    this.chunks = deps.chunks ?? new ChunkRepository(this.db)
    this.ai = deps.ai
    this.generating = deps.generating
  }

  /**
   * The topics to examine, drawn at random: from the exam scope (or its one
   * exam topic; unmatched ones only when opted in), else the chosen course
   * topic, else the course's topics.
   */
  async drawTopics(projectId: string, config: QuizConfig): Promise<OralDraw[]> {
    const count = Math.max(1, Math.min(ORAL_MAX_TOPICS, Math.round(config.count) || 1))
    const topics = await this.analyses.listTopics(projectId)
    const byId = new Map(topics.map((each) => [each.id, each]))
    if (config.examScope) {
      const selection = config.examScope
      const document = await new DocumentRepository(this.db)
        .get(selection.documentId)
        .catch(() => undefined)
      if (!document || document.projectId !== projectId || !document.syllabus) {
        throw new AppError(t('syllabus.errors.notFound'), 'NOT_FOUND')
      }
      const entries = planExamScopeEntries(
        examTopicsFor(document.syllabus.scopes, selection),
        new Set(byId.keys()),
        { includeUnmatched: selection.includeUnmatched, count: Number.MAX_SAFE_INTEGER },
      )
      if (entries.length === 0) {
        throw new AppError(t('syllabus.errors.nothingToQuiz'), 'EXAM_SCOPE_EMPTY')
      }
      return shuffled(entries)
        .slice(0, count)
        .map((entry) =>
          entry.kind === 'matched'
            ? { topic: entry.text, topicIds: entry.topicIds, aiOnly: false }
            : { topic: entry.text, topicIds: [], aiOnly: true },
        )
    }
    if (config.topicId) {
      const topic = byId.get(config.topicId)
      if (!topic) throw new AppError(t('oral.errors.noTopics'), 'NO_TOPICS')
      return [{ topic: topic.name, topicIds: [topic.id], aiOnly: false }]
    }
    // An exam's scope (考试工作台) narrows the draw to its topics.
    const wanted = new Set(config.topicIds ?? [])
    const scoped = topics.filter((each) => wanted.has(each.id))
    const pool = scoped.length > 0 ? scoped : topics
    if (pool.length === 0) throw new AppError(t('oral.errors.noTopics'), 'NO_TOPICS')
    return shuffled(pool)
      .slice(0, count)
      .map((topic) => ({ topic: topic.name, topicIds: [topic.id], aiOnly: false }))
  }

  async generate(
    projectId: string,
    config: QuizConfig,
    options: GenerateQuizOptions = {},
  ): Promise<Quiz> {
    const analysis = await this.analyses.getByProject(projectId)
    if (!analysis || analysis.status !== 'ready') {
      throw new AppError(t('errors.analysisMissing'), 'NO_ANALYSIS')
    }
    const draws = await this.drawTopics(projectId, config)
    const difficulty: DifficultyLevel =
      config.difficulty === 'adaptive' ? 'intermediate' : config.difficulty
    const label = config.examScope ? (config.topicName ?? draws[0]!.topic) : draws[0]!.topic
    const control = resolveControl(options.control, options.signal)

    const quiz: Quiz = {
      id: crypto.randomUUID(),
      projectId,
      title: t('oral.quizTitle', { topic: label, count: draws.length }),
      config: { ...config, mode: 'oral', count: draws.length },
      questionIds: [],
      status: 'generating',
      difficultyPlan: [],
      startedAt: Date.now(),
      promptVersion: ORAL_PROMPT_VERSION,
    }
    await this.quizzes.upsert(quiz)
    this.generating?.add(quiz.id)

    try {
      options.onProgress?.('collecting', 10)
      const subject = await loadProjectSubjectContext(projectId, this.db)
      const course = await loadCourseLanguage(projectId, {
        db: this.db,
        ...(config.questionLanguage ? { override: config.questionLanguage } : {}),
      })
      const language = oralLanguage(subject, course.mode, analysis.language, course.examLanguage)
      // The drawn topics are on the row from the start, so a pause (or a
      // closed tab) keeps every topic already written up.
      const withResume: Quiz = {
        ...quiz,
        oralResume: {
          remaining: draws,
          total: draws.length,
          difficulty,
          label,
          language,
          updatedAt: Date.now(),
        },
      }
      await this.quizzes.upsert(withResume)
      return await this.fill(withResume, analysis.documentIds, subject, control, options)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.quizGenerationFailed')
      const latest = (await this.quizzes.get(quiz.id)) ?? quiz
      await this.quizzes.upsert({ ...latest, status: 'failed', errorMessage: message })
      throw err
    } finally {
      this.generating?.delete(quiz.id)
    }
  }

  /** 「继续出题」 for a paused rehearsal: write up only the topics still missing. */
  async continue(quiz: Quiz, options: GenerateQuizOptions = {}): Promise<Quiz> {
    if (!quiz.oralResume) {
      throw new AppError(t('quiz.paused.interrupted'), 'QUIZ_GENERATION_FAILED')
    }
    const analysis = await this.analyses.getByProject(quiz.projectId)
    if (!analysis || analysis.status !== 'ready') {
      throw new AppError(t('errors.analysisMissing'), 'NO_ANALYSIS')
    }
    const control = resolveControl(options.control, options.signal)
    const { errorMessage: _previous, ...rest } = quiz
    void _previous
    const generating: Quiz = { ...rest, status: 'generating' }
    await this.quizzes.upsert(generating)
    this.generating?.add(quiz.id)
    try {
      options.onProgress?.('collecting', 10)
      const subject = await loadProjectSubjectContext(quiz.projectId, this.db)
      return await this.fill(generating, analysis.documentIds, subject, control, options)
    } catch (err) {
      // A failed continuation keeps the rehearsal paused with its topics.
      const latest = (await this.quizzes.get(quiz.id)) ?? quiz
      await this.quizzes.upsert({
        ...latest,
        status: 'paused',
        ...(err instanceof Error ? { errorMessage: err.message } : {}),
      })
      throw err
    } finally {
      this.generating?.delete(quiz.id)
    }
  }

  /**
   * Write up the remaining drawn topics one at a time, storing each topic's
   * questions as soon as they exist. Ends `ready`, or `paused` when the
   * control asked to stop (an aborted topic stays remaining, never failed).
   */
  private async fill(
    quiz: Quiz,
    documentIds: string[],
    subject: SubjectContext | undefined,
    control: GenerationControl,
    options: GenerateQuizOptions,
  ): Promise<Quiz> {
    const state = quiz.oralResume!
    const candidates = await loadQuizCandidates({
      documentIds,
      chunks: this.chunks,
      documents: new DocumentRepository(this.db),
    })
    const topics = new Map(
      (await this.analyses.listTopics(quiz.projectId)).map((each) => [each.id, each]),
    )
    const concepts = await this.analyses.listConcepts(quiz.projectId)
    // 教授出题习惯 (「模仿教授出题」 on and not empty); absent otherwise.
    const professorHabits = await loadProfessorHabits(quiz.projectId, this.db)

    let current = quiz
    const remaining = [...state.remaining]
    let lastError: unknown = null
    let paused = false
    while (remaining.length > 0) {
      if (!control.shouldContinue()) {
        paused = true
        break
      }
      const draw = remaining[0]!
      const done = state.total - remaining.length
      options.onProgress?.('generating', 20 + Math.round((done / Math.max(1, state.total)) * 60))
      const matched = draw.topicIds.map((id) => topics.get(id)).filter((each) => each !== undefined)
      const points = concepts
        .filter((concept) => concept.topicIds.some((id) => draw.topicIds.includes(id)))
        .map((concept) => concept.name)
        .slice(0, POINTS_PER_TOPIC)
      const snippets = draw.aiOnly
        ? []
        : pickQuizSnippets(candidates, {
            preferChunkIds: matched.flatMap((each) => each.sourceChunkIds ?? []),
            keywords: [...matched.map((each) => each.name), ...points],
            limit: SNIPPETS_PER_TOPIC,
            fill: false,
          })
      // The knowledge point the exam-topic list recognises: the matched
      // course topic's name, or the exam topic's own text.
      const knowledgePoint = matched[0]?.name ?? draw.topic
      const inputs: NewQuestionInput[] = []
      try {
        const item = await this.generateItem(
          {
            topic: draw.topic,
            courseTopics: matched.map((each) => each.name),
            knowledgePoints: points,
            sourceSnippets: snippets.map(formatSnippetForPrompt),
            language: state.language,
            ...(professorHabits ? { professorHabits } : {}),
          },
          new Map(snippets.map((snippet) => [snippet.chunkId, snippet])),
          { aiOnly: draw.aiOnly, fallbackPoint: knowledgePoint },
          subject,
          control.signal,
        )
        const group = crypto.randomUUID()
        const shared = {
          projectId: quiz.projectId,
          ...(matched[0] ? { topicId: matched[0].id } : {}),
          knowledgePoint,
          type: 'short_answer' as const,
          difficulty: state.difficulty,
          hints: [],
          sourceRefs: item.sourceRefs,
          ...(draw.aiOnly ? { origin: 'ai_without_source' as const } : {}),
          // The examiner's scoring points are written by the platform.
          rubricSource: 'platform' as const,
          promptVersion: ORAL_PROMPT_VERSION,
        }
        inputs.push({
          ...shared,
          prompt: item.question,
          correctAnswer: item.outline,
          rubric: item.rubric.map((point, i) => ({ id: `p${i + 1}`, text: point })),
          oral: { group, role: 'main', topic: draw.topic },
        })
        for (const followUp of item.followUps) {
          inputs.push({
            ...shared,
            prompt: followUp.question,
            correctAnswer: followUp.answer,
            rubric: followUp.rubric.map((point, i) => ({ id: `p${i + 1}`, text: point })),
            oral: { group, role: 'follow_up', topic: draw.topic },
          })
        }
      } catch (err) {
        // A stop aborts this topic: it stays to do, nothing is marked failed.
        if (isAbortError(err, control.signal)) {
          paused = true
          break
        }
        lastError = err
        logger.warn('Oral exam item failed; topic skipped', {
          error: (err as Error)?.message,
        })
      }
      remaining.shift()
      const stored = inputs.length > 0 ? await this.questions.addMany(inputs) : []
      current = {
        ...current,
        questionIds: [...current.questionIds, ...stored.map((q) => q.id)],
        difficultyPlan: [...current.difficultyPlan, ...stored.map(() => state.difficulty)],
        oralResume: { ...state, remaining: [...remaining], updatedAt: Date.now() },
      }
      await this.quizzes.upsert(current)
    }

    if (paused && remaining.length > 0) {
      const pausedQuiz: Quiz = {
        ...current,
        status: 'paused',
        oralResume: { ...state, remaining: [...remaining], updatedAt: Date.now() },
      }
      await this.quizzes.upsert(pausedQuiz)
      logger.info('Oral exam generation paused', {
        quizId: pausedQuiz.id,
        remaining: remaining.length,
      })
      return pausedQuiz
    }
    if (current.questionIds.length === 0) {
      throw lastError ?? new AppError(t('oral.errors.noItems'), 'MALFORMED_QUIZ')
    }

    options.onProgress?.('storing', 85)
    const stored = await this.questions.listByIds(current.questionIds)
    const topicCount = new Set(stored.map((q) => q.oral?.group)).size
    const { oralResume: _finished, errorMessage: _error, ...rest } = current
    void _finished
    void _error
    const ready: Quiz = {
      ...rest,
      title: t('oral.quizTitle', { topic: state.label, count: topicCount }),
      config: { ...current.config, count: topicCount },
      status: 'ready',
    }
    await this.quizzes.upsert(ready)
    options.onProgress?.('done', 100)
    logger.info('Oral exam generated', { quizId: ready.id, topics: topicCount })
    return ready
  }

  private async generateItem(
    input: Parameters<typeof prompts.oralExam.buildUserPrompt>[0],
    snippets: Map<string, SourceSnippet>,
    options: { aiOnly: boolean; fallbackPoint: string },
    subject: SubjectContext | undefined,
    signal?: AbortSignal,
  ): Promise<ValidatedOralItem> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: prompts.subjectProfile.withSubject(prompts.oralExam.buildSystemPrompt(), subject),
      },
      { role: 'user', content: prompts.oralExam.buildUserPrompt(input) },
    ]
    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { data } = await this.ai.chatJSON<OralExamOutput>(messages, signal ? { signal } : {})
        const item = validateOralItem(data, snippets, options)
        if (item) return item
        lastError = new AppError(t('oral.errors.invalidItem'), 'MALFORMED_QUIZ')
      } catch (err) {
        if (isAbortError(err, signal)) throw err
        // Out of the whole output cap: the same request would end the same way.
        if (exhaustedOutputCap(err)) throw err
        lastError = err
      }
      logger.warn('Oral exam generation attempt failed', {
        attempt,
        error: (lastError as Error)?.message,
      })
    }
    throw lastError
  }
}
