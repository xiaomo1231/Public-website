import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Document, LearningMaterialType } from '@/entities/document/types'
import type { Project } from '@/entities/project/types'
import { useDocumentsStore } from '@/features/documents/documentsStore'
import { FileManagerPage } from '@/pages/FileManagerPage'

const PROJECTS = [
  { id: 'p1', name: 'Physics 101', subject: 'physics' },
  { id: 'p2', name: 'Anatomy', subject: 'medicine' },
] as unknown as Project[]

vi.mock('@/features/project/useProjects', () => ({
  useProjects: () => ({ projects: PROJECTS, loading: false, loaded: true, error: null }),
  useProject: () => ({ project: null, loading: false, update: vi.fn(), remove: vi.fn() }),
}))

vi.mock('@/services/dataManagementService', () => ({
  DataManagementService: class {
    inventory = async () => ({ estimatedTotalBytes: 4096 })
  },
}))

const runDocumentBatch = vi.fn()
vi.mock('@/features/documents/documentBatch', () => ({
  runDocumentBatch: (...args: unknown[]) => runDocumentBatch(...args),
}))

function doc(
  id: string,
  projectId: string,
  name: string,
  materialType: LearningMaterialType,
  folderPath?: string,
): Document {
  return {
    id,
    projectId,
    type: 'pdf',
    materialType,
    name,
    sizeBytes: 1024,
    hasBlob: true,
    status: 'ready',
    warnings: [],
    metadata: {},
    uploadedAt: id.charCodeAt(1),
    ...(folderPath ? { folderPath } : {}),
  }
}

const DOCS: Record<string, Document[]> = {
  p1: [
    doc('a1', 'p1', 'Chapter 1.pdf', 'textbook', 'Week 1'),
    doc('a2', 'p1', 'HW1.pdf', 'homework', 'Week 1'),
    doc('a3', 'p1', 'Final 2023.pdf', 'past_exam'),
  ],
  p2: [doc('b1', 'p2', 'HW2.pdf', 'homework'), doc('b2', 'p2', 'Atlas.pdf', 'textbook')],
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <FileManagerPage />
    </MemoryRouter>,
  )
}

describe('FileManagerPage (设置 → 文件管理)', () => {
  beforeEach(() => {
    runDocumentBatch.mockReset()
    useDocumentsStore.setState({
      byProject: DOCS,
      loaded: { p1: true, p2: true },
      loading: {},
      refresh: vi.fn(async () => undefined),
    })
  })

  it('groups files by course with the subject, file count and size', () => {
    renderPage()
    const physics = document.querySelector('[data-course-group="p1"]') as HTMLElement
    const anatomy = document.querySelector('[data-course-group="p2"]') as HTMLElement
    expect(within(physics).getByText('Physics 101')).toBeInTheDocument()
    expect(within(physics).getByText('3 files · 3.0 KB')).toBeInTheDocument()
    expect(within(physics).getByText('Chapter 1.pdf')).toBeInTheDocument()
    expect(within(anatomy).getByText('Atlas.pdf')).toBeInTheDocument()
    // Inside a course: grouped by folder.
    expect(physics.querySelector('[data-folder-group="Week 1"]')).not.toBeNull()
    expect(screen.getByText(/5 files/)).toBeInTheDocument()
  })

  it('a global search hides courses without matches', () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('Search all files…'), {
      target: { value: 'atlas' },
    })
    expect(document.querySelector('[data-course-group="p1"]')).toBeNull()
    expect(screen.getByText('Atlas.pdf')).toBeInTheDocument()
  })

  it('groups within a course by material type', () => {
    renderPage()
    fireEvent.click(document.querySelector('[data-group-by="material"]')!)
    const physics = document.querySelector('[data-course-group="p1"]') as HTMLElement
    expect(physics.querySelector('[data-folder-group="past_exam"]')).not.toBeNull()
    expect(physics.querySelector('[data-folder-group="Week 1"]')).toBeNull()
  })

  it('selects across courses and says files only move within their own course', async () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('Search all files…'), {
      target: { value: 'hw' },
    })
    const selectAll = screen.getByLabelText('Select all 2 matching files')
    fireEvent.click(selectAll)
    expect(screen.getByText('2 selected in 2 courses')).toBeInTheDocument()
    expect(screen.getByText(/Moving files to another course isn't supported/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }))
    expect(document.querySelector('[data-cross-course-note]')?.textContent).toMatch(
      /cannot move to another course/,
    )
  })

  it('runs a batch delete and lists the skipped files with their reasons', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Select HW1.pdf'))
    fireEvent.click(screen.getByLabelText('Select HW2.pdf'))
    const [hw1, hw2] = [DOCS.p1![1]!, DOCS.p2![0]!]
    runDocumentBatch.mockResolvedValue({
      action: { kind: 'delete' },
      outcomes: [
        { document: hw1, status: 'done' },
        { document: hw2, status: 'skipped', reason: 'it has saved work (practice answers)' },
      ],
      done: 1,
      skipped: 1,
      failed: 0,
      stopped: false,
      projectIds: ['p1', 'p2'],
    })
    fireEvent.click(document.querySelector('[data-batch-delete]')!)
    fireEvent.click(document.querySelector('[data-batch-confirm]')!)

    await waitFor(() => expect(document.querySelector('[data-batch-summary]')).not.toBeNull())
    expect(runDocumentBatch.mock.calls[0]?.[0]).toHaveLength(2)
    expect(runDocumentBatch.mock.calls[0]?.[1]).toEqual({ kind: 'delete' })
    expect(document.querySelector('[data-batch-summary]')?.textContent).toMatch(
      /1 done · 1 skipped · 0 failed/,
    )
    expect(document.querySelector('[data-batch-issue="skipped"]')?.textContent).toMatch(
      /HW2\.pdf.*practice answers/,
    )
  })
})
