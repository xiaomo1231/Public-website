import { describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QuestionSource } from '@/widgets/quiz/QuestionSource'
import { setUILanguage } from '@/i18n'
import type { SourceReference } from '@/entities/courseAnalysis/types'

function source(overrides: Partial<SourceReference> = {}): SourceReference {
  return {
    documentId: 'doc-1',
    documentName: 'Calculus Lecture 03.pdf',
    page: 12,
    section: 'Derivatives',
    quote: 'The derivative of a function represents the instantaneous rate of change.',
    chunkId: 'chunk-1',
    ...overrides,
  }
}

function renderSource(refs: SourceReference[] | undefined, projectId?: string) {
  return render(
    <MemoryRouter>
      <QuestionSource sourceRefs={refs} {...(projectId ? { projectId } : {})} />
    </MemoryRouter>,
  )
}

describe('QuestionSource', () => {
  it('shows the document, location and excerpt', () => {
    renderSource([source()])

    expect(screen.getByText('Question Source')).toBeInTheDocument()
    expect(screen.getByText('Calculus Lecture 03.pdf')).toBeInTheDocument()
    expect(screen.getByText('Page 12 · Derivatives')).toBeInTheDocument()
    expect(screen.getByText(/The derivative of a function represents/)).toBeInTheDocument()
  })

  it('says no source was recorded for questions without the field', () => {
    renderSource(undefined)
    expect(screen.getByText('No source was recorded for this question.')).toBeInTheDocument()
  })

  it('says no excerpt was found when the citation list is empty', () => {
    renderSource([])
    expect(screen.getByText('No matching course excerpt was found.')).toBeInTheDocument()
  })

  it('lists multiple sources separately', () => {
    renderSource([
      source({ chunkId: 'a', documentName: 'Lecture 03.pdf', page: 12 }),
      source({ chunkId: 'b', documentName: 'Lecture 04.pdf', page: 3 }),
    ])

    expect(screen.getByText('Source 1')).toBeInTheDocument()
    expect(screen.getByText('Source 2')).toBeInTheDocument()
    expect(screen.getByText('Lecture 03.pdf')).toBeInTheDocument()
    expect(screen.getByText('Lecture 04.pdf')).toBeInTheDocument()
  })

  it('collapses a long excerpt and can expand it', async () => {
    const user = userEvent.setup()
    const long = 'A'.repeat(600)
    renderSource([source({ quote: long })])

    const expand = screen.getByRole('button', { name: 'Show full excerpt' })
    expect(expand).toBeInTheDocument()
    // Collapsed form is shorter than the full quote and ends with an ellipsis.
    expect(screen.getByText(/…$/)).toBeInTheDocument()

    await user.click(expand)
    expect(screen.getByText(long)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })

  it('typesets LaTeX in the excerpt instead of showing the delimiters', () => {
    const { container } = renderSource([
      source({ quote: 'Euler identity: $e^{i\\pi} + 1 = 0$ holds.' }),
    ])

    expect(container.querySelector('.katex')).toBeInTheDocument()
    expect(screen.getByText(/Euler identity:/)).toBeInTheDocument()
    // The `$` delimiters are consumed by the renderer.
    expect(container.textContent).not.toContain('$e^{i')
  })

  it('does not interpret markdown or HTML as formatting', () => {
    const { container } = renderSource([
      source({ quote: '# Heading\n\n- item one\n\n<script>alert(1)</script>' }),
    ])

    expect(container.querySelector('h1')).not.toBeInTheDocument()
    expect(container.querySelector('li')).not.toBeInTheDocument()
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect(screen.getByText(/# Heading/)).toBeInTheDocument()
  })

  it('renders undecodable characters as-is rather than dropping them', () => {
    renderSource([source({ quote: 'Let \uF0C7 denote intersection.' })])
    expect(screen.getByText(/Let \uF0C7 denote intersection\./)).toBeInTheDocument()
  })

  it('opens a source reader with the full excerpt', async () => {
    const user = userEvent.setup()
    renderSource([source({ quote: 'The derivative describes the rate of change.' })])

    await user.click(screen.getByRole('button', { name: 'Read source' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Source')).toBeInTheDocument()
    expect(within(dialog).getByText('Calculus Lecture 03.pdf')).toBeInTheDocument()
    expect(within(dialog).getByText('Page 12 · Derivatives')).toBeInTheDocument()
    expect(within(dialog).getByText(/The derivative describes the rate of change\./)).toBeInTheDocument()
  })

  it('exposes the chunk id only behind the advanced details disclosure', async () => {
    const user = userEvent.setup()
    renderSource([source({ chunkId: 'chunk-abc-123' })])

    await user.click(screen.getByRole('button', { name: 'Read source' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Advanced details')).toBeInTheDocument()
    expect(within(dialog).getByText('chunk-abc-123')).toBeInTheDocument()
  })

  it('links to the source document when a project is given', () => {
    renderSource([source()], 'proj-1')

    const link = screen.getByRole('link', { name: 'Open document' })
    expect(link).toHaveAttribute('href', '/projects/proj-1/documents/doc-1')
  })

  it('omits the document link when no project is given', () => {
    renderSource([source()])
    expect(screen.queryByRole('link', { name: 'Open document' })).not.toBeInTheDocument()
  })

  it('translates the whole block into Simplified Chinese', () => {
    act(() => setUILanguage('zh-CN'))
    renderSource([source()])

    expect(screen.getByText('题目出处')).toBeInTheDocument()
    expect(screen.getByText(/第 12 页/)).toBeInTheDocument()
    // The course excerpt itself is NOT translated.
    expect(screen.getByText(/The derivative of a function/)).toBeInTheDocument()
  })

  it('translates the empty states into Simplified Chinese', () => {
    act(() => setUILanguage('zh-CN'))
    renderSource(undefined)
    expect(screen.getByText('暂未记录课程出处。')).toBeInTheDocument()
  })
})

describe('QuestionSource long filenames', () => {
  const LONG =
    'Calculus_Lecture_Week_03_Derivatives_and_Applications_Review_Materials_2026_Final_Version.pdf'
  const LONG_CJK = '这是一个非常非常非常非常非常长的课程资料文件名称.pdf'

  it('keeps the full name in the DOM and clips it with CSS instead', () => {
    renderSource([source({ documentName: LONG })])
    const name = screen.getByLabelText(LONG)

    expect(name.textContent).toBe(LONG)
    expect(name).toHaveClass('truncate')
    expect(name).toHaveClass('min-w-0')
    expect(name).toHaveClass('max-w-full')
  })

  it('still shows the location line beneath a long name', () => {
    renderSource([source({ documentName: LONG })])
    expect(screen.getByText('Page 12 · Derivatives')).toBeInTheDocument()
  })

  it('handles a long unbroken CJK name', () => {
    renderSource([source({ documentName: LONG_CJK })])
    expect(screen.getByLabelText(LONG_CJK).textContent).toBe(LONG_CJK)
  })

  it('handles a long name with no spaces or extension', () => {
    const raw = 'A'.repeat(150)
    renderSource([source({ documentName: raw })])
    expect(screen.getByLabelText(raw).textContent).toBe(raw)
  })

  it('does not let the name swallow the source label', () => {
    renderSource([source({ documentName: LONG })])
    expect(screen.getByText('Question Source')).toBeInTheDocument()
  })
})
