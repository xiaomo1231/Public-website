import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { StudyPlanService } from '@/services/studyPlanService'
import { DocumentRepository } from '@/entities/document/repository'
import { ExamSetup } from '@/widgets/studyPlan/ExamSetup'
import { useProjectStore } from '@/features/project/projectStore'

vi.mock('@/services/aiServices', () => ({
  buildAIServices: async () => {
    throw new Error('no provider')
  },
}))

let db: AppDatabase
beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
  useProjectStore.setState({ projects: [], loaded: false, loading: false, error: null })
})
afterEach(() => db.close())

describe('editing a saved exam in the exam setup', () => {
  it('changes name, date and scope in place; the course stays', async () => {
    const project = await new ProjectService(db).create({ name: 'ECON 110', subject: 'economics' })
    const docs = new DocumentRepository(db)
    const slides = await docs.create({
      projectId: project.id,
      type: 'pptx',
      name: 'Lecture 1.pptx',
      sizeBytes: 1,
      materialType: 'textbook',
    })
    await docs.update(slides.id, { status: 'ready' })
    const at = new Date(2030, 10, 3, 14, 0).getTime()
    const [exam] = await new StudyPlanService({ db }).addExams([
      { projectId: project.id, name: 'Midterm', at },
    ])

    render(
      <MemoryRouter>
        <ExamSetup projectId={project.id} />
      </MemoryRouter>,
    )
    const row = await screen.findByText('Midterm')
    const item = row.closest('[data-exam-row]') as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: 'Edit' }))
    await within(item).findByText(/the course can’t be changed/)
    const name = within(item).getByLabelText('Name') as HTMLInputElement
    expect(name.value).toBe('Midterm')
    expect((within(item).getByLabelText('Time') as HTMLInputElement).value).toBe('14:00')
    fireEvent.change(name, { target: { value: 'Midterm 1' } })
    fireEvent.change(within(item).getByLabelText('Date'), { target: { value: '2030-11-05' } })
    fireEvent.change(within(item).getByLabelText('What the exam covers'), {
      target: { value: 'chapters' },
    })
    fireEvent.click(within(item).getByRole('checkbox', { name: /Lecture 1\.pptx\s*Whole file/ }))
    fireEvent.click(within(item).getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const saved = await db.table('exams').get(exam!.id)
      expect(saved?.name).toBe('Midterm 1')
    })
    const saved = await db.table('exams').get(exam!.id)
    expect(saved.projectId).toBe(project.id)
    expect(saved.scope).toEqual({ kind: 'chapters', chapterIds: [], documentIds: [slides.id] })
    expect(new Date(saved.at).getDate()).toBe(5)
    expect(new Date(saved.at).getHours()).toBe(14)
    expect(await db.table('exams').count()).toBe(1)
  })
})
