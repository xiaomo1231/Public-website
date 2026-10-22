import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { StudyPlanService } from '@/services/studyPlanService'
import { DiagnosticService, planItems, type DiagnosticQuizPort } from '@/services/diagnosticService'
import { DataManagementService, EXPORTED_TABLES } from '@/services/dataManagementService'
import { createGenerationRun } from '@/shared/lib/generationControl'
import type { Quiz, QuizConfig } from '@/entities/quiz/types'
import { dayKey } from '@/entities/studyPlan/calendar'
import {
  hidesCountdown,
  countdownParts,
  countdownUrgency,
  nearestExam,
} from '@/entities/studyPlan/countdown'

let db: AppDatabase

async function seedCourse(name: string, topics: string[]) {
  const project = await new ProjectService(db).create({ name, subject: 'linear_algebra' })
  await db.table('courseAnalyses').put({
    id: `a-${project.id}`,
    projectId: project.id,
    status: 'ready',
    documentIds: [],
    language: 'en',
  })
  await db.table('topics').bulkPut(
    topics.map((topic, i) => ({
      id: `${project.id}-${topic}`,
      projectId: project.id,
      name: topic,
      description: '',
      order: i,
      sourceRefs: [],
    })),
  )
  return project
}

/** A stub of the quiz pipeline: records calls, stores a quiz row per item. */
function stubQuiz(options: { fail?: (config: QuizConfig) => boolean; delayMs?: number } = {}) {
  let active = 0
  let peak = 0
  const calls: QuizConfig[] = []
  const port: DiagnosticQuizPort = {
    async generateQuiz(projectId, config, opts) {
      calls.push(config)
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 5))
      active -= 1
      if (options.fail?.(config))
        throw Object.assign(new Error('bad batch'), { code: 'INVALID_JSON' })
      const paused = opts?.control && !opts.control.shouldContinue()
      const quiz: Quiz = {
        id: crypto.randomUUID(),
        projectId,
        title: 'item',
        config,
        questionIds: Array.from({ length: config.count }, () => crypto.randomUUID()),
        status: paused ? 'paused' : 'ready',
        difficultyPlan: Array.from({ length: config.count }, () => 'intermediate' as const),
        startedAt: 1,
        promptVersion: 'v9',
      }
      await db.table('quizzes').put(quiz)
      return quiz
    },
    async continueQuiz(quizId) {
      const quiz = (await db.table('quizzes').get(quizId)) as Quiz
      const ready = { ...quiz, status: 'ready' as const }
      await db.table('quizzes').put(ready)
      return ready
    },
  }
  return { port, calls, peak: () => peak }
}

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

afterEach(() => {
  db.close()
})

describe('study plan service', () => {
  it('adds several exams at once and lays out tasks within the calendar', async () => {
    const la = await seedCourse('Linear algebra', ['Matrices', 'Determinants', 'Eigenvalues'])
    const ph = await seedCourse('Physics', ['Kinematics', 'Forces'])
    const service = new StudyPlanService({ db })
    const now = new Date(2026, 10, 2, 8).getTime()
    await service.addExams(
      [
        { projectId: la.id, name: 'LA midterm', at: now + 12 * 86_400_000 },
        { projectId: ph.id, name: 'Physics final', at: now + 25 * 86_400_000 },
      ],
      now,
    )
    const result = await service.replan(now)
    for (const day of result.days) expect(day.used).toBeLessThanOrEqual(day.available)
    const tasks = await db.table('studyTasks').toArray()
    expect(tasks.some((task) => task.kind === 'learn' && task.projectId === la.id)).toBe(true)
    expect(tasks.some((task) => task.kind === 'learn' && task.projectId === ph.id)).toBe(true)
    const today = await service.today(now)
    expect(today.date).toBe(dayKey(now))
    expect(today.tasks.length).toBeGreaterThan(0)

    // Done stays done across a re-plan; a moved task stays on its day.
    const [first, second] = today.tasks
    await service.setTaskStatus(first!.id, 'done', now)
    const target = dayKey(now + 3 * 86_400_000)
    await service.moveTask(second!.id, target, now)
    await service.replan(now + 60_000)
    expect((await db.table('studyTasks').get(first!.id))?.status).toBe('done')
    const moved = await db.table('studyTasks').get(second!.id)
    expect(moved?.date).toBe(target)
    expect(moved?.pinned).toBe(true)
    // The finished topic is not taught again.
    const learnAgain = (await db.table('studyTasks').toArray()).filter(
      (task) =>
        task.kind === 'learn' && task.topicId === first!.topicId && task.status === 'pending',
    )
    if (first!.kind === 'learn') expect(learnAgain).toEqual([])

    const weights = await service.weights(now)
    expect(weights.suggestions.reduce((sum, s) => sum + s.share, 0)).toBe(100)
  })

  it('is exported, restored and cleaned up with the course', async () => {
    for (const table of ['exams', 'studyPlans', 'studyTasks', 'diagnostics'])
      expect(EXPORTED_TABLES).toContain(table)
    const la = await seedCourse('LA', ['A'])
    const keep = await seedCourse('Keep', ['B'])
    const service = new StudyPlanService({ db })
    const now = Date.now()
    const [doomed, kept] = await service.addExams(
      [
        { projectId: la.id, name: 'Doomed', at: now + 9 * 86_400_000 },
        { projectId: keep.id, name: 'Kept', at: now + 9 * 86_400_000 },
      ],
      now,
    )
    await service.setWeights({
      [doomed!.id]: { share: 50, locked: false },
      [kept!.id]: { share: 50, locked: false },
    })
    await service.replan(now)
    await db.table('diagnostics').put({
      id: 'd1',
      examIds: [doomed!.id, kept!.id],
      sections: [
        { examId: doomed!.id, projectId: la.id, label: 'x', count: 2, minutes: 5, items: [] },
        { examId: kept!.id, projectId: keep.id, label: 'y', count: 2, minutes: 5, items: [] },
      ],
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    })
    await new DataManagementService(db).deleteProject(la.id)
    expect(await db.table('exams').where('projectId').equals(la.id).count()).toBe(0)
    expect(await db.table('studyTasks').where('projectId').equals(la.id).count()).toBe(0)
    expect(await db.table('studyTasks').where('projectId').equals(keep.id).count()).toBeGreaterThan(
      0,
    )
    const paper = await db.table('diagnostics').get('d1')
    expect(paper.sections.map((s: { examId: string }) => s.examId)).toEqual([kept!.id])
    const plan = await service.getPlan()
    expect(Object.keys(plan.weights ?? {})).toEqual([kept!.id])
  })
})

describe('diagnostic paper generation', () => {
  async function paperFor(count: number) {
    const la = await seedCourse('LA', ['Matrices', 'Determinants', 'Eigenvalues', 'Bases'])
    const service = new StudyPlanService({ db })
    const now = Date.now()
    const [exam] = await service.addExams(
      [{ projectId: la.id, name: 'Mid', at: now + 9 * 86_400_000 }],
      now,
    )
    const topics = (await db.table('topics').where('projectId').equals(la.id).toArray()).map(
      (topic: { id: string; name: string }) => ({
        key: topic.id,
        label: topic.name,
        topicId: topic.id,
      }),
    )
    return { la, exam: exam!, topics, count }
  }

  it('splits a section into items of at most five questions', () => {
    const items = planItems(
      [1, 2, 3].map((i) => ({ key: `t${i}`, label: `T${i}`, topicId: `t${i}` })),
      14,
    )
    expect(items.every((item) => item.count <= 5)).toBe(true)
    expect(items.reduce((sum, item) => sum + item.count, 0)).toBe(14)
  })

  it('stops before any request when the connection check fails', async () => {
    const { la, exam, topics } = await paperFor(6)
    const quiz = stubQuiz()
    const service = new DiagnosticService({
      db,
      quiz: quiz.port,
      ai: { testConnection: async () => ({ ok: false, error: 'quota exhausted' }) },
    })
    const paper = await service.create([
      { examId: exam.id, projectId: la.id, label: 'LA', count: 6, minutes: 15, topics },
    ])
    await expect(service.generate(paper.id)).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' })
    expect(quiz.calls).toEqual([])
  })

  it('runs items through the pool, saves each one, and assembles the section quiz', async () => {
    const { la, exam, topics } = await paperFor(8)
    const quiz = stubQuiz({ delayMs: 15 })
    const service = new DiagnosticService({
      db,
      quiz: quiz.port,
      ai: { testConnection: async () => ({ ok: true }), concurrency: 2 },
    })
    const paper = await service.create([
      { examId: exam.id, projectId: la.id, label: 'LA', count: 8, minutes: 20, topics },
    ])
    const progress: number[] = []
    const done = await service.generate(paper.id, {
      onProgress: (next) =>
        progress.push(next.sections[0]!.items.filter((item) => item.status === 'done').length),
    })
    expect(quiz.peak()).toBeLessThanOrEqual(2)
    expect(quiz.peak()).toBeGreaterThan(1)
    // Each item was stored as soon as it finished.
    expect(progress).toContain(1)
    expect(done.status).toBe('ready')
    const section = done.sections[0]!
    const assembled = (await db.table('quizzes').get(section.quizId!)) as Quiz
    expect(assembled.questionIds).toHaveLength(8)
    expect(assembled.status).toBe('ready')
    // The per-item containers are gone; only the assembled quiz remains.
    expect(await db.table('quizzes').count()).toBe(1)
  })

  it('pauses, then continues only the remaining items; a failed item is retried alone', async () => {
    const { la, exam, topics } = await paperFor(10)
    let failEigen = true
    const quiz = stubQuiz({ fail: (config) => failEigen && config.topicName === 'Eigenvalues' })
    const service = new DiagnosticService({
      db,
      quiz: quiz.port,
      ai: { testConnection: async () => ({ ok: true }), concurrency: 1 },
    })
    const paper = await service.create([
      { examId: exam.id, projectId: la.id, label: 'LA', count: 8, minutes: 20, topics },
    ])
    const run = createGenerationRun()
    let finished = 0
    const paused = await service.generate(paper.id, {
      control: run,
      onProgress: (next) => {
        finished = next.sections[0]!.items.filter((item) => item.status === 'done').length
        if (finished === 1) run.requestPause()
      },
    })
    const firstCalls = quiz.calls.length
    expect(paused.status).not.toBe('ready')
    expect(paused.sections[0]!.items.filter((item) => item.status === 'done')).toHaveLength(1)

    const resumed = await service.generate(paper.id)
    // Continuing never redoes the finished item.
    expect(quiz.calls.length).toBe(firstCalls + (paused.sections[0]!.items.length - 1))
    const failed = resumed.sections[0]!.items.filter((item) => item.status === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]!.error).toBeTruthy()
    expect(resumed.sections[0]!.quizId).toBeUndefined()

    failEigen = false
    const before = quiz.calls.length
    const retried = await service.generate(paper.id, { itemIds: [failed[0]!.id] })
    expect(quiz.calls.length).toBe(before + 1)
    expect(retried.status).toBe('ready')
  })
})

describe('countdown', () => {
  it('is hidden while an exam is being taken', () => {
    expect(hidesCountdown('/projects/p/homework/s/exam')).toBe(true)
    expect(hidesCountdown('/projects/p/quiz/q1')).toBe(true)
    expect(hidesCountdown('/projects/p/interview/s1')).toBe(true)
    expect(hidesCountdown('/projects/p/homework/s', '?view=selftest')).toBe(true)
    expect(hidesCountdown('/projects/p/quiz/q1/result')).toBe(false)
    expect(hidesCountdown('/projects/p/homework/s')).toBe(false)
    expect(hidesCountdown('/dashboard')).toBe(false)
    expect(hidesCountdown('/projects/p/tutor/t')).toBe(false)
  })

  it('counts down to the nearest exam with an urgency ramp', () => {
    const now = 0
    const day = 86_400_000
    expect(countdownParts(now, 12 * day + 6 * 3_600_000)).toMatchObject({ days: 12, hours: 6 })
    expect(countdownUrgency(now, 20 * day)).toBe('calm')
    expect(countdownUrgency(now, 10 * day)).toBe('soon')
    expect(countdownUrgency(now, 5 * day)).toBe('near')
    expect(countdownUrgency(now, 2 * day)).toBe('final')
    expect(nearestExam([{ at: 5 }, { at: -1 }, { at: 3 }], 0)).toEqual({ at: 3 })
  })
})
