import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { MistakeRepository } from '@/entities/mistake/repository'
import { KnowledgeMasteryRepository } from '@/entities/knowledgeMastery/repository'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { QuizRepository } from '@/entities/quiz/repository'
import type { Project } from '@/entities/project/types'
import type { AnalysisStatus } from '@/entities/courseAnalysis/types'
import type { HomeworkQuestion } from '@/entities/homework/types'

/**
 * Read-only summary behind the homepage: for each course, what exists, what
 * is in progress, and the single most useful next step. Nothing here writes,
 * calls AI or invents progress — every number is counted from stored rows.
 */

/** The one action the homepage suggests for a course, in priority order. */
export type CourseNextStep =
  | { kind: 'upload' }
  | { kind: 'processing' }
  | { kind: 'analyze' }
  | { kind: 'analyzing' }
  | { kind: 'quiz'; quizId: string; title: string }
  | { kind: 'homework'; setId: string; title: string; remaining: number }
  | { kind: 'mistakes'; count: number }
  | { kind: 'tutor'; topicId?: string; topicName?: string }

export interface WeakPoint {
  knowledgePoint: string
  mastery: number
}

export interface CourseOverview {
  project: Project
  /** Learning materials only (homework and answer keys are counted separately). */
  materials: { total: number; processing: number; failed: number }
  analysis: AnalysisStatus | 'none'
  topicCount: number
  homework: { questions: number; worked: number }
  activeMistakes: number
  /** Practised knowledge points with a low mastery estimate, weakest first. */
  weakPoints: WeakPoint[]
  /** Most recent activity of any kind, or the project's own update time. */
  lastActivityAt: number
  nextStep: CourseNextStep
}

/** "Pick up where you left off": the latest real study activity. */
export type ResumeItem =
  | { kind: 'tutor'; projectId: string; projectName: string; at: number; topicId?: string; topicName: string }
  | { kind: 'homework'; projectId: string; projectName: string; at: number; setId: string; title: string; remaining: number }
  | { kind: 'quiz'; projectId: string; projectName: string; at: number; quizId: string; title: string }

export interface HomeOverview {
  courses: CourseOverview[]
  resume: ResumeItem | null
}

const WEAK_MASTERY = 0.6
const MIN_ATTEMPTS = 2

/** A question counts as worked once the student has done anything with it. */
export function isQuestionWorked(q: HomeworkQuestion): boolean {
  return (
    q.solutionRevealed ||
    q.revealedHints > 0 ||
    Boolean(q.answerCheck) ||
    q.draftText.trim().length > 0 ||
    q.messages.length > 0
  )
}

export class HomeOverviewService {
  private documents: DocumentRepository
  private analyses: CourseAnalysisRepository
  private homework: HomeworkRepository
  private mistakes: MistakeRepository
  private mastery: KnowledgeMasteryRepository
  private sessions: TutorSessionRepository
  private quizzes: QuizRepository

  constructor(db?: AppDatabase) {
    const resolved = db ?? getDb()
    this.documents = new DocumentRepository(resolved)
    this.analyses = new CourseAnalysisRepository(resolved)
    this.homework = new HomeworkRepository(resolved)
    this.mistakes = new MistakeRepository(resolved)
    this.mastery = new KnowledgeMasteryRepository(resolved)
    this.sessions = new TutorSessionRepository(resolved)
    this.quizzes = new QuizRepository(resolved)
  }

  async load(projects: readonly Project[]): Promise<HomeOverview> {
    const results = await Promise.all(projects.map((p) => this.course(p)))
    const courses = results
      .map((r) => r.course)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    const resume =
      results
        .map((r) => r.resume)
        .filter((r): r is ResumeItem => r !== null)
        .sort((a, b) => b.at - a.at)[0] ?? null
    return { courses, resume }
  }

  private async course(
    project: Project,
  ): Promise<{ course: CourseOverview; resume: ResumeItem | null }> {
    const [documents, analysis, topics, sets, mistakeStats, masteryRows, sessions, quizzes] =
      await Promise.all([
        this.documents.listByProject(project.id),
        this.analyses.getByProject(project.id),
        this.analyses.listTopics(project.id),
        this.homework.listSets(project.id),
        this.mistakes.stats(project.id),
        this.mastery.listByProject(project.id),
        this.sessions.listByProject(project.id),
        this.quizzes.listByProject(project.id),
      ])

    const learning = documents.filter(
      (d) => d.materialType !== 'homework' && d.materialType !== 'homework_answer',
    )
    const materials = {
      total: learning.length,
      processing: learning.filter((d) => d.status === 'uploading' || d.status === 'processing')
        .length,
      failed: learning.filter((d) => d.status === 'failed').length,
    }

    // Homework: per ready assignment, how many live questions were touched.
    const readySets = sets.filter((s) => s.status === 'ready')
    const questionLists = await Promise.all(readySets.map((s) => this.homework.listQuestions(s.id)))
    let questions = 0
    let worked = 0
    let openSet: { setId: string; title: string; remaining: number; at: number } | null = null
    readySets.forEach((set, index) => {
      const live = questionLists[index]!.filter((q) => !q.retired)
      const done = live.filter(isQuestionWorked)
      questions += live.length
      worked += done.length
      const remaining = live.length - done.length
      const at = Math.max(set.updatedAt, ...live.map((q) => q.updatedAt))
      // The assignment the student touched most recently that is not finished.
      if (remaining > 0 && (!openSet || at > openSet.at)) {
        openSet = { setId: set.id, title: set.title, remaining, at }
      }
    })

    const latestSession = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const openQuiz = quizzes
      .filter((q) => q.status === 'in_progress')
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    const lastQuizAt = Math.max(0, ...quizzes.map((q) => q.finishedAt ?? q.startedAt))

    const weakPoints = masteryRows
      .filter((m) => m.attempts >= MIN_ATTEMPTS && m.mastery < WEAK_MASTERY)
      .sort((a, b) => a.mastery - b.mastery)
      .map((m) => ({ knowledgePoint: m.knowledgePoint, mastery: m.mastery }))

    const analysisStatus: AnalysisStatus | 'none' = analysis?.status ?? 'none'
    const homeworkSet = openSet as { setId: string; title: string; remaining: number; at: number } | null

    let nextStep: CourseNextStep
    if (materials.total === 0) nextStep = { kind: 'upload' }
    else if (analysisStatus !== 'ready' && materials.processing > 0) nextStep = { kind: 'processing' }
    else if (analysisStatus === 'analyzing') nextStep = { kind: 'analyzing' }
    else if (analysisStatus !== 'ready') nextStep = { kind: 'analyze' }
    else if (openQuiz) nextStep = { kind: 'quiz', quizId: openQuiz.id, title: openQuiz.title }
    else if (homeworkSet)
      nextStep = {
        kind: 'homework',
        setId: homeworkSet.setId,
        title: homeworkSet.title,
        remaining: homeworkSet.remaining,
      }
    else if (mistakeStats.active > 0) nextStep = { kind: 'mistakes', count: mistakeStats.active }
    else
      nextStep = {
        kind: 'tutor',
        ...(latestSession?.topicId ? { topicId: latestSession.topicId } : {}),
        ...(latestSession ? { topicName: latestSession.topicName } : {}),
      }

    // Resume candidates: the newest of tutor / homework / an unfinished quiz.
    const candidates: ResumeItem[] = []
    const base = { projectId: project.id, projectName: project.name }
    if (latestSession)
      candidates.push({
        kind: 'tutor',
        ...base,
        at: latestSession.updatedAt,
        topicName: latestSession.topicName,
        ...(latestSession.topicId ? { topicId: latestSession.topicId } : {}),
      })
    if (homeworkSet)
      candidates.push({
        kind: 'homework',
        ...base,
        at: homeworkSet.at,
        setId: homeworkSet.setId,
        title: homeworkSet.title,
        remaining: homeworkSet.remaining,
      })
    if (openQuiz)
      candidates.push({
        kind: 'quiz',
        ...base,
        at: openQuiz.startedAt,
        quizId: openQuiz.id,
        title: openQuiz.title,
      })
    const resume = candidates.sort((a, b) => b.at - a.at)[0] ?? null

    const lastActivityAt = Math.max(
      project.updatedAt,
      latestSession?.updatedAt ?? 0,
      homeworkSet?.at ?? 0,
      lastQuizAt,
    )

    return {
      course: {
        project,
        materials,
        analysis: analysisStatus,
        topicCount: topics.length,
        homework: { questions, worked },
        activeMistakes: mistakeStats.active,
        weakPoints,
        lastActivityAt,
        nextStep,
      },
      resume,
    }
  }
}
