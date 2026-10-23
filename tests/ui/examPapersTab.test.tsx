import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { StudyPlanService } from '@/services/studyPlanService'
import { useProjectStore } from '@/features/project/projectStore'
import { ExamWorkspacePage } from '@/pages/ExamWorkspacePage'
import { paperEntryLinks } from '@/widgets/examWorkspace/examLinks'
import { RECOGNITION_STALE_MS } from '@/services/homeworkService'

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

function set(
  id: string,
  fields: Record<string, unknown> & { projectId: string; documentId: string },
): Record<string, unknown> {
  return {
    id,
    documentName: `${id}.pdf`,
    title: id,
    status: 'ready',
    language: 'en',
    questionCount: 2,
    promptVersion: 'v3',
    createdAt: 1,
    updatedAt: Date.now(),
    ...fields,
  }
}

function doc(id: string, projectId: string, fields: Record<string, unknown>) {
  return {
    id,
    projectId,
    type: 'pdf',
    name: `${id}.pdf`,
    sizeBytes: 10,
    hasBlob: false,
    status: 'ready',
    warnings: [],
    metadata: {},
    uploadedAt: 1,
    ...fields,
  }
}

async function seed() {
  const project = await new ProjectService(db).create({ name: 'ECON 111', subject: 'economics' })
  const pid = project.id
  const plans = new StudyPlanService({ db })
  const [exam] = await plans.addExams([
    { projectId: pid, name: 'Midterm', at: Date.now() + 10 * DAY },
  ])
  await db
    .table('documents')
    .bulkPut([
      doc('d-ready', pid, { materialType: 'past_exam' }),
      doc('d-paused', pid, { materialType: 'past_exam' }),
      doc('d-stale', pid, { materialType: 'past_exam' }),
      doc('d-failed', pid, { materialType: 'past_exam' }),
      doc('d-extracting', pid, { materialType: 'past_exam', status: 'processing' }),
      doc('d-new', pid, { materialType: 'past_exam' }),
      doc('d-hw', pid, { materialType: 'homework' }),
      doc('d-hw-other', pid, { materialType: 'homework' }),
    ])
  await db.table('homeworkSets').bulkPut([
    set('paper-ready', { projectId: pid, documentId: 'd-ready', kind: 'exam' }),
    set('paper-paused', {
      projectId: pid,
      documentId: 'd-paused',
      kind: 'exam',
      status: 'paused',
      questionCount: 0,
      progress: { stage: 'identifying', completed: 1, total: 3, updatedAt: 1 },
    }),
    set('paper-stale', {
      projectId: pid,
      documentId: 'd-stale',
      kind: 'exam',
      status: 'analyzing',
      questionCount: 0,
      progress: { stage: 'identifying', completed: 0, total: 3, updatedAt: 1 },
      updatedAt: Date.now() - RECOGNITION_STALE_MS - 5_000,
    }),
    set('paper-failed', {
      projectId: pid,
      documentId: 'd-failed',
      kind: 'exam',
      status: 'failed',
      questionCount: 0,
      errorMessage: 'The model did not answer.',
    }),
    set('hw', { projectId: pid, documentId: 'd-hw', kind: 'assignment' }),
    set('hw-other', { projectId: pid, documentId: 'd-hw-other', kind: 'assignment' }),
  ])
  await db.table('homeworkQuestions').bulkPut([
    {
      id: 'q1',
      setId: 'paper-ready',
      projectId: pid,
      order: 0,
      number: '1',
      prompt: 'Q1',
      answerStatus: 'matched',
      answerSource: 'inline',
      answerText: 'x = 2',
    },
    { id: 'q2', setId: 'paper-ready', projectId: pid, order: 1, number: '2', prompt: 'Q2' },
  ])
  await plans.updateExam(exam!.id, {
    materials: {
      pastExamSetIds: ['paper-ready'],
      reviewDocumentIds: [],
      practiceSetIds: [],
      homeworkSetIds: ['hw'],
    },
  })
  return { pid, exam: exam! }
}

function renderPapers(examId: string) {
  return render(
    <MemoryRouter initialEntries={[`/plan/exams/${examId}?tab=papers`]}>
      <Routes>
        <Route path="/plan/exams/:examId" element={<ExamWorkspacePage />} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const row = (id: string) => document.querySelector(`[data-paper-row="${id}"]`) as HTMLElement

describe('考题与讲解 tab', () => {
  it('lists papers in every state with their controls, never the empty state', async () => {
    const { exam } = await seed()
    renderPapers(exam.id)
    expect(await screen.findByRole('tab', { name: 'Papers & walkthroughs' })).toBeInTheDocument()
    await waitFor(() => expect(row('paper-ready')).toBeTruthy())
    expect(screen.queryByText('No past paper yet')).toBeNull()

    // Ready: entries back to the workspace, the inline answers counted.
    const ready = row('paper-ready')
    expect(within(ready).getByText(/printed in the paper/)).toBeInTheDocument()
    const entries = [...ready.querySelectorAll('[data-paper-entry]')].map((el) =>
      el.getAttribute('data-paper-entry'),
    )
    expect(entries).toEqual(['mock', 'walkthrough', 'practice', 'guided', 'proofread'])
    expect(ready.querySelector('[data-paper-entry="walkthrough"]')).toHaveAttribute(
      'href',
      `/projects/${exam.projectId}/homework/paper-ready?view=walkthrough&fromExam=${exam.id}`,
    )

    // Paused: its progress and 继续.
    const paused = row('paper-paused')
    expect(paused.querySelector('[data-paper-paused]')).toBeTruthy()
    expect(within(paused).getByRole('button', { name: 'Continue' })).toBeInTheDocument()

    // Interrupted (no run, no heartbeat): recovered as paused, not a frozen bar.
    await waitFor(() => expect(row('paper-stale')).toHaveAttribute('data-paper-status', 'paused'))
    expect((await db.table('homeworkSets').get('paper-stale')).status).toBe('paused')

    // Failed: the reason and 重新识别.
    const failed = row('paper-failed')
    expect(within(failed).getByText('The model did not answer.')).toBeInTheDocument()
    expect(within(failed).getByRole('button', { name: 'Retry analysis' })).toBeInTheDocument()

    // Still being extracted: shown, waiting.
    const extracting = document.querySelector('[data-paper-pending="d-extracting"]') as HTMLElement
    expect(within(extracting).getByText('Reading the file…')).toBeInTheDocument()

    // Homework picked for the exam (and only that one), with its entries.
    const homework = row('hw')
    expect(homework).toHaveAttribute('data-paper-kind', 'homework')
    expect(homework.querySelector('[data-paper-entry="mock"]')).toBeNull()
    expect(homework.querySelector('[data-paper-entry="guided"]')).toHaveAttribute(
      'href',
      `/projects/${exam.projectId}/homework/hw?view=guided&fromExam=${exam.id}`,
    )
    expect(row('hw-other')).toBeNull()
  })

  it('reads a past paper with no set yet (recognition starts here too)', async () => {
    const { exam } = await seed()
    renderPapers(exam.id)
    // No AI and no text: the read starts, then fails with a reason (not stuck).
    await waitFor(async () => {
      const sets = await db.table('homeworkSets').where('documentId').equals('d-new').toArray()
      expect(sets).toHaveLength(1)
      expect(sets[0].status).toBe('failed')
    })
    await waitFor(() => expect(document.querySelector('[data-paper-pending="d-new"]')).toBeNull())
  })

  it('builds the entry links with fromExam', () => {
    const exam = { id: 'e1', projectId: 'p1' }
    const links = paperEntryLinks(exam, { set: { id: 's1', status: 'ready' }, kind: 'exam' })
    expect(links.map((link) => link.to)).toEqual([
      '/projects/p1/homework/s1/exam?fromExam=e1',
      '/projects/p1/homework/s1?view=walkthrough&fromExam=e1',
      '/projects/p1/homework/s1?fromExam=e1',
      '/projects/p1/homework/s1?view=guided&fromExam=e1',
      '/projects/p1/homework/s1?view=proofread&fromExam=e1',
    ])
    expect(
      paperEntryLinks(exam, { set: { id: 's1', status: 'paused' }, kind: 'exam' }).map(
        (link) => link.key,
      ),
    ).not.toContain('mock')
  })
})
