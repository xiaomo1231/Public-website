import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { normalizeCalendar } from './calendar'
import {
  DEFAULT_CALENDAR,
  STUDY_PLAN_ID,
  type DiagnosticPaper,
  type PlannedExam,
  type StudyPlan,
  type StudyTask,
} from './types'

/** Storage for 学习计划: exams, the plan row, tasks and diagnostic papers. */
export class StudyPlanRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  // ── plan row ──────────────────────────────────────────────────────────
  async getPlan(): Promise<StudyPlan> {
    const row = await this.db.studyPlans.get(STUDY_PLAN_ID)
    if (!row) return { id: STUDY_PLAN_ID, calendar: DEFAULT_CALENDAR, updatedAt: 0 }
    return { ...row, calendar: normalizeCalendar(row.calendar ?? DEFAULT_CALENDAR) }
  }

  /** Read-modify-write of the plan row in one transaction. */
  async updatePlan(fn: (plan: StudyPlan) => StudyPlan): Promise<StudyPlan> {
    return this.db.transaction('rw', this.db.studyPlans, async () => {
      const next = { ...fn(await this.getPlan()), id: STUDY_PLAN_ID, updatedAt: Date.now() }
      await this.db.studyPlans.put(next)
      return next
    })
  }

  // ── exams ─────────────────────────────────────────────────────────────
  listExams(): Promise<PlannedExam[]> {
    return this.db.exams.orderBy('at').toArray()
  }

  listExamsByProject(projectId: string): Promise<PlannedExam[]> {
    return this.db.exams
      .where('projectId')
      .equals(projectId)
      .toArray()
      .then((rows) => rows.sort((a, b) => a.at - b.at))
  }

  getExam(id: string): Promise<PlannedExam | undefined> {
    return this.db.exams.get(id)
  }

  async putExams(exams: PlannedExam[]): Promise<void> {
    await this.db.exams.bulkPut(exams)
  }

  /** Read-modify-write of one exam (review topics finish concurrently). */
  async updateExam(
    id: string,
    fn: (exam: PlannedExam) => PlannedExam,
  ): Promise<PlannedExam | undefined> {
    return this.db.transaction('rw', this.db.exams, async () => {
      const row = await this.db.exams.get(id)
      if (!row) return undefined
      const next = { ...fn(row), id: row.id, updatedAt: Date.now() }
      await this.db.exams.put(next)
      return next
    })
  }

  /** The exam, its tasks, and its sections of diagnostic papers. */
  async deleteExam(id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.exams, this.db.studyTasks, this.db.diagnostics, this.db.studyPlans],
      async () => {
        await this.db.exams.delete(id)
        await this.db.studyTasks.where('examId').equals(id).delete()
        await this.stripDiagnostics((section) => section.examId === id)
        await this.dropWeights([id])
      },
    )
  }

  // ── tasks ─────────────────────────────────────────────────────────────
  listTasks(): Promise<StudyTask[]> {
    return this.db.studyTasks.toArray()
  }

  listTasksOn(date: string): Promise<StudyTask[]> {
    return this.db.studyTasks.where('date').equals(date).toArray()
  }

  getTask(id: string): Promise<StudyTask | undefined> {
    return this.db.studyTasks.get(id)
  }

  async putTask(task: StudyTask): Promise<StudyTask> {
    await this.db.studyTasks.put(task)
    return task
  }

  /** Replace planned tasks in one transaction (see `reconcileTasks`). */
  async applyTasks(removeIds: string[], add: StudyTask[], plan: StudyPlan): Promise<void> {
    await this.db.transaction('rw', [this.db.studyTasks, this.db.studyPlans], async () => {
      if (removeIds.length > 0) await this.db.studyTasks.bulkDelete(removeIds)
      if (add.length > 0) await this.db.studyTasks.bulkPut(add)
      await this.db.studyPlans.put(plan)
    })
  }

  // ── diagnostics ───────────────────────────────────────────────────────
  listDiagnostics(): Promise<DiagnosticPaper[]> {
    return this.db.diagnostics.orderBy('createdAt').reverse().toArray()
  }

  getDiagnostic(id: string): Promise<DiagnosticPaper | undefined> {
    return this.db.diagnostics.get(id)
  }

  async putDiagnostic(paper: DiagnosticPaper): Promise<DiagnosticPaper> {
    await this.db.diagnostics.put(paper)
    return paper
  }

  /** Read-modify-write of one paper (pool tasks finish concurrently). */
  async updateDiagnostic(
    id: string,
    fn: (paper: DiagnosticPaper) => DiagnosticPaper,
  ): Promise<DiagnosticPaper | undefined> {
    return this.db.transaction('rw', this.db.diagnostics, async () => {
      const row = await this.db.diagnostics.get(id)
      if (!row) return undefined
      const next = { ...fn(row), updatedAt: Date.now() }
      await this.db.diagnostics.put(next)
      return next
    })
  }

  async deleteDiagnostic(id: string): Promise<void> {
    await this.db.diagnostics.delete(id)
  }

  // ── course deletion ───────────────────────────────────────────────────
  /**
   * Remove a course from the plan: its exams and tasks, its sections of
   * diagnostic papers (a paper left empty goes) and its slider shares. Called
   * inside the project-deletion transaction.
   */
  async deleteByProject(projectId: string): Promise<void> {
    const examIds = (await this.db.exams.where('projectId').equals(projectId).primaryKeys()).map(
      String,
    )
    await this.db.exams.where('projectId').equals(projectId).delete()
    await this.db.studyTasks.where('projectId').equals(projectId).delete()
    await this.stripDiagnostics((section) => section.projectId === projectId)
    await this.dropWeights(examIds)
  }

  private async stripDiagnostics(
    remove: (section: DiagnosticPaper['sections'][number]) => boolean,
  ): Promise<void> {
    for (const paper of await this.db.diagnostics.toArray()) {
      const sections = paper.sections.filter((section) => !remove(section))
      if (sections.length === paper.sections.length) continue
      if (sections.length === 0) await this.db.diagnostics.delete(paper.id)
      else
        await this.db.diagnostics.put({
          ...paper,
          sections,
          examIds: paper.examIds.filter((id) => sections.some((s) => s.examId === id)),
        })
    }
  }

  private async dropWeights(examIds: string[]): Promise<void> {
    if (examIds.length === 0) return
    const plan = await this.db.studyPlans.get(STUDY_PLAN_ID)
    if (!plan?.weights) return
    const weights = { ...plan.weights }
    for (const id of examIds) delete weights[id]
    await this.db.studyPlans.put({ ...plan, weights })
  }
}
