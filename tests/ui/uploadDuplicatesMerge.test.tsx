import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// pdf.js cannot run under jsdom; a "PDF" here is its text.
vi.mock('@/infrastructure/files/pdfExtractor', () => ({
  extractPdf: async (blob: Blob) => {
    const text = await blob.text()
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

const LAST_MODIFIED = 1_700_000_000_000

function pdfFile(name: string, text = 'Supply and demand notes'): File {
  const file = new File([text], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'lastModified', { value: LAST_MODIFIED })
  return file
}

async function seed(existing: string[] = []): Promise<string> {
  const project = await new ProjectService().create({ name: 'ECON 110', subject: 'economics' })
  for (const name of existing) {
    const file = pdfFile(name)
    const repo = new DocumentRepository(getDb())
    const doc = await repo.create({
      projectId: project.id,
      type: 'pdf',
      name,
      sizeBytes: file.size,
      sourceModifiedAt: LAST_MODIFIED,
      blob: file,
    })
    await repo.update(doc.id, { status: 'ready' })
  }
  await useProjectStore.getState().load()
  return project.id
}

function renderPage(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${id}`]}>
      <Routes>
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
  await user.click(await screen.findByRole('button', { name: 'Upload Textbook' }))
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

describe('上传重复文件可选', () => {
  it('keeps both: uploads the duplicate as "name (2).ext"', async () => {
    const user = userEvent.setup()
    const id = await seed(['Lecture 01.pdf'])
    renderPage(id)
    const dialog = await openDialog(user)
    await user.upload(fileInput(), pdfFile('Lecture 01.pdf'))

    const group = await within(dialog).findByRole('group', { name: /Lecture 01\.pdf/ })
    expect(within(dialog).getByRole('button', { name: 'Upload 0 files' })).toBeDisabled()
    await user.click(within(group).getByRole('button', { name: 'Keep both' }))
    expect(within(dialog).getByText('Will be saved as Lecture 01 (2).pdf')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Upload 1 file' }))

    expect(await within(dialog).findByText('Upload Complete')).toBeInTheDocument()
    const names = (await new DocumentRepository(getDb()).listByProject(id)).map((d) => d.name)
    expect(names.sort()).toEqual(['Lecture 01 (2).pdf', 'Lecture 01.pdf'])
  })

  it('replaces the stored file, keeping its id', async () => {
    const user = userEvent.setup()
    const id = await seed(['Lecture 01.pdf'])
    const [before] = await new DocumentRepository(getDb()).listByProject(id)
    renderPage(id)
    const dialog = await openDialog(user)
    await user.upload(fileInput(), pdfFile('Lecture 01.pdf'))

    const group = await within(dialog).findByRole('group', { name: /Lecture 01\.pdf/ })
    await user.click(within(group).getByRole('button', { name: 'Replace' }))
    await user.click(within(dialog).getByRole('button', { name: 'Upload 1 file' }))

    expect(await within(dialog).findByText('Replaced the stored file')).toBeInTheDocument()
    const after = await new DocumentRepository(getDb()).listByProject(id)
    expect(after.map((d) => d.id)).toEqual([before!.id])
    expect(after[0]!.status).toBe('ready')
  })

  it('全部覆盖 / 全部跳过 apply to every duplicate', async () => {
    const user = userEvent.setup()
    const id = await seed(['A.pdf', 'B.pdf'])
    renderPage(id)
    const dialog = await openDialog(user)
    await user.upload(fileInput(), [pdfFile('A.pdf'), pdfFile('B.pdf')])

    await user.click(await within(dialog).findByRole('button', { name: 'Replace all' }))
    expect(within(dialog).getByRole('button', { name: 'Upload 2 files' })).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: 'Skip all' }))
    expect(within(dialog).getByRole('button', { name: 'Upload 0 files' })).toBeDisabled()
  })
})

describe('考卷照片合并', () => {
  it('offers to merge numbered photos into one paper (on by default)', async () => {
    const user = userEvent.setup()
    const id = await seed()
    renderPage(id)
    const dialog = await openDialog(user)
    const photos = ['选择题 02.jpg', '选择题 01.jpg', '选择题 03.jpg'].map(
      (name) => new File(['x'], name, { type: 'image/jpeg' }),
    )
    await user.upload(fileInput(), photos)

    const toggle = await within(dialog).findByRole('checkbox', { name: /Merge into one paper/ })
    expect(toggle).toBeChecked()
    expect(within(dialog).getByText('选择题.pdf')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Upload 1 file' })).toBeEnabled()
    // The merged name suggests a past paper.
    expect(within(dialog).getByRole('button', { name: /Mark as "Past exam/ })).toBeInTheDocument()

    await user.click(toggle)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Upload 3 files' })).toBeEnabled(),
    )
    expect(within(dialog).getByText('选择题 01.jpg')).toBeInTheDocument()
  })
})
