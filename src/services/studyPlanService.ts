import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { StudyPlanRepository } from '@/entities/studyPlan/repository'
import {
  addDays,
  dayKey,
  daysBetween,
  minutesOn,
  normalizeCalendar,
  weekStart,
} from '@/entities/studyPlan/calendar'
import {
  buildSchedule,
  CONFIRMED_ATTEMPTS,
  CONFIRMED_MASTERY,
  FINAL_DAYS,
  type ScheduleResult,
  type SchedulerExam,
  type SchedulerMaterial,
  type SchedulerTopic,
} from '@/entities/studyPlan/scheduler'
import {
  handledMaterials,
  pinnedMinutes,
  reconcileTasks,
  topicProgress,
} from '@/entities/studyPlan/tasks'
import {
  effectiveShares,
  examDifficulty,
  suggestWeights,
  type WeightSuggestion,
} from '@/entities/studyPlan/weights'
import {
  EMPTY_MATERIALS,
  type ExamWeightSetting,
  type PlannedExam,
  type PlannedExamMaterials,
  type PlannedExamScope,
  type StudyCalendar,
  type StudyPlan,
  type StudyTask,
  type StudyTaskStatus,
} from '@/entities/studyPlan/types'
import { ProjectRepository } from '@/entities/project/repository'
import type { Project } from '@/entities/project/types'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { Topic } from '@/entities/courseAnalysis/types'
import { MasteryService } from './masteryService'
import { MistakeService } from './mistakeService'
import { ReviewCardRepository } from '@/entities/reviewCard/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { PracticeRepository } from '@/entities/practice/repository'
import { VocabRepository } from '@/entities/vocab/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import { SyllabusService } from './syllabusService'
import { DocumentRepository } from '@/entities/document/repository'
import { resolveMaterialType } from '@/entities/document/types'
import { FocusService, lastDaysRange } from './focusService'
import { examTopicCoverage, type CoverageInput } from '@/entities/syllabus/coverage'
import { analyzePastExams, matchQuestionTopics } from '@/entities/exam/analysis'
import { scoreMockExam } from '@/entities/exam/scoring'
import { DEFAULT_EXAM_MINUTES, type MockExamAttempt } from '@/entities/exam/types'
import { isRetestDue } from '@/entities/mistake/followUp'
import type { KnowledgeMastery } from '@/entities/knowledgeMastery/types'
import { AppError, NotFoundError } from '@/infrastructure/errors/AppError'
import { logger } from '@/infrastructure/logger/logger'
import { t } from '@/i18n'

/** Minutes assumed for a homework set / a professor practice set. */
const HOMEWORK_MINUTES = 40
const PRACTICE_SET_MINUTES = 30
/** A plan older than this is laid out again when a plan page opens. */
const STALE_PLAN_MS = 5 * 60_000

/** Fired on `window` after exams, the calendar, weights or tasks change. */
export const STUDY_PLAN_CHANGED = 'study-plan-changed'

export function notifyStudyPlanChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STUDY_PLAN_CHANGED))
}

export interface ExamInput {
  projectId: string
  name: string
  at: number
  scope?: PlannedExamScope
  materials?: Partial<PlannedExamMaterials>
}

/** Everything the scheduler and the weights need about one upcoming exam. */
export interface ExamContext {
  exam: PlannedExam
  project: Project
  date: string
  daysLeft: number
  analysisReady: boolean
  topics: SchedulerTopic[]
  mocks: SchedulerMaterial[]
  sets: SchedulerExam['sets']
  mistakesDue: number
  openMistakes: number
  cardsDue: number
  vocabDue: number
  /** Mean mastery estimate over topics with practice; null without. */
  mastery: number | null
  mockPercent?: number
  difficulty: number
  /** Questions in the chosen past papers (0 = none). */
  pastQuestions: number
}

export interface CourseOptions {
  topics: Array<{ id: string; name: string }>
  scopes: Array<{ documentId: string; scopeId: string; label: string; topics: number }>
  pastExams: Array<{ id: string; title: string }>
  homework: Array<{ id: string; title: string }>
  practiceSets: Array<{ id: string; title: string }>
  reviewDocuments: Array<{ id: string; title: string }>
}

export interface WeightsView {
  suggestions: WeightSuggestion[]
  shares: Record<string, ExamWeightSetting>
  /** The student moved a slider (shares are not the suggestion). */
  manual: boolean
}

export interface TodayView {
  date: string
  tasks: StudyTask[]
  availableMinutes: number
  plannedMinutes: number
  doneMinutes: number
  /** Focus time recorded today (Pomodoro), in minutes. */
  focusMinutes: number
}

export interface TimelineDay {
  date: string
  available: number
  planned: number
  done: number
  kinds: Partial<Record<StudyTask['kind'], number>>
}

export type ExamPhase = 'first_pass' | 'mock' | 'final' | 'exam'

export interface TimelineWeek {
  start: string
  days: TimelineDay[]
  /** Phase of each exam during the week (its latest one). */
  phases: Array<{ examId: string; phase: ExamPhase }>
}

export interface TopicTrend {
  examId: string
  topicId: string
  name: string
  mastery: number | null
  /** Planned / done first pass and reviews. */
  learnDate?: string
  learned: boolean
  reviewsPlanned: number
  reviewsDone: number
  /** Weekly mean credit of the topic's practice, oldest first (null = none). */
  trend: Array<number | null>
}

export interface TimelineView {
  weeks: TimelineWeek[]
  topics: TopicTrend[]
}

export class StudyPlanService {
  private db: AppDatabase
  private repo: StudyPlanRepository

  constructor(deps: { db?: AppDatabase } = {}) {
    this.db = deps.db ?? getDb()
    this.repo = new StudyPlanRepository(this.db)
  }

  // ── plan, calendar, weights ───────────────────────────────────────────
  getPlan(): Promise<StudyPlan> {
    return this.repo.getPlan()
  }

  async saveCalendar(calendar: StudyCalendar): Promise<StudyPlan> {
    const plan = await this.repo.updatePlan((current) => ({
      ...current,
      calendar: normalizeCalendar(calendar),
    }))
    notifyStudyPlanChanged()
    return plan
  }

  /** Save slider shares; `undefined` goes back to the suggestion. */
  async setWeights(weights: Record<string, ExamWeightSetting> | undefined): Promise<StudyPlan> {
    const plan = await this.repo.updatePlan((current) => {
      const { weights: _old, ...rest } = current
      void _old
      return weights ? { ...rest, weights } : rest
    })
    notifyStudyPlanChanged()
    return plan
  }

  async saveSummary(summary: StudyPlan['summary']): Promise<StudyPlan> {
    return this.repo.updatePlan((current) => ({ ...current, ...(summary ? { summary } : {}) }))
  }

  // ── exams ─────────────────────────────────────────────────────────────
  listExams(projectId?: string): Promise<PlannedExam[]> {
    return projectId ? this.repo.listExamsByProject(projectId) : this.repo.listExams()
  }

  /** Add several exams at once (the setup form). */
  async addExams(inputs: ExamInput[], now = Date.now()): Promise<PlannedExam[]> {
    const projects = new ProjectRepository(this.db)
    const exams: PlannedExam[] = []
    for (const input of inputs) {
      const name = input.name.trim()
      if (!name) throw new AppError(t('plan.errors.nameRequired'), 'VALIDATION_ERROR')
      if (!Number.isFinite(input.at))
        throw new AppError(t('plan.errors.dateRequired'), 'VALIDATION_ERROR')
      await projects.get(input.projectId)
      exams.push({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        name,
        at: input.at,
        scope: input.scope ?? { kind: 'course' },
        materials: { ...EMPTY_MATERIALS, ...input.materials },
        createdAt: now,
        updatedAt: now,
      })
    }
    await this.repo.putExams(exams)
    notifyStudyPlanChanged()
    return exams
  }

  async updateExam(
    id: string,
    patch: Partial<Pick<PlannedExam, 'name' | 'at' | 'scope' | 'materials'>>,
  ): Promise<PlannedExam> {
    const exam = await this.repo.getExam(id)
    if (!exam) throw new NotFoundError('Exam', id)
    const next: PlannedExam = {
      ...exam,
      ...patch,
      ...(patch.name !== undefined ? { name: patch.name.trim() || exam.name } : {}),
      updatedAt: Date.now(),
    }
    await this.repo.putExams([next])
    notifyStudyPlanChanged()
    return next
  }

  async deleteExam(id: string): Promise<void> {
    await this.repo.deleteExam(id)
    notifyStudyPlanChanged()
  }

  /** What the exam form offers for a course: topics, syllabus scopes, materials. */
  async courseOptions(projectId: string): Promise<CourseOptions> {
    const [topics, syllabi, sets, practiceSets, documents] = await Promise.all([
      new CourseAnalysisRepository(this.db).listTopics(projectId),
      new SyllabusService({ db: this.db }).listSyllabi(projectId),
      new HomeworkRepository(this.db).listSets(projectId),
      new PracticeRepository(this.db).listSets(projectId),
      new DocumentRepository(this.db).listByProject(projectId),
    ])
    return {
      topics: topics.map((topic) => ({ id: topic.id, name: topic.name })),
      scopes: syllabi.flatMap(({ document, data }) =>
        data.scopes.map((scope) => ({
          documentId: document.id,
          scopeId: scope.id,
          label: scope.label,
          topics: scope.topics.length,
        })),
      ),
      pastExams: sets
        .filter((set) => set.kind === 'exam')
        .map((set) => ({ id: set.id, title: set.title })),
      homework: sets
        .filter((set) => !set.kind || set.kind === 'assignment')
        .map((set) => ({ id: set.id, title: set.title })),
      practiceSets: practiceSets.map((set) => ({ id: set.id, title: set.name })),
      reviewDocuments: documents
        .filter((doc) => {
          const type = resolveMaterialType(doc.materialType)
          return type === 'textbook' || type === 'user_notes' || type === 'lecture_transcript'
        })
        .map((doc) => ({ id: doc.id, title: doc.name })),
    }
  }

  // ── what the planner knows about each exam ────────────────────────────
  async contexts(now = Date.now(), tasks?: StudyTask[]): Promise<ExamContext[]> {
    const exams = (await this.repo.listExams()).filter((exam) => exam.at > now)
    const allTasks = tasks ?? (await this.repo.listTasks())
    const out: ExamContext[] = []
    for (const exam of exams) {
      try {
        out.push(await this.context(exam, now, allTasks))
      } catch (err) {
        // A deleted course or unreadable data never blocks the other exams.
        logger.warn('Study plan: exam skipped', { examId: exam.id, error: String(err) })
      }
    }
    return out
  }

  private async context(exam: PlannedExam, now: number, tasks: StudyTask[]): Promise<ExamContext> {
    const projectId = exam.projectId
    const project = await new ProjectRepository(this.db).get(projectId)
    const analyses = new CourseAnalysisRepository(this.db)
    const [analysis, courseTopics, concepts, masteryRows, mistakes, dueCards, sets, practiceSets] =
      await Promise.all([
        analyses.getByProject(projectId),
        analyses.listTopics(projectId),
        analyses.listConcepts(projectId),
        new MasteryService(this.db).listByProject(projectId),
        new MistakeService(this.db).list(projectId, { status: 'active' }),
        new ReviewCardRepository(this.db).listDue(projectId, now),
        new HomeworkRepository(this.db).listSets(projectId),
        new PracticeRepository(this.db).listSets(projectId),
      ])
    const pointsByTopic = new Map<string, string[]>(
      courseTopics.map((topic) => [
        topic.id,
        concepts.filter((c) => c.topicIds.includes(topic.id)).map((c) => c.name),
      ]),
    )
    const coverage: CoverageInput = {
      topics: new Map(courseTopics.map((topic) => [topic.id, topic])),
      pointsByTopic,
      mastery: masteryRows,
    }

    // Topics in scope: course topics, plus exam topics no course topic covers.
    const scoped = await this.scopedTopics(exam, courseTopics)
    const progress = topicProgress(tasks, exam.id)
    const handled = handledMaterials(tasks, exam.id)

    // Past papers: marks per topic, difficulty, mock exams and their results.
    const examSets = sets.filter((set) => set.kind === 'exam')
    const chosenPapers =
      exam.materials.pastExamSetIds.length > 0
        ? examSets.filter((set) => exam.materials.pastExamSetIds.includes(set.id))
        : examSets
    const homework = new HomeworkRepository(this.db)
    const papers = await Promise.all(
      chosenPapers.map(async (set) => ({
        setId: set.id,
        title: set.title,
        questions: (await homework.listQuestions(set.id))
          .filter((q) => !q.retired)
          .map((q) => ({ id: q.id, setId: set.id, prompt: q.prompt })),
      })),
    )
    const past = analyzePastExams({ papers, topics: courseTopics })
    const markBasis = past.totalMarks > 0 ? 'marks' : 'questions'
    const topicMarks = new Map(
      past.byTopic.map((row) => [row.topicId, markBasis === 'marks' ? row.marks : row.questions]),
    )
    const inScopeMarks = scoped
      .filter((entry) => entry.topic)
      .reduce((sum, entry) => sum + (topicMarks.get(entry.topic!.id) ?? 0), 0)

    // Professor habits that name a topic raise its emphasis.
    const habits = (await new CourseContextRepository(this.db).get(projectId))?.questionHabits
    const emphasis = new Map<string, number>()
    if (habits && habits.enabled !== false) {
      for (const item of habits.items) {
        for (const id of matchQuestionTopics(item.statement, courseTopics))
          emphasis.set(id, Math.min(1, (emphasis.get(id) ?? 0) + 0.5))
      }
    }

    const topics: SchedulerTopic[] = scoped.map((entry) => {
      const course = entry.topic
      const result = examTopicCoverage(
        {
          id: entry.id,
          text: entry.name,
          order: 0,
          source: 'local',
          ...(course ? { topicIds: [course.id] } : {}),
        },
        coverage,
      )
      const points = new Set(
        [entry.name, ...(course ? (pointsByTopic.get(course.id) ?? []) : [])].map((p) =>
          p.toLowerCase(),
        ),
      )
      const openMistakes = mistakes.filter(
        (m) => (course && m.topicId === course.id) || points.has(m.knowledgePoint.toLowerCase()),
      ).length
      const done = progress.get(entry.id)
      return {
        id: entry.id,
        name: entry.name,
        ...(inScopeMarks > 0 && course
          ? { marksShare: (topicMarks.get(course.id) ?? 0) / inScopeMarks }
          : {}),
        mastery: result.mastery,
        openMistakes,
        ...(course && emphasis.has(course.id) ? { emphasis: emphasis.get(course.id)! } : {}),
        confirmed:
          result.mastery !== null &&
          result.mastery >= CONFIRMED_MASTERY &&
          result.practiceCount >= CONFIRMED_ATTEMPTS,
        ...(done?.learnedOn ? { learnedOn: done.learnedOn, reviewsDone: done.reviewsDone } : {}),
        ...(done?.skipped ? { skipped: true } : {}),
      }
    })

    const attemptsAfterStart = (set: (typeof examSets)[number]): MockExamAttempt[] =>
      [set.exam?.current, ...(set.exam?.attempts ?? [])].filter(
        (a): a is MockExamAttempt =>
          !!a && a.submittedAt !== undefined && a.submittedAt > exam.createdAt,
      )
    const mocks: SchedulerMaterial[] = chosenPapers.map((set) => ({
      id: set.id,
      title: set.title,
      minutes: set.exam?.durationMinutes ?? set.exam?.detectedMinutes ?? DEFAULT_EXAM_MINUTES,
      done: handled.has(set.id) || attemptsAfterStart(set).length > 0,
    }))
    const checked = chosenPapers
      .flatMap((set) => [set.exam?.current, ...(set.exam?.attempts ?? [])])
      .filter((a): a is MockExamAttempt => !!a && !!a.checkedAt && !!a.results?.length)
      .sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0))[0]
    const mockFraction = checked ? scoreMockExam(checked.results!).fraction : null

    const setsMaterial: SchedulerExam['sets'] = [
      ...sets
        .filter((set) => exam.materials.homeworkSetIds.includes(set.id))
        .map((set) => ({
          id: set.id,
          title: set.title,
          minutes: HOMEWORK_MINUTES,
          kind: 'homework' as const,
          done: handled.has(set.id),
        })),
      ...practiceSets
        .filter((set) => exam.materials.practiceSetIds.includes(set.id))
        .map((set) => ({
          id: set.id,
          title: set.name,
          minutes: PRACTICE_SET_MINUTES,
          kind: 'practice_set' as const,
          done: handled.has(set.id),
        })),
    ]

    const known = topics.filter((topic) => topic.mastery !== null)
    const heavy = past.byKind
      .filter((row) => row.kind === 'calculation' || row.kind === 'proof')
      .reduce((sum, row) => sum + row.questions, 0)
    const vocabDue =
      project.subject === 'language'
        ? (await new VocabRepository(this.db).dueCards(now, 200)).length
        : 0
    const date = dayKey(exam.at)
    return {
      exam,
      project,
      date,
      daysLeft: Math.max(0, daysBetween(dayKey(now), date)),
      analysisReady: analysis?.status === 'ready',
      topics,
      mocks,
      sets: setsMaterial,
      mistakesDue: mistakes.filter((m) => isRetestDue(m, now)).length,
      openMistakes: mistakes.length,
      cardsDue: dueCards.length,
      vocabDue,
      mastery:
        known.length > 0
          ? known.reduce((sum, topic) => sum + topic.mastery!, 0) / known.length
          : null,
      ...(mockFraction !== null ? { mockPercent: Math.round(mockFraction * 100) } : {}),
      difficulty: examDifficulty({
        topicCount: topics.length,
        questions: past.questions,
        heavyQuestions: heavy,
      }),
      pastQuestions: past.questions,
    }
  }

  /** The exam's topics: course topics in scope, then uncovered exam topics. */
  private async scopedTopics(
    exam: PlannedExam,
    courseTopics: Topic[],
  ): Promise<Array<{ id: string; name: string; topic?: Topic }>> {
    const scope = exam.scope
    if (scope.kind === 'topics') {
      const wanted = new Set(scope.topicIds)
      return courseTopics
        .filter((topic) => wanted.has(topic.id))
        .map((topic) => ({ id: topic.id, name: topic.name, topic }))
    }
    if (scope.kind === 'syllabus') {
      const syllabi = await new SyllabusService({ db: this.db }).listSyllabi(exam.projectId)
      const found = syllabi
        .find((row) => row.document.id === scope.documentId)
        ?.data.scopes.find((s) => s.id === scope.scopeId)
      if (found) {
        const byId = new Map(courseTopics.map((topic) => [topic.id, topic]))
        const out: Array<{ id: string; name: string; topic?: Topic }> = []
        const seen = new Set<string>()
        for (const item of found.topics) {
          const matched = (item.topicIds ?? []).map((id) => byId.get(id)).filter(Boolean) as Topic[]
          if (matched.length === 0) {
            out.push({ id: `exam:${item.id}`, name: item.text })
            continue
          }
          for (const topic of matched) {
            if (seen.has(topic.id)) continue
            seen.add(topic.id)
            out.push({ id: topic.id, name: topic.name, topic })
          }
        }
        return out
      }
    }
    return courseTopics.map((topic) => ({ id: topic.id, name: topic.name, topic }))
  }

  // ── weights ───────────────────────────────────────────────────────────
  async weights(now = Date.now(), contexts?: ExamContext[]): Promise<WeightsView> {
    const ctx = contexts ?? (await this.contexts(now))
    const plan = await this.repo.getPlan()
    const today = dayKey(now)
    const suggestions = suggestWeights(
      ctx.map((c) => {
        let available = 0
        for (let i = 0; i < c.daysLeft; i++)
          available += minutesOn(plan.calendar, addDays(today, i))
        return {
          examId: c.exam.id,
          daysLeft: c.daysLeft,
          difficulty: c.difficulty,
          mastery: c.mastery,
          topicCount: c.topics.length,
          ...(c.mockPercent !== undefined ? { mockPercent: c.mockPercent } : {}),
          availableMinutes: available,
        }
      }),
    )
    const manual = !!plan.weights && ctx.every((c) => plan.weights![c.exam.id] !== undefined)
    return { suggestions, shares: effectiveShares(suggestions, plan.weights), manual }
  }

  // ── laying out the plan ───────────────────────────────────────────────
  /**
   * Lay the tasks out again from today: done / skipped tasks stay, tasks the
   * student moved stay on their day, everything else is replaced (unfinished
   * work rolls forward). Local only, no AI.
   */
  async replan(now = Date.now()): Promise<ScheduleResult> {
    const today = dayKey(now)
    const tasks = await this.repo.listTasks()
    const contexts = await this.contexts(now, tasks)
    const view = await this.weights(now, contexts)
    const plan = await this.repo.getPlan()
    const exams: SchedulerExam[] = contexts.map((c) => ({
      id: c.exam.id,
      projectId: c.exam.projectId,
      name: c.exam.name,
      date: c.date,
      weight: view.shares[c.exam.id]?.share ?? 0,
      topics: c.topics,
      mocks: c.mocks,
      sets: c.sets,
      aiMockSlot: !handledMaterials(tasks, c.exam.id).has(`ai-mock:${c.exam.id}`),
      mistakesDue: c.mistakesDue,
      openMistakes: c.openMistakes,
      cardsDue: c.cardsDue,
      vocabDue: c.vocabDue,
    }))
    const result = buildSchedule({
      today,
      calendar: plan.calendar,
      exams,
      pinned: pinnedMinutes(tasks, today),
    })
    const { removeIds, add } = reconcileTasks(
      tasks.filter((task) => exams.some((exam) => exam.id === task.examId)),
      result.days.flatMap((day) => day.tasks),
      today,
      now,
    )
    // Pending tasks of exams that are over (or gone) are cleared too.
    const stale = tasks
      .filter((task) => task.status === 'pending' && !exams.some((exam) => exam.id === task.examId))
      .map((task) => task.id)
    const names = new Map(contexts.flatMap((c) => c.topics.map((topic) => [topic.id, topic.name])))
    const nextPlan: StudyPlan = {
      ...plan,
      lastPlannedAt: now,
      overflow: {
        droppedMinutes: result.droppedMinutes,
        dropped: result.dropped.map((item) => ({
          examId: item.examId,
          ...(item.topicId ? { topicId: item.topicId } : {}),
          label: item.label || (item.topicId ? (names.get(item.topicId) ?? '') : ''),
          minutes: item.minutes,
        })),
        suggestions: result.suggestions,
      },
      updatedAt: now,
    }
    await this.repo.applyTasks([...removeIds, ...stale], add, nextPlan)
    return result
  }

  /** Re-plan when the last layout is from another day or a few minutes old. */
  async replanIfStale(now = Date.now()): Promise<boolean> {
    const plan = await this.repo.getPlan()
    const last = plan.lastPlannedAt
    if (last && dayKey(last) === dayKey(now) && now - last < STALE_PLAN_MS) return false
    await this.replan(now)
    return true
  }

  // ── tasks ─────────────────────────────────────────────────────────────
  async setTaskStatus(id: string, status: StudyTaskStatus, now = Date.now()): Promise<void> {
    const task = await this.repo.getTask(id)
    if (!task) throw new NotFoundError('StudyTask', id)
    const { doneAt: _doneAt, ...rest } = task
    void _doneAt
    await this.repo.putTask({
      ...rest,
      status,
      ...(status === 'done' ? { doneAt: now } : {}),
      updatedAt: now,
    })
    await this.replan(now)
    notifyStudyPlanChanged()
  }

  /** Move a task to another day (kept there by later re-plans). */
  async moveTask(id: string, date: string, now = Date.now()): Promise<void> {
    const task = await this.repo.getTask(id)
    if (!task) throw new NotFoundError('StudyTask', id)
    if (date < dayKey(now)) throw new AppError(t('plan.errors.pastDay'), 'VALIDATION_ERROR')
    await this.repo.putTask({ ...task, date, pinned: true, order: 999, updatedAt: now })
    await this.replan(now)
    notifyStudyPlanChanged()
  }

  async today(now = Date.now(), projectId?: string): Promise<TodayView> {
    const date = dayKey(now)
    const plan = await this.repo.getPlan()
    const tasks = (await this.repo.listTasksOn(date))
      .filter((task) => !projectId || task.projectId === projectId)
      .sort((a, b) => a.order - b.order)
    let focusMinutes = 0
    try {
      const totals = await new FocusService(this.db).totalsByCourse(lastDaysRange(1, now))
      focusMinutes = Math.round(
        totals
          .filter((row) => !projectId || row.projectId === projectId)
          .reduce((sum, row) => sum + row.focusedMs, 0) / 60_000,
      )
    } catch {
      focusMinutes = 0
    }
    return {
      date,
      tasks,
      availableMinutes: minutesOn(plan.calendar, date),
      plannedMinutes: tasks
        .filter((task) => task.status !== 'skipped')
        .reduce((sum, task) => sum + task.minutes, 0),
      doneMinutes: tasks
        .filter((task) => task.status === 'done')
        .reduce((sum, task) => sum + task.minutes, 0),
      focusMinutes,
    }
  }

  async timeline(now = Date.now()): Promise<TimelineView> {
    const today = dayKey(now)
    const plan = await this.repo.getPlan()
    const tasks = await this.repo.listTasks()
    const contexts = await this.contexts(now, tasks)
    const last = contexts.reduce((max, c) => (c.date > max ? c.date : max), today)
    const byDay = new Map<string, StudyTask[]>()
    for (const task of tasks) byDay.set(task.date, [...(byDay.get(task.date) ?? []), task])
    const weeks: TimelineWeek[] = []
    for (let date = weekStart(today); date <= last; date = addDays(date, 7)) {
      const days: TimelineDay[] = []
      for (let i = 0; i < 7; i++) {
        const d = addDays(date, i)
        const list = (byDay.get(d) ?? []).filter((task) => task.status !== 'skipped')
        const kinds: TimelineDay['kinds'] = {}
        for (const task of list) kinds[task.kind] = (kinds[task.kind] ?? 0) + 1
        days.push({
          date: d,
          available: minutesOn(plan.calendar, d),
          planned: list.reduce((sum, task) => sum + task.minutes, 0),
          done: list
            .filter((task) => task.status === 'done')
            .reduce((sum, task) => sum + task.minutes, 0),
          kinds,
        })
      }
      const weekEnd = addDays(date, 6)
      const phases = contexts.map((c) => {
        const left = daysBetween(weekEnd < c.date ? weekEnd : c.date, c.date)
        const hasMock = tasks.some(
          (task) =>
            task.examId === c.exam.id &&
            (task.kind === 'mock' || task.kind === 'ai_mock') &&
            task.date >= date &&
            task.date <= weekEnd,
        )
        const phase: ExamPhase =
          c.date <= weekEnd && c.date >= date
            ? 'exam'
            : left <= FINAL_DAYS
              ? 'final'
              : hasMock
                ? 'mock'
                : 'first_pass'
        return { examId: c.exam.id, phase }
      })
      weeks.push({ start: date, days, phases })
    }

    const masteryCache = new Map<string, KnowledgeMastery[]>()
    const topics: TopicTrend[] = []
    for (const c of contexts) {
      if (!masteryCache.has(c.exam.projectId))
        masteryCache.set(
          c.exam.projectId,
          await new MasteryService(this.db).listByProject(c.exam.projectId),
        )
      const rows = masteryCache.get(c.exam.projectId)!
      for (const topic of c.topics) {
        const mine = tasks.filter((task) => task.examId === c.exam.id && task.topicId === topic.id)
        const learn = mine.find((task) => task.kind === 'learn')
        const rowsFor = rows.filter(
          (row) =>
            row.topicId === topic.id ||
            row.knowledgePoint.toLowerCase() === topic.name.toLowerCase(),
        )
        topics.push({
          examId: c.exam.id,
          topicId: topic.id,
          name: topic.name,
          mastery: topic.mastery,
          ...(learn
            ? { learnDate: learn.date }
            : topic.learnedOn
              ? { learnDate: topic.learnedOn }
              : {}),
          learned: !!topic.learnedOn,
          reviewsPlanned: mine.filter((task) => task.kind === 'review' && task.status === 'pending')
            .length,
          reviewsDone: mine.filter((task) => task.kind === 'review' && task.status === 'done')
            .length,
          trend: weeklyTrend(rowsFor, now, 4),
        })
      }
    }
    return { weeks, topics }
  }
}

/** Mean credit of practice per week, the last `weeks` weeks, oldest first. */
export function weeklyTrend(
  rows: Array<Pick<KnowledgeMastery, 'observations'>>,
  now: number,
  weeks: number,
): Array<number | null> {
  const out: Array<number | null> = []
  for (let w = weeks - 1; w >= 0; w--) {
    const to = now - w * 7 * 86_400_000
    const from = to - 7 * 86_400_000
    const credits = rows
      .flatMap((row) => row.observations)
      .filter((obs) => obs.at > from && obs.at <= to && obs.isCorrect !== null)
      .map((obs) => obs.credit ?? (obs.isCorrect ? 1 : 0))
    out.push(
      credits.length > 0
        ? Math.round((credits.reduce((a, b) => a + b, 0) / credits.length) * 100) / 100
        : null,
    )
  }
  return out
}
