import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SourceReader } from '@/widgets/source/SourceReader'
import { ChunkPreview } from '@/widgets/documents/ChunkPreview'
import { Toaster } from '@/shared/ui/Toast'
import type { DocumentChunk } from '@/entities/chunk/types'

const LONG_NAME =
  'Calculus_Lecture_Week_03_Derivatives_and_Applications_Review_Materials_2026_Final_Version.pdf'

function chunk(overrides: Partial<DocumentChunk> = {}): DocumentChunk {
  return {
    id: 'chunk-abc-123',
    documentId: 'doc-1',
    projectId: 'proj-1',
    contentType: 'paragraph',
    text: 'The derivative measures the instantaneous rate of change of a function.',
    sourceReference: 'lecture.pdf',
    pageNumber: 12,
    section: 'Derivatives',
    order: 11,
    createdAt: 1,
    ...overrides,
  }
}

function renderReader(props: Partial<Parameters<typeof SourceReader>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SourceReader
        open
        onOpenChange={() => undefined}
        documentName={LONG_NAME}
        location="Page 12 · Derivatives"
        content="The derivative measures the instantaneous rate of change."
        {...props}
      />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // userEvent installs its own clipboard stub; clear it so assertions cannot
  // read a value written by an earlier test.
  void navigator.clipboard?.writeText('').catch(() => undefined)
})

describe('SourceReader', () => {
  it('is an accessible dialog named after the document', () => {
    renderReader()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(LONG_NAME)).toBeInTheDocument()
    expect(dialog).toHaveAccessibleName(LONG_NAME)
  })

  it('has a labelled close control', () => {
    renderReader()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('shows the location and the source text', () => {
    renderReader()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Page 12 · Derivatives')).toBeInTheDocument()
    expect(within(dialog).getByText(/instantaneous rate of change/)).toBeInTheDocument()
  })

  it('keeps the full filename available even though it is visually clipped', () => {
    renderReader()
    // The heading inherits the same accessible name, so pick the clipped node.
    const clipped = screen
      .getAllByLabelText(LONG_NAME)
      .find((element) => element.classList.contains('truncate'))
    expect(clipped?.textContent).toBe(LONG_NAME)
  })

  it('constrains the dialog to the viewport so it cannot overflow on mobile', () => {
    renderReader()
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('w-[calc(100vw-1.5rem)]')
    expect(dialog.className).toContain('max-h-[min(92vh,54rem)]')
    expect(dialog.className).toContain('overflow-hidden')
  })

  it('copies the source text and confirms with the existing toast system', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SourceReader
          open
          onOpenChange={() => undefined}
          documentName={LONG_NAME}
          content="Copy me verbatim."
        />
        <Toaster />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Copy source' }))

    expect(await navigator.clipboard.readText()).toBe('Copy me verbatim.')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('offers a document link only when a href is provided', () => {
    const { unmount } = renderReader({ documentHref: '/projects/p/documents/d' })
    expect(screen.getByRole('link', { name: 'Open document' })).toHaveAttribute(
      'href',
      '/projects/p/documents/d',
    )
    unmount()

    renderReader()
    expect(screen.queryByRole('link', { name: 'Open document' })).not.toBeInTheDocument()
  })

  it('hides technical identifiers behind a disclosure', async () => {
    const user = userEvent.setup()
    renderReader({ technical: [{ label: 'Chunk ID', value: 'chunk-abc-123' }] })

    const summary = screen.getByText('Advanced details')
    const disclosure = summary.closest('details')
    expect(disclosure).not.toBeNull()
    // Collapsed by default: the ids are present but not shown.
    expect(disclosure).not.toHaveAttribute('open')

    await user.click(summary)
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByText('chunk-abc-123')).toBeInTheDocument()
  })

  it('shows an empty state instead of an empty reading column', () => {
    renderReader({ content: '   ' })
    expect(screen.getByText('There is no source text to display.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy source' })).toBeDisabled()
  })

  it('typesets LaTeX in the reading column', () => {
    // Radix portals the dialog to document.body, so query the dialog itself.
    renderReader({ content: 'The identity $e^{i\\pi} + 1 = 0$ holds.' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders very long content inside a bounded reading column', () => {
    renderReader({ content: 'x'.repeat(5000) })
    const dialog = screen.getByRole('dialog')
    const article = dialog.querySelector('article')
    expect(article).toBeInTheDocument()
    // The reading measure is capped so long lines stay readable.
    expect(article?.className).toContain('max-w-[46rem]')
  })

  it('renders CJK content', () => {
    renderReader({ content: '这一部分介绍导数的基本概念。' })
    expect(screen.getByText(/这一部分介绍导数的基本概念。/)).toBeInTheDocument()
  })
})

describe('ChunkPreview', () => {
  function renderChunk(c: DocumentChunk = chunk(), index = 12) {
    return render(
      <MemoryRouter>
        <ChunkPreview chunk={c} documentName="lecture.pdf" index={index} />
      </MemoryRouter>,
    )
  }

  it('reads as course text, not a database row', () => {
    renderChunk()
    expect(screen.getByText('Chunk 12')).toBeInTheDocument()
    expect(screen.getByText('lecture.pdf')).toBeInTheDocument()
    expect(screen.getByText('Page 12 · § Derivatives')).toBeInTheDocument()
    expect(screen.getByText(/instantaneous rate of change/)).toBeInTheDocument()
  })

  it('does not show technical ids until the disclosure is opened', async () => {
    const user = userEvent.setup()
    renderChunk()

    const summary = screen.getByText('Advanced details')
    const disclosure = summary.closest('details')
    expect(disclosure).not.toHaveAttribute('open')

    await user.click(summary)
    expect(disclosure).toHaveAttribute('open')
    expect(screen.getByText('chunk-abc-123')).toBeInTheDocument()
    expect(screen.getByText('doc-1')).toBeInTheDocument()
  })

  it('collapses long chunks and can expand them', async () => {
    const user = userEvent.setup()
    const long = 'word '.repeat(300)
    renderChunk(chunk({ text: long }))

    const expand = screen.getByRole('button', { name: 'Show full excerpt' })
    await user.click(expand)

    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })

  it('opens the source reader for the full chunk', async () => {
    const user = userEvent.setup()
    renderChunk()

    await user.click(screen.getByRole('button', { name: 'Read source' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/instantaneous rate of change/)).toBeInTheDocument()
    expect(within(dialog).getByText('Page 12 · § Derivatives')).toBeInTheDocument()
  })

  it('handles a chunk with no page or section', () => {
    renderChunk(chunk({ pageNumber: undefined, section: undefined }))
    expect(screen.getByText('Chunk 12')).toBeInTheDocument()
    expect(screen.queryByText(/Page/)).not.toBeInTheDocument()
  })
})
