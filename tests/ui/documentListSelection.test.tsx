import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Document } from '@/entities/document/types'
import { DocumentList } from '@/widgets/documents/DocumentList'
import { useDocumentSelection } from '@/features/documents/useDocumentSelection'

vi.mock('@/features/project/useProjects', () => ({
  useProject: () => ({ project: null, loading: false, update: vi.fn(), remove: vi.fn() }),
}))

function doc(id: string, name: string, uploadedAt: number): Document {
  return {
    id,
    projectId: 'p1',
    type: 'pdf',
    materialType: 'textbook',
    name,
    sizeBytes: 10,
    hasBlob: true,
    status: 'ready',
    warnings: [],
    metadata: {},
    uploadedAt,
  }
}

// Newest first: a, b, c, d.
const DOCS = [
  doc('a', 'A.pdf', 4),
  doc('b', 'B.pdf', 3),
  doc('c', 'C.pdf', 2),
  doc('d', 'Hw.pdf', 1),
]

function Harness(): JSX.Element {
  const selection = useDocumentSelection()
  return (
    <MemoryRouter>
      <DocumentList
        documents={DOCS}
        loading={false}
        projectId="p1"
        onUploadClick={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        selection={selection}
      />
    </MemoryRouter>
  )
}

const box = (name: string) => screen.getByLabelText(`Select ${name}`) as HTMLInputElement
const count = () => document.querySelector('[data-batch-count]')?.textContent ?? ''

describe('DocumentList multi-select', () => {
  it('Shift-click selects the range; the header selects the filtered rows only', () => {
    render(<Harness />)
    fireEvent.click(box('A.pdf'))
    fireEvent.click(box('C.pdf'), { shiftKey: true })
    expect([box('A.pdf'), box('B.pdf'), box('C.pdf')].every((b) => b.checked)).toBe(true)
    expect(box('Hw.pdf').checked).toBe(false)
    expect(count()).toBe('3 selected')

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'hw' } })
    const header = screen.getByLabelText('Select all 1 shown') as HTMLInputElement
    expect(header.checked).toBe(false)
    fireEvent.click(header)
    expect(count()).toBe('4 selected')
  })

  it('Ctrl+A selects all shown, Esc clears, Space on a row toggles it', () => {
    render(<Harness />)
    fireEvent.keyDown(box('A.pdf'), { key: 'a', ctrlKey: true })
    expect(count()).toBe('4 selected')
    fireEvent.keyDown(box('C.pdf'), { key: 'Escape' })
    expect(document.querySelector('[data-batch-bar]')).toBeNull()

    const link = screen.getByRole('link', { name: 'B.pdf' })
    fireEvent.keyDown(link, { key: ' ' })
    expect(box('B.pdf').checked).toBe(true)
    fireEvent.keyDown(link, { key: ' ' })
    expect(box('B.pdf').checked).toBe(false)
  })
})
