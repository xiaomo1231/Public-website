import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * pdfjs cannot spawn its worker under jsdom, so the extractor is stubbed.
 * Everything else (document persistence, chunking, the batch queue) is real.
 */
vi.mock('@/infrastructure/files/pdfExtractor', () => ({
  extractPdf: async (blob: Blob) => {
    const text = await blob.text()
    if (text.startsWith('BROKEN')) throw new Error('PDF extraction failed')
    return {
      textLength: text.length,
      metadata: { pageCount: 1 },
      warnings: [],
      pages: [{ pageNumber: 1, text, headings: [] as Array<{ text: string }> }],
    }
  },
}))

const { ProjectService } = await import('@/services/projectService')
const { DocumentRepository } = await import('@/entities/document/repository')
const { getDb } = await import('@/infrastructure/db/database')
const { useProjectStore } = await import('@/features/project/projectStore')
const { useDocumentsStore } = await import('@/features/documents/documentsStore')
const { ProjectDetailPage } = await import('@/pages/ProjectDetailPage')

async function seedProject(): Promise<string> {
  const project = await new ProjectService().create({ name: 'Physics 101', subject: 'physics' })
  return project.id
}

function pdfFile(name: string, text = 'Derivative and integral notes'): File {
  return new File([text], name, { type: 'application/pdf' })
}

function brokenPdfFile(name: string): File {
  return new File(['BROKEN PDF'], name, { type: 'application/pdf' })
}

function renderProjectPage(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${id}`]}>
      <Routes>
        <Route path="/projects" element={<div>Projects list</div>} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input not found')
  return input
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Upload' }))
  return await screen.findByRole('dialog')
}

beforeEach(() => {
  useProjectStore.setState({
    projects: [],
    currentProjectId: null,
    loading: false,
    error: null,
    loaded: false,
  })
  useDocumentsStore.getState().reset()
})

describe('document upload entry points', () => {
  it('renders the Upload button when the project list is already loaded (normal app flow)', async () => {
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)

    expect(await screen.findByRole('button', { name: 'Upload' })).toBeInTheDocument()
  })

  it('renders the Upload button on a cold deep link (refresh / bookmark)', async () => {
    const id = await seedProject()
    renderProjectPage(id)

    expect(await screen.findByRole('button', { name: 'Upload' })).toBeInTheDocument()
    expect(screen.queryByText('Projects list')).not.toBeInTheDocument()
  })

  it('shows an empty-state call to action before any document exists', async () => {
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)

    expect(await screen.findByText('No content yet')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Upload your first document' }),
    ).toBeInTheDocument()
  })

  it('opens the batch upload dialog from the Upload button', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)

    const dialog = await openDialog(user)
    expect(within(dialog).getByText('Upload Documents')).toBeInTheDocument()
    expect(within(dialog).getByText('Drop files here or click to browse')).toBeInTheDocument()
  })

  it('opens the dialog from the empty-state button too', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)

    await user.click(await screen.findByRole('button', { name: 'Upload your first document' }))
    expect(await screen.findByText('Upload Documents')).toBeInTheDocument()
  })
})

describe('batch file selection', () => {
  it('queues a single file as a batch of one', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    await user.upload(fileInput(), pdfFile('Lecture 01.pdf'))

    expect(await within(dialog).findByText('Lecture 01.pdf')).toBeInTheDocument()
    expect(within(dialog).getByText('1 file selected')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Upload 1 file' })).toBeEnabled()
  })

  it('queues multiple files in one selection', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    await user.upload(fileInput(), [
      pdfFile('Lecture 01.pdf'),
      pdfFile('Lecture 02.pdf'),
      pdfFile('Lecture 03.pdf'),
    ])

    expect(await within(dialog).findByText('Lecture 01.pdf')).toBeInTheDocument()
    expect(within(dialog).getByText('Lecture 02.pdf')).toBeInTheDocument()
    expect(within(dialog).getByText('Lecture 03.pdf')).toBeInTheDocument()
    expect(within(dialog).getByText('3 files selected')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Upload 3 files' })).toBeEnabled()
  })

  it('keeps the queue empty for an empty selection', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    await user.upload(fileInput(), [])

    expect(within(dialog).getByText('No files selected yet')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Upload 0 files' })).toBeDisabled()
  })

  it('reports unsupported and oversized files individually without blocking the rest', async () => {
    // `applyAccept` is a global option; the real picker filters by `accept`,
    // but we still need to prove the queue rejects them defensively.
    const user = userEvent.setup({ applyAccept: false })
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    const huge = pdfFile('Huge.pdf')
    Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 + 1, configurable: true })

    await user.upload(fileInput(), [pdfFile('Lecture 01.pdf'), new File(['x'], 'notes.exe'), huge])

    expect(await within(dialog).findByText('Unsupported file type')).toBeInTheDocument()
    expect(within(dialog).getByText('File too large')).toBeInTheDocument()
    expect(within(dialog).getByText('Ready to upload: 1')).toBeInTheDocument()
    expect(within(dialog).getByText('Invalid files: 2')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Upload 1 file' })).toBeEnabled()
  })

  it('flags a file already present in the project as a duplicate', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()

    // Same name, size and lastModified as the file we are about to pick.
    const lastModified = 1_700_000_000_000
    const existing = pdfFile('Lecture 01.pdf')
    await new DocumentRepository(getDb()).create({
      projectId: id,
      type: 'pdf',
      name: existing.name,
      sizeBytes: existing.size,
      sourceModifiedAt: lastModified,
      blob: existing,
    })

    renderProjectPage(id)
    const dialog = await openDialog(user)
    const duplicate = pdfFile('Lecture 01.pdf')
    Object.defineProperty(duplicate, 'lastModified', { value: lastModified })
    await user.upload(fileInput(), duplicate)

    expect(await within(dialog).findByText('Already exists in this project')).toBeInTheDocument()
    expect(within(dialog).getByText('Duplicates: 1')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Upload 0 files' })).toBeDisabled()
  })

  it('removes an item from the queue', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    await user.upload(fileInput(), [pdfFile('Lecture 01.pdf'), pdfFile('Lecture 02.pdf')])
    await within(dialog).findByText('Lecture 01.pdf')

    const removeButtons = within(dialog).getAllByRole('button', { name: 'Remove' })
    await user.click(removeButtons[0]!)

    await waitFor(() => expect(within(dialog).getByText('1 file selected')).toBeInTheDocument())
  })
})

describe('batch upload execution', () => {
  it('uploads multiple files and each becomes its own document', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    await user.upload(fileInput(), [
      pdfFile('Lecture 01.pdf'),
      pdfFile('Lecture 02.pdf'),
      pdfFile('Lecture 03.pdf'),
    ])
    await within(dialog).findByText('Lecture 01.pdf')
    await user.click(within(dialog).getByRole('button', { name: 'Upload 3 files' }))

    expect(await within(dialog).findByText('Upload Complete')).toBeInTheDocument()
    expect(within(dialog).getByText('3 files uploaded successfully.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    await waitFor(async () => {
      const docs = await new DocumentRepository(getDb()).listByProject(id)
      expect(docs).toHaveLength(3)
    })
  })

  it('isolates a failure and offers a retry', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    await user.upload(fileInput(), [
      pdfFile('Lecture 01.pdf'),
      brokenPdfFile('Lecture 02.pdf'),
      pdfFile('Lecture 03.pdf'),
    ])
    await within(dialog).findByText('Lecture 01.pdf')
    await user.click(within(dialog).getByRole('button', { name: 'Upload 3 files' }))

    expect(await within(dialog).findByText('Upload Complete')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Retry Failed' })).toBeInTheDocument()

    const docs = await new DocumentRepository(getDb()).listByProject(id)
    expect(docs).toHaveLength(3)
    expect(docs.filter((d) => d.status === 'ready')).toHaveLength(2)
    expect(docs.filter((d) => d.status === 'failed')).toHaveLength(1)
  })

  it('cancels remaining queued files and keeps completed ones', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    await user.upload(fileInput(), [
      pdfFile('Lecture 01.pdf'),
      pdfFile('Lecture 02.pdf'),
      pdfFile('Lecture 03.pdf'),
      pdfFile('Lecture 04.pdf'),
    ])
    await within(dialog).findByText('Lecture 01.pdf')

    await user.click(within(dialog).getByRole('button', { name: 'Upload 4 files' }))
    // Cancel while the first two are still in flight.
    const cancel = await within(dialog).findByRole('button', { name: 'Cancel Remaining' })
    await user.click(cancel)

    expect(await within(dialog).findByText('Upload Complete')).toBeInTheDocument()
    expect(within(dialog).getByText(/skipped/)).toBeInTheDocument()

    const docs = await new DocumentRepository(getDb()).listByProject(id)
    expect(docs.length).toBeLessThanOrEqual(4)
    // Whatever completed was not rolled back.
    expect(docs.every((d) => d.status !== 'uploading')).toBe(true)
  })

  it('still supports the paste-text path', async () => {
    const user = userEvent.setup()
    const id = await seedProject()
    await useProjectStore.getState().load()
    renderProjectPage(id)
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByText('Paste text'))
    await user.type(within(dialog).getByLabelText('Course material'), 'Newton second law: F = ma')
    await user.click(within(dialog).getByRole('button', { name: 'Add and upload' }))

    expect(await within(dialog).findByText('Upload Complete')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(async () => {
      const docs = await new DocumentRepository(getDb()).listByProject(id)
      expect(docs).toHaveLength(1)
      expect(docs[0]?.type).toBe('text')
    })
  })
})
