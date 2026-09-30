import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HomeworkLandingPage } from '@/pages/HomeworkLandingPage'
import type { Document } from '@/entities/document/types'
import type { HomeworkSet } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'

const holder = vi.hoisted(() => ({
  service: null as unknown as HomeworkService,
  docs: [] as Document[],
  sets: [] as HomeworkSet[],
}))

vi.mock('@/features/homework/useHomeworkService', () => ({
  useHomeworkService: () => holder.service,
}))
vi.mock('@/entities/document/repository', () => ({
  DocumentRepository: class {
    async listByProject(): Promise<Document[]> {
      return holder.docs
    }
  },
}))
vi.mock('@/widgets/project/ProjectFlowNav', () => ({ ProjectFlowNav: () => <div /> }))
vi.mock('@/widgets/documents/DocumentUploadDialog', () => ({ DocumentUploadDialog: () => null }))

const DOC: Document = {
  id: 'd1',
  projectId: 'p1',
  type: 'pdf',
  materialType: 'homework',
  name: 'HW.pdf',
  sizeBytes: 0,
  hasBlob: false,
  status: 'ready',
  warnings: [],
  metadata: {},
  uploadedAt: 1,
}

function readySet(): HomeworkSet {
  return {
    id: 's1', projectId: 'p1', documentId: 'd1', documentName: 'HW.pdf', title: 'HW.pdf',
    status: 'ready', language: 'en', questionCount: 3, promptVersion: 'v1', createdAt: 1, updatedAt: 1,
  }
}

beforeEach(() => {
  holder.docs = [DOC]
  holder.sets = [readySet()]
  holder.service = {
    listSets: vi.fn(async () => holder.sets),
    createFromDocument: vi.fn(async () => holder.sets[0]!),
    retrySet: vi.fn(async () => ({ set: holder.sets[0]!, summary: {} })),
    isSetRunning: vi.fn(() => false),
    reconcileSets: vi.fn(async () => ({ removed: 0, ambiguous: [] })),
    deleteAssignment: vi.fn(async () => undefined),
  } as unknown as HomeworkService
})

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/projects/p1/homework']}>
      <Routes>
        <Route path="/projects/:id/homework" element={<HomeworkLandingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomeworkLandingPage card menu', () => {
  it('shows Refresh, Re-analyze and Delete on the card', async () => {
    renderPage()
    await screen.findByText('HW.pdf')

    const trigger = await screen.findByRole('button', { name: 'Assignment actions' })
    // Radix opens the menu from the keyboard; a synthetic pointerdown is not
    // enough in jsdom.
    fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })

    expect(await screen.findByRole('menuitem', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Re-analyze' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Upload professor answer' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('never auto-starts an analysis for an existing set on page entry', async () => {
    renderPage()
    await screen.findByText('HW.pdf')
    await screen.findByRole('button', { name: 'Assignment actions' })
    expect(holder.service.createFromDocument).not.toHaveBeenCalled()
    expect(holder.service.retrySet).not.toHaveBeenCalled()
  })

  it('starts exactly one re-analysis from the failed card, never on load', async () => {
    holder.sets = [{ ...readySet(), status: 'failed', errorMessage: 'AI request timed out' }]
    renderPage()

    const retry = await screen.findByRole('button', { name: 'Retry analysis' })
    // The failed card alone does not re-run the AI.
    expect(holder.service.retrySet).not.toHaveBeenCalled()

    fireEvent.click(retry)
    await waitFor(() => expect(holder.service.retrySet).toHaveBeenCalledTimes(1))
    expect(holder.service.retrySet).toHaveBeenCalledWith('s1')
  })

  it('does not start a re-analysis while one is already running', async () => {
    holder.sets = [{ ...readySet(), status: 'failed', errorMessage: 'AI request timed out' }]
    holder.service.isSetRunning = vi.fn(() => true)
    renderPage()

    const retry = await screen.findByRole('button', { name: 'Retry analysis' })
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    await new Promise((r) => setTimeout(r, 0))
    expect(holder.service.retrySet).not.toHaveBeenCalled()
  })

  it('shows a determinate progress bar with the real batch count while identifying', async () => {
    holder.sets = [
      {
        ...readySet(),
        status: 'analyzing',
        updatedAt: Date.now(),
        progress: { stage: 'identifying', completed: 1, total: 2, updatedAt: Date.now() },
      },
    ]
    renderPage()

    expect(await screen.findByText('Reading questions · batch 1 of 2')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '50')
  })

  it('shows an indeterminate bar while generating hints and solution', async () => {
    holder.sets = [
      {
        ...readySet(),
        status: 'analyzing',
        updatedAt: Date.now(),
        progress: { stage: 'generating', completed: 0, updatedAt: Date.now() },
      },
    ]
    renderPage()

    expect(await screen.findByText('Preparing hints and solution…')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    // No fabricated percentage: the total is not known yet.
    expect(bar).not.toHaveAttribute('aria-valuenow')
  })

  it('offers a retry instead of a spinner when an analysis looks interrupted', async () => {
    holder.sets = [
      { ...readySet(), status: 'analyzing', updatedAt: Date.now() - 10 * 60 * 1000 },
    ]
    renderPage()

    expect(await screen.findByText(/interrupted/i)).toBeInTheDocument()
    const buttons = await screen.findAllByRole('button', { name: 'Retry analysis' })
    expect(buttons.length).toBeGreaterThan(0)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
