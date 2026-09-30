import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProjectFilesPage } from '@/pages/ProjectFilesPage'
import type { Document, LearningMaterialType } from '@/entities/document/types'

vi.mock('@/widgets/project/ProjectFlowNav', () => ({ ProjectFlowNav: () => <div /> }))

function doc(id: string, name: string, materialType: LearningMaterialType): Document {
  return {
    id,
    projectId: 'p1',
    type: 'text',
    materialType,
    name,
    sizeBytes: 100,
    hasBlob: false,
    status: 'ready',
    warnings: [],
    metadata: {},
    uploadedAt: 1,
  }
}

const DOCS: Document[] = [
  doc('d1', 'textbook.pdf', 'textbook'),
  doc('d2', 'my-notes.txt', 'user_notes'),
  doc('d3', 'lecture.docx', 'lecture_transcript'),
  doc('d4', 'practice.pdf', 'professor_practice'),
  doc('d5', 'homework.pdf', 'homework'),
]

vi.mock('@/features/documents/useDocuments', () => ({
  useDocuments: () => ({
    documents: DOCS,
    loading: false,
    loaded: true,
    error: null,
    refresh: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
  }),
}))

vi.mock('@/features/documents/documentsStore', () => ({
  useDocumentsStore: (selector: (state: { describeDelete: unknown }) => unknown) =>
    selector({ describeDelete: vi.fn() }),
}))

describe('ProjectFilesPage', () => {
  it('lists every material type, including homework and professor practice', () => {
    render(
      <MemoryRouter initialEntries={['/projects/p1/files']}>
        <Routes>
          <Route path="/projects/:id/files" element={<ProjectFilesPage />} />
        </Routes>
      </MemoryRouter>,
    )

    for (const name of ['textbook.pdf', 'my-notes.txt', 'lecture.docx', 'practice.pdf', 'homework.pdf']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    // The role is shown on each row, so a file can be identified at a glance.
    expect(screen.getByText('Homework')).toBeInTheDocument()
    expect(screen.getByText('Professor practice')).toBeInTheDocument()
  })

  it('offers a way through to the files hub copy and the full list title', () => {
    render(
      <MemoryRouter initialEntries={['/projects/p1/files']}>
        <Routes>
          <Route path="/projects/:id/files" element={<ProjectFilesPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Project files')).toBeInTheDocument()
  })
})
