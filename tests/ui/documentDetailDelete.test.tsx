import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DocumentDetailPage } from '@/pages/DocumentDetailPage'
import {
  setDocumentsServiceForTesting,
  useDocumentsStore,
} from '@/features/documents/documentsStore'
import { useProjectStore } from '@/features/project/projectStore'
import type { Document } from '@/entities/document/types'
import type { DocumentDeleteImpact, DocumentService } from '@/services/documentService'

const DOC = {
  id: 'd1',
  projectId: 'p1',
  type: 'pdf',
  name: 'week1.pdf',
  sizeBytes: 10,
  hasBlob: true,
  status: 'ready',
  warnings: [],
  metadata: {},
  uploadedAt: 1,
} as unknown as Document

function impact(blocked: boolean): DocumentDeleteImpact {
  return {
    document: DOC,
    removes: {
      chunks: 3,
      visualSources: 0,
      courseStructures: 0,
      homeworkSets: 0,
      homeworkQuestions: 0,
      practiceSets: 0,
      practiceQuestions: 0,
      slideLessons: 0,
    },
    studentWork: { homeworkAnswers: blocked ? 2 : 0, practiceAttempts: 0 },
    blocked,
  }
}

function setup(blocked: boolean) {
  const service = {
    getDeleteImpact: vi.fn(async () => impact(blocked)),
    delete: vi.fn(async () => undefined),
    get: vi.fn(async () => DOC),
    listByProject: vi.fn(async () => [DOC]),
  }
  setDocumentsServiceForTesting(service as unknown as DocumentService)
  useDocumentsStore.setState({
    byProject: { p1: [DOC] },
    loaded: { p1: true },
    singleStatus: { d1: 'found' },
  })
  render(
    <MemoryRouter initialEntries={['/projects/p1/documents/d1']}>
      <Routes>
        <Route path="/projects/:id" element={<div>Library</div>} />
        <Route path="/projects/:id/documents/:did" element={<DocumentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  return service
}

beforeEach(() => {
  useDocumentsStore.getState().reset()
  useProjectStore.setState({ projects: [], loaded: true, loading: false, error: null })
})

afterEach(() => {
  setDocumentsServiceForTesting(null)
})

describe('DocumentDetailPage delete', () => {
  it('deletes through the document service (not the raw repository)', async () => {
    const service = setup(false)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete document' }))
    expect(service.delete).toHaveBeenCalledWith('d1', 'p1')
    expect(await screen.findByText('Library')).toBeInTheDocument()
  })

  it('shows the blocked state and never deletes a file holding student work', async () => {
    const service = setup(true)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('This file has saved work')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete document' })).not.toBeInTheDocument()
    expect(service.delete).not.toHaveBeenCalled()
  })
})
