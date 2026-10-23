import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { StudyPlanService } from '@/services/studyPlanService'
import { MistakeRepository } from '@/entities/mistake/repository'
import { useProjectStore } from '@/features/project/projectStore'
import { ExamWorkspacePage } from '@/pages/ExamWorkspacePage'
import { ExamSetup } from '@/widgets/studyPlan/ExamSetup'
import { CountdownBar } from '@/widgets/studyPlan/CountdownBar'
import { CourseExamsPanel } from '@/widgets/examWorkspace/CourseExamsPanel'
import { FocusPageHeader } from '@/widgets/focus/FocusPageHeader'
import { QuizConfigDialog } from '@/widgets/quiz/QuizConfigDialog'
import {
  examDiagnosticLink,
  examOralLink,
  examQuizLink,
  examVocabLink,
} from '@/widgets/examWorkspace/examLinks'
import { examReturnId, withExamReturn, withParams } from '@/features/studyPlan/examReturn'
import { routes } from '@/app/router'
import type { QuizConfig } from '@/entities/quiz/types'
import { OralExamService } from '@/services/oralExamService'
import { DiagnosticPanel } from '@/widgets/studyPlan/DiagnosticPanel'
import type { AIService } from '@/services/aiService'

vi.mock('@/services/aiServices', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildAIServices: async () => null,
}))

let db: AppDatabase
const DAY = 86_400_000

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  useProjectStore.setState({ projects: [], loaded: false, loading: false, error: null })
})
afterEach(() => db.close())

async function seed() {
  const project = await new ProjectService(db).create({ name: 'ECON 111', subject: 'economics' })
  await db.table('courseAnalyses').put({
    id: `a-${project.id}`,
    projectId: project.id,
    status: 'ready',
    documentIds: [],
    language: 'en',
  })
  await db.table('topics').bulkPut(
    ['Supply', 'Demand', 'Elasticity'].map((name, i) => ({
      id: `t-${name}`,
      projectId: project.id,
      name,
      description: '',
      order: i,
      sourceRefs: [],
    })),
  )
  const plans = new StudyPlanService({ db })
  const [exam, other] = await plans.addExams([
    {
      projectId: project.id,
      name: 'Midterm',
      at: Date.now() + 10 * DAY,
      scope: { kind: 'topics', topicIds: ['t-Supply', 't-Demand'] },
    },
    { projectId: project.id, name: 'Final', at: Date.now() + 40 * DAY },
  ])
  await plans.replan()
  // A mistake in scope (re-test due) and one outside it.
  const mistakes = new MistakeRepository(db)
  const inScope = await mistakes.add({
    projectId: project.id,
    topicId: 't-Supply',
    knowledgePoint: 'Supply',
    difficulty: 'basic',
    questionType: 'numeric',
    question: 'Shift of the supply curve?',
    studentAnswer: 'left',
    correctAnswer: 'right',
  })
  await db
    .table('mistakes')
    .update(inScope.id, { followUp: { stage: 0, dueAt: Date.now() - 1000, history: [], seen: [] } })
  await mistakes.add({
    projectId: project.id,
    topicId: 't-Elasticity',
    knowledgePoint: 'Elasticity',
    difficulty: 'basic',
    questionType: 'numeric',
    question: 'Price elasticity outside scope',
    studentAnswer: '1',
    correctAnswer: '2',
  })
  // A past paper picked for the exam.
  const doc = { id: 'doc-paper', projectId: project.id }
  await db.table('homeworkSets').put({
    id: 'set-paper',
    projectId: project.id,
    documentId: doc.id,
    documentName: 'Midterm 2025.pdf',
    title: 'Midterm 2025',
    kind: 'exam',
    status: 'ready',
    language: 'en',
    questionCount: 2,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  })
  await db.table('homeworkQuestions').bulkPut([
    {
      id: 'q1',
      setId: 'set-paper',
      projectId: project.id,
      order: 0,
      number: '1',
      prompt: 'Q1',
      verifiedAt: 5,
    },
    { id: 'q2', setId: 'set-paper', projectId: project.id, order: 1, number: '2', prompt: 'Q2' },
  ])
  await plans.updateExam(exam!.id, {
    materials: {
      pastExamSetIds: ['set-paper'],
      reviewDocumentIds: [],
      practiceSetIds: [],
      homeworkSetIds: [],
    },
  })
  return { project, exam: exam!, other: other!, inScopeId: inScope.id }
}

function LocationProbe(): JSX.Element {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderWorkspace(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/plan/exams/:examId" element={<ExamWorkspacePage />} />
        <Route path="/plan" element={<div>Plan page</div>} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('exam workspace links', () => {
  it('registers the lazy route and builds pre-filled links', () => {
    const shell = routes.find((route) => route.path === '/')!
    const paths = shell.children!.flatMap((child) => child.children ?? []).map((r) => r.path)
    expect(paths).toContain('plan/exams/:examId')

    const exam = { id: 'e1', projectId: 'p1' }
    expect(examQuizLink(exam, {})).toBe('/projects/p1/quiz?fromExam=e1&examId=e1')
    expect(examOralLink(exam, { syllabus: { documentId: 'd', scopeId: 's' } })).toBe(
      '/projects/p1/quiz?fromExam=e1&examId=e1&examDoc=d&examScope=s&oral=1',
    )
    expect(examVocabLink(exam)).toBe('/vocab?examId=e1&fromExam=e1')
    expect(examDiagnosticLink(exam)).toBe('/plan?tab=diagnostic&examId=e1')
    expect(withExamReturn('/projects/p1/tutor/t#x', 'e1')).toBe(
      '/projects/p1/tutor/t?fromExam=e1#x',
    )
    expect(withParams('/a?b=1', { c: '2', d: undefined })).toBe('/a?b=1&c=2')
    expect(examReturnId('?fromExam=e9')).toBe('e9')
  })

  it('resolves an exam scope for other pages (topics, files)', async () => {
    const { exam } = await seed()
    const link = await new StudyPlanService({ db }).examLink(exam.id)
    expect(link.restricted).toBe(true)
    expect(link.topicIds.sort()).toEqual(['t-Demand', 't-Supply'])
  })

  it('enters from the exam list, the countdown bar and the course 考试 tab', async () => {
    const { project, exam } = await seed()
    render(
      <MemoryRouter>
        <ExamSetup projectId={project.id} />
        <CountdownBar />
        <CourseExamsPanel projectId={project.id} />
      </MemoryRouter>,
    )
    const row = (await screen.findAllByText('Midterm'))[0]!.closest(
      '[data-exam-row]',
    ) as HTMLElement
    expect(within(row).getByRole('link', { name: 'Midterm' })).toHaveAttribute(
      'href',
      `/plan/exams/${exam.id}`,
    )
    expect(
      within(row).getByRole('link', { name: 'Open the workspace of Midterm' }),
    ).toHaveAttribute('href', `/plan/exams/${exam.id}`)
    await waitFor(() =>
      expect(document.querySelector('[data-countdown]')).toHaveAttribute(
        'href',
        `/plan/exams/${exam.id}`,
      ),
    )
    const course = await waitFor(() => {
      const el = document.querySelector(`[data-course-exam="${exam.id}"]`) as HTMLElement
      expect(el).toBeTruthy()
      return el
    })
    expect(within(course).getByRole('link', { name: 'Midterm' })).toHaveAttribute(
      'href',
      `/plan/exams/${exam.id}`,
    )
  })
})

describe('exam workspace page', () => {
  it('shows the overview with readiness, today, weak spots and pre-filled quick starts', async () => {
    const { exam } = await seed()
    renderWorkspace(`/plan/exams/${exam.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Midterm' })).toBeInTheDocument()
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Midterm · ECON 111')
    expect(document.querySelector('[data-workspace-readiness]')).toBeTruthy()
    expect(screen.getByText('1 re-test(s) due today', { exact: false })).toBeInTheDocument()
    const quick = document.querySelector('[data-workspace-quick]') as HTMLElement
    expect(within(quick).getByRole('link', { name: 'Practise this exam’s scope' })).toHaveAttribute(
      'href',
      `/projects/${exam.projectId}/quiz?fromExam=${exam.id}&examId=${exam.id}`,
    )
    expect(within(quick).getByRole('link', { name: 'Start a mock exam' })).toHaveAttribute(
      'href',
      `/projects/${exam.projectId}/homework/set-paper/exam?fromExam=${exam.id}`,
    )
    expect(within(quick).getByRole('link', { name: 'Diagnostic paper' })).toHaveAttribute(
      'href',
      `/plan?tab=diagnostic&examId=${exam.id}`,
    )
    // Topics in scope only (Elasticity is outside it).
    const topics = document.querySelector('[data-workspace-topics]') as HTMLElement
    expect(within(topics).getByText('Supply')).toBeInTheDocument()
    expect(within(topics).queryByText('Elasticity')).toBeNull()
  })

  it('lists papers, this exam’s tasks by day and the mistakes in scope', async () => {
    const { exam, inScopeId } = await seed()
    renderWorkspace(`/plan/exams/${exam.id}?tab=papers`)
    const paper = await waitFor(() => {
      const el = document.querySelector('[data-paper-row="set-paper"]') as HTMLElement
      expect(el).toBeTruthy()
      return el
    })
    expect(paper).toHaveAttribute('data-paper-picked', 'true')
    expect(within(paper).getByText(/proofread 1 \/ 2/)).toBeInTheDocument()
    expect(within(paper).getByRole('link', { name: 'Proofread' })).toHaveAttribute(
      'href',
      `/projects/${exam.projectId}/homework/set-paper?view=proofread&fromExam=${exam.id}`,
    )

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Timeline' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    await waitFor(() => expect(document.querySelector('[data-workspace-timeline]')).toBeTruthy())
    const tasks = await db.table('studyTasks').where('examId').equals(exam.id).toArray()
    expect(tasks.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('[data-timeline-day]').length).toBeGreaterThan(0)

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Mistakes & mastery/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Mistakes & mastery/ }))
    await waitFor(() =>
      expect(document.querySelector(`[data-mistake-row="${inScopeId}"]`)).toBeTruthy(),
    )
    expect(screen.queryByText('Price elasticity outside scope')).toBeNull()
    expect(screen.getByTestId('location').textContent).toContain('tab=mistakes')
  })

  it('switches to another exam and deletes one', async () => {
    const { exam, other } = await seed()
    renderWorkspace(`/plan/exams/${exam.id}`)
    const switcher = (await screen.findByLabelText('Switch to another exam')) as HTMLSelectElement
    fireEvent.change(switcher, { target: { value: other.id } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Final' })).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe(`/plan/exams/${other.id}`)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Final' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Plan page')).toBeInTheDocument()
    expect(await db.table('exams').get(other.id)).toBeUndefined()
  })

  it('shows “not found” for an unknown exam', async () => {
    renderWorkspace('/plan/exams/nope')
    expect(await screen.findByText('Exam not found')).toBeInTheDocument()
  })
})

describe('pages opened from the workspace', () => {
  it('focus pages lead back to the exam', async () => {
    const { exam } = await seed()
    render(
      <MemoryRouter initialEntries={[`/projects/x/homework/h?fromExam=${exam.id}`]}>
        <FocusPageHeader backTo="/projects/x/homework" backLabel="Homework" title="HW4" />
      </MemoryRouter>,
    )
    const back = await screen.findByRole('link', { name: /Midterm · ECON 111/ })
    expect(back).toHaveAttribute('href', `/plan/exams/${exam.id}`)
  })

  it('the quiz setup quizzes the exam’s topics', async () => {
    const { project, exam } = await seed()
    useProjectStore.setState({
      projects: [(await new ProjectService(db).list())[0]!],
      loaded: true,
      loading: false,
      error: null,
    })
    const started: QuizConfig[] = []
    render(
      <MemoryRouter initialEntries={[`/projects/${project.id}/quiz?examId=${exam.id}`]}>
        <QuizConfigDialog projectId={project.id} onStart={(config) => started.push(config)} />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/For Midterm: questions from its 2 topics/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Generate Quiz' }))
    expect(started[0]?.mode).toBe('mixed')
    expect([...(started[0]?.topicIds ?? [])].sort()).toEqual(['t-Demand', 't-Supply'])
  })

  it('the oral rehearsal draws only from the exam’s topics', async () => {
    const { project } = await seed()
    const oral = new OralExamService({ ai: {} as AIService, db })
    const draws = await oral.drawTopics(project.id, {
      mode: 'oral',
      count: 5,
      difficulty: 'intermediate',
      types: ['short_answer'],
      topicIds: ['t-Demand'],
    })
    expect(draws.map((draw) => draw.topicIds)).toEqual([['t-Demand']])
  })

  it('the diagnostic paper ticks only the exam it was opened for', async () => {
    const { exam } = await seed()
    render(
      <MemoryRouter>
        <DiagnosticPanel examId={exam.id} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBe(2))
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.filter((box) => box.checked)).toHaveLength(1)
  })
})
