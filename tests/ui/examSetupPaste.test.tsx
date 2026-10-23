import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { ExamSetup } from '@/widgets/studyPlan/ExamSetup'
import { ExamMaterialsPicker } from '@/widgets/studyPlan/ExamMaterialsPicker'
import { useProjectStore } from '@/features/project/projectStore'
import { EMPTY_MATERIALS, type PlannedExamMaterials } from '@/entities/studyPlan/types'
import type { MaterialOption } from '@/services/studyPlanService'

// No AI provider: the paste is read on this device only.
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

/** The course list is read before the paste is (matching needs it). */
async function openPaste() {
  await waitFor(() => expect(useProjectStore.getState().loaded).toBe(true))
  fireEvent.click(await screen.findByRole('button', { name: 'Paste to fill in' }))
}

describe('粘贴识别 in the exam setup', () => {
  it('fills draft rows from a paste and saves nothing until 保存', async () => {
    const project = await new ProjectService(db).create({
      name: 'MATH 101 Calculus I',
      subject: 'calculus',
    })
    render(
      <MemoryRouter>
        <ExamSetup />
      </MemoryRouter>,
    )
    await openPaste()
    fireEvent.change(screen.getByLabelText('Pasted text'), {
      target: { value: 'MATH 101 Midterm: Nov 3, 2pm, Room 210\nMATH 101 Final exam: Dec 14 9:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))

    const drafts = await screen.findAllByRole('group', { name: /Exam \d/ })
    expect(drafts).toHaveLength(2)
    const first = within(drafts[0]!)
    await waitFor(() =>
      expect((first.getByLabelText('Course') as HTMLSelectElement).value).toBe(project.id),
    )
    expect((first.getByLabelText('Name') as HTMLInputElement).value).toBe('Midterm')
    expect((first.getByLabelText('Date') as HTMLInputElement).value).toMatch(/-11-03$/)
    expect((first.getByLabelText('Time') as HTMLInputElement).value).toBe('14:00')
    expect((first.getByLabelText('Location') as HTMLInputElement).value).toBe('Room 210')
    expect(await db.table('exams').count()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Save 2 exam(s)' }))
    await waitFor(async () => expect(await db.table('exams').count()).toBe(2))
    const saved = await db.table('exams').toArray()
    expect(saved.map((e) => e.name).sort()).toEqual(['Final exam', 'Midterm'])
    expect(saved.find((e) => e.name === 'Midterm')?.location).toBe('Room 210')
  })

  it('offers to create the course a paste names when none matches', async () => {
    await new ProjectService(db).create({ name: 'Physics', subject: 'physics' })
    render(
      <MemoryRouter>
        <ExamSetup />
      </MemoryRouter>,
    )
    await openPaste()
    fireEvent.change(screen.getByLabelText('Pasted text'), {
      target: { value: 'ECON 110 Midterm: Nov 3, 2pm' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))
    const create = await screen.findByRole('button', { name: 'Create the course “ECON 110”' })
    expect((screen.getByLabelText('Course') as HTMLSelectElement).value).toBe('')
    fireEvent.click(create)
    await waitFor(async () =>
      expect((await db.table('projects').toArray()).map((p) => p.name)).toContain('ECON 110'),
    )
    const econ = (await db.table('projects').toArray()).find((p) => p.name === 'ECON 110')!
    expect(econ.subject).toBe('economics')
    await waitFor(() =>
      expect((screen.getByLabelText('Course') as HTMLSelectElement).value).toBe(econ.id),
    )
  })
})

const FILES: MaterialOption[] = [
  {
    id: 'a',
    name: 'L1.pdf',
    folderPath: 'Week 1',
    materialType: 'textbook',
    status: 'ready',
    uploadedAt: 1,
  },
  {
    id: 'b',
    name: 'L2.pdf',
    folderPath: 'Week 1/Extra',
    materialType: 'textbook',
    status: 'ready',
    uploadedAt: 1,
  },
  { id: 'c', name: 'Midterm 2024.pdf', materialType: 'past_exam', status: 'ready', uploadedAt: 1 },
]

function Picker({ onValue }: { onValue: (m: PlannedExamMaterials) => void }) {
  const [value, setValue] = useState<PlannedExamMaterials>({ ...EMPTY_MATERIALS })
  return (
    <MemoryRouter>
      <ExamMaterialsPicker
        projectId="p1"
        idPrefix="t"
        documents={FILES}
        value={value}
        onChange={(next) => {
          setValue(next)
          onValue(next)
        }}
        onUploaded={() => undefined}
      />
    </MemoryRouter>
  )
}

describe('exam materials picker', () => {
  it('picks a whole folder (its files follow) and single files by type', () => {
    const seen: PlannedExamMaterials[] = []
    render(<Picker onValue={(m) => seen.push(m)} />)
    const week1 = document.querySelector('[data-folder-toggle="Week 1"]') as HTMLInputElement
    fireEvent.click(week1)
    expect(seen.at(-1)?.folderPaths).toEqual(['Week 1'])
    // Files in the folder (and its subfolder) are checked and locked to it.
    const l2 = screen.getByLabelText(/L2\.pdf/) as HTMLInputElement
    expect(l2.checked).toBe(true)
    expect(l2.disabled).toBe(true)
    const sub = document.querySelector('[data-folder-toggle="Week 1/Extra"]') as HTMLInputElement
    expect(sub.checked).toBe(true)
    expect(sub.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'By type' }))
    fireEvent.click(screen.getByLabelText(/Midterm 2024\.pdf/))
    expect(seen.at(-1)?.documentIds).toEqual(['c'])
    expect(screen.getByText(/3 file\(s\) · 1 folder\(s\) picked/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'L1' } })
    expect(screen.queryByText('Midterm 2024.pdf')).not.toBeInTheDocument()
  })
})
