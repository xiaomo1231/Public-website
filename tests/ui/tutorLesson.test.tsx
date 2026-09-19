import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { setUILanguage } from '@/i18n'
import { TutorLessonView } from '@/widgets/tutor/TutorLessonView'
import { TutorSymbolsPanel } from '@/widgets/tutor/TutorSymbolsPanel'
import { Math } from '@/shared/ui/Math'
import { RichText } from '@/shared/ui/RichText'
import { buildSystemPrompt } from '@/infrastructure/ai/prompts/tutor/v1-lesson'
import type { TutorLesson } from '@/entities/tutorLesson/types'
import type { UseTutorLessonState } from '@/features/tutor/useTutorLesson'

function lesson(overrides: Partial<TutorLesson> = {}): TutorLesson {
  return {
    id: 'lesson-1',
    projectId: 'p1',
    topicId: 't1',
    language: 'en',
    content: [
      '## Overview',
      '',
      'The intersection of two sets is written \\(X \\cap Y\\).',
      '',
      '\\[',
      'X \\cap Y = \\{c\\}',
      '\\]',
    ].join('\n'),
    symbols: [
      { latex: '\\cap', displayLatex: 'A \\cap B', name: 'Intersection' },
      { latex: '\\overline', displayLatex: '\\overline{Y}', name: 'Complement' },
    ],
    sourceChunkIds: ['chunk-1'],
    contentHash: 'abc123',
    promptVersion: 'v1',
    generatedAt: 1,
    updatedAt: 1,
    version: 1,
    ...overrides,
  }
}

function state(overrides: Partial<UseTutorLessonState> = {}): UseTutorLessonState {
  return {
    status: 'ready',
    lesson: lesson(),
    fromCache: true,
    streaming: false,
    regenerating: false,
    regenerate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderLesson(s: UseTutorLessonState = state()) {
  return render(
    <MemoryRouter>
      <TutorLessonView topicName="Set Operations" state={s} />
    </MemoryRouter>,
  )
}

describe('TutorLessonView', () => {
  it('renders the lesson as reading material', () => {
    renderLesson()
    expect(screen.getByRole('heading', { name: 'Set Operations' })).toBeInTheDocument()
    expect(screen.getByText(/The intersection of two sets/)).toBeInTheDocument()
  })

  it('never asks the student to answer anything', () => {
    const { container } = renderLesson()
    // No input surface at all — this page is for reading.
    expect(container.querySelector('textarea')).not.toBeInTheDocument()
    expect(container.querySelector('input')).not.toBeInTheDocument()
    expect(container.querySelector('button[type="submit"]')).not.toBeInTheDocument()

    const text = container.textContent ?? ''
    for (const phrase of [
      'Your turn',
      'Let me know your answer',
      'What is your answer',
      'Try this',
      'What do you think',
      'Answer the following',
    ]) {
      expect(text).not.toContain(phrase)
    }
  })

  it('marks the lesson as stored locally', () => {
    renderLesson()
    expect(screen.getByText('Saved locally')).toBeInTheDocument()
  })

  it('typesets the lesson LaTeX instead of showing the source', () => {
    const { container } = renderLesson()
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain('\\(X \\cap Y\\)')
  })

  it('renders headings rather than literal hashes', () => {
    const { container } = renderLesson()
    expect(container.textContent).not.toContain('## Overview')
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
  })

  it('shows the loading label for a first generation', () => {
    renderLesson(state({ status: 'loading', lesson: undefined }))
    expect(screen.getByText('Generating this lesson…')).toBeInTheDocument()
  })

  it('shows a different label when reading a stored lesson', () => {
    renderLesson(state({ status: 'loading' }))
    expect(screen.getByText('Loading the saved lesson…')).toBeInTheDocument()
  })

  it('offers a retry when generation failed outright', async () => {
    const user = userEvent.setup()
    const regenerate = vi.fn().mockResolvedValue(undefined)
    renderLesson(
      state({ status: 'error', lesson: undefined, error: 'AI unavailable', regenerate }),
    )

    expect(screen.getByText('AI unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(regenerate).toHaveBeenCalled()
  })

  it('keeps the stored lesson visible when a refresh failed', () => {
    renderLesson(state({ refreshError: 'Provider down' }))
    expect(screen.getByText('Unable to refresh the lesson.')).toBeInTheDocument()
    expect(screen.getByText('Showing the previously saved lesson.')).toBeInTheDocument()
    // The lesson itself is still readable.
    expect(screen.getByText(/The intersection of two sets/)).toBeInTheDocument()
  })

  it('regenerates only after confirmation', async () => {
    const user = userEvent.setup()
    const regenerate = vi.fn().mockResolvedValue(undefined)
    renderLesson(state({ regenerate }))

    await user.click(screen.getByRole('button', { name: 'Regenerate lesson' }))
    // Confirmation first — regeneration costs tokens.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Regenerate this lesson?')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Regenerate lesson' }))
    expect(regenerate).toHaveBeenCalledTimes(1)
  })

  it('renders a footer slot for the practice call to action', () => {
    render(
      <MemoryRouter>
        <TutorLessonView
          topicName="Set Operations"
          state={state()}
          footer={<a href="/practice">Open Interactive Tutor</a>}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Open Interactive Tutor' })).toBeInTheDocument()
  })
})

describe('TutorSymbolsPanel', () => {
  it('lists the symbols used in the lesson', () => {
    render(
      <TutorSymbolsPanel
        symbols={[
          { latex: '\\cap', displayLatex: 'A \\cap B', name: 'Intersection' },
          { latex: '\\cup', displayLatex: 'A \\cup B', name: 'Union' },
        ]}
      />,
    )

    expect(screen.getByText('Intersection')).toBeInTheDocument()
    expect(screen.getByText('Union')).toBeInTheDocument()
    expect(screen.getByText('2 used in this lesson')).toBeInTheDocument()
  })

  it('renders every symbol with the LaTeX renderer', () => {
    const { container } = render(
      <TutorSymbolsPanel
        symbols={[{ latex: '\\cap', displayLatex: 'A \\cap B', name: 'Intersection' }]}
      />,
    )
    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('shows an empty state when the lesson uses no symbols', () => {
    render(<TutorSymbolsPanel symbols={[]} />)
    expect(
      screen.getByText('This lesson does not use any special mathematical symbols.'),
    ).toBeInTheDocument()
  })

  it('does not show symbols that were not used', () => {
    render(
      <TutorSymbolsPanel
        symbols={[{ latex: '\\cap', displayLatex: 'A \\cap B', name: 'Intersection' }]}
      />,
    )
    expect(screen.queryByText('Summation')).not.toBeInTheDocument()
    expect(screen.queryByText('Integral')).not.toBeInTheDocument()
  })
})

describe('Math rendering', () => {
  it('renders inline LaTeX', () => {
    const { container } = render(<Math latex="x^2 + y^2 = z^2" />)
    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders block LaTeX', () => {
    // Note: a JSX string attribute would not unescape backslashes, so the
    // LaTeX has to come from a JS expression.
    const { container } = render(<Math latex={'\\int_0^\\infty e^{-x^2} dx'} display />)
    expect(container.querySelector('.katex-display')).toBeInTheDocument()
  })

  it.each([
    ['\\frac{a}{b}'],
    ['\\sqrt{x}'],
    ['\\sum_{i=1}^{n} i'],
    ['\\int_0^\\infty e^{-x^2}dx'],
    ['\\le'],
    ['\\ge'],
    ['\\neq'],
    ['\\in'],
    ['\\notin'],
    ['\\subseteq'],
    ['\\cup'],
    ['\\cap'],
    ['\\overline{Y}'],
    ['X \\cap Y = \\{c\\}'],
    ['U = \\{a,b,c,d,e,f\\}'],
    ['f\'(x) = \\frac{dy}{dx}'],
  ])('renders %s', (latex) => {
    const { container } = render(<Math latex={latex} display />)
    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('does not crash on invalid LaTeX and shows the source instead', () => {
    const { container } = render(<Math latex={'\\frac{a}{'} display />)
    // Falls back to the author's source rather than throwing.
    expect(container.textContent).toContain('\\frac{a}{')
    expect(container.querySelector('code')).toBeInTheDocument()
  })
})

describe('RichText markdown mode', () => {
  it('renders LaTeX mixed with Chinese prose', () => {
    const { container } = render(
      <RichText text={'集合的交集记作 \\(A \\cap B\\)。'} format="markdown" />,
    )
    expect(container.textContent).toContain('集合的交集记作')
    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders LaTeX mixed with markdown structure', () => {
    const text = ['## Example', '', '- \\(X \\cap Y\\)', '- \\(\\overline{Y}\\)'].join('\n')
    const { container } = render(<RichText text={text} format="markdown" />)
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2)
  })

  it('still renders plain source text without interpreting markdown', () => {
    const { container } = render(<RichText text={'# not a heading'} />)
    expect(container.querySelector('h2')).not.toBeInTheDocument()
    expect(container.textContent).toContain('# not a heading')
  })
})

describe('teaching blocks', () => {
  it('renders a Definition as a labelled block, not as raw markdown', () => {
    const { container } = render(
      <RichText
        format="markdown"
        text={'## Definition\n\nThe intersection of two sets contains the shared elements.'}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Definition' })).toBeInTheDocument()
    expect(container.querySelector('section')).toBeInTheDocument()
    expect(container.textContent).not.toContain('## Definition')
  })

  it('renders an Example as its own block', () => {
    const { container } = render(
      <RichText format="markdown" text={'## Example\n\nLet \\(X = \\{a,c,e\\}\\).'} />,
    )
    expect(screen.getByRole('heading', { name: 'Example' })).toBeInTheDocument()
    expect(container.querySelector('.katex')).toBeInTheDocument()
  })

  it('renders Common Mistake as its own block', () => {
    render(<RichText format="markdown" text={'## Common Mistake\n\nDo not swap X and Y.'} />)
    expect(screen.getByRole('heading', { name: 'Common Mistake' })).toBeInTheDocument()
  })

  it('keeps a structural section like Summary as a plain heading', () => {
    const { container } = render(
      <RichText format="markdown" text={'## Summary\n\nIntersection keeps what is shared.'} />,
    )
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument()
    // It stays a plain heading — not every section becomes a bordered card.
    expect(container.querySelector('section.rounded-lg')).not.toBeInTheDocument()
  })

  it('promotes a bold pseudo-heading instead of showing the asterisks', () => {
    const { container } = render(
      <RichText format="markdown" text={'**Intuition:**\n\nThe idea behind intersection.'} />,
    )
    expect(container.textContent).not.toContain('**')
    expect(screen.getByRole('heading', { name: 'Intuition' })).toBeInTheDocument()
  })

  it('recognises the Chinese section titles', () => {
    act(() => setUILanguage('zh-CN'))
    render(<RichText format="markdown" text={'## Definition\n\n集合的定义。'} />)
    expect(screen.getByRole('heading', { name: '定义' })).toBeInTheDocument()
  })

  it('keeps the block body in the lesson language', () => {
    act(() => setUILanguage('zh-CN'))
    render(<RichText format="markdown" text={'## Example\n\nThe shared elements are kept.'} />)
    // Only the label is UI chrome; the teaching content is not translated.
    expect(screen.getByText('The shared elements are kept.')).toBeInTheDocument()
  })
})

describe('semantic HTML coverage', () => {
  const document = [
    '# Topic Title',
    '',
    '## Section',
    '',
    '### Subsection',
    '',
    'A paragraph with **bold** and *italic* and `code`.',
    '',
    '- first item',
    '- second item',
    '',
    '1. step one',
    '2. step two',
    '',
    '> a quoted note',
    '',
    '```',
    'const x = 1',
    '```',
  ].join('\n')

  it('renders each markdown construct as the right element', () => {
    const { container } = render(<RichText format="markdown" text={document} />)

    // Markdown levels map straight through: `#` -> h1, `##` -> h2, `###` -> h3.
    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(container.querySelector('h2')).toBeInTheDocument()
    expect(container.querySelector('h3')).toBeInTheDocument()
    expect(container.querySelector('p')).toBeInTheDocument()
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
    expect(container.querySelector('ul')).toBeInTheDocument()
    expect(container.querySelector('ol')).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(4)
    expect(container.querySelector('blockquote')).toBeInTheDocument()
    expect(container.querySelector('pre code')?.textContent).toBe('const x = 1')
  })

  it('never shows markdown syntax to the reader', () => {
    const { container } = render(<RichText format="markdown" text={document} />)
    const text = container.textContent ?? ''
    expect(text).not.toContain('##')
    expect(text).not.toContain('**')
    expect(text).not.toContain('- first')
    expect(text).not.toContain('1. step')
  })

  it('does not bold a whole paragraph', () => {
    const { container } = render(
      <RichText format="markdown" text={'The **universal set** contains everything.'} />,
    )
    const paragraph = container.querySelector('p')
    expect(paragraph?.querySelector('strong')?.textContent).toBe('universal set')
    // Only the term is bold, not the sentence.
    expect(paragraph?.textContent).toBe('The universal set contains everything.')
  })
})

describe('XSS safety', () => {
  it('does not execute a script tag in lesson content', () => {
    const { container } = render(
      <RichText format="markdown" text={'Hello <script>window.__pwned = true</script> world'} />,
    )
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('does not create elements from injected HTML', () => {
    const { container } = render(
      <RichText
        format="markdown"
        text={'<img src=x onerror="window.__pwned = true"> and <iframe src="evil"></iframe>'}
      />,
    )
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(container.querySelector('iframe')).not.toBeInTheDocument()
    // The markup is shown as text, which is the safe outcome.
    expect(container.textContent).toContain('<img')
  })

  it('does not let LaTeX escape into raw HTML', () => {
    const { container } = render(
      <RichText format="markdown" text={'\\htmlClass{evil}{x} \\href{javascript:alert(1)}{y}'} />,
    )
    expect(container.querySelector('[class*="evil"]')).not.toBeInTheDocument()
    expect(container.querySelector('a[href^="javascript"]')).not.toBeInTheDocument()
  })

  it('keeps raw HTML in source text inert', () => {
    const { container } = render(<RichText text={'<script>alert(1)</script>'} />)
    expect(container.querySelector('script')).not.toBeInTheDocument()
  })
})

describe('lesson prompt contract', () => {
  it('forbids conversational endings and requires LaTeX', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/Never ask the student a question/i)
    expect(prompt).toContain('Your turn')
    expect(prompt).toMatch(/reference reading material/i)
    expect(prompt).toMatch(/LaTeX/)
    expect(prompt).toMatch(/Private Use Area/)
  })

  it('instructs the model to reconstruct damaged source rather than echo it', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('DAMAGED SOURCE TEXT')
    expect(prompt).toContain('\\triangle')
    expect(prompt).toMatch(/Never reproduce a malformed/i)
  })

  it('requires LaTeX as the canonical maths and prioritises meaning over glyph', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/All mathematical notation must use LaTeX/i)
    expect(prompt).toMatch(/Never use Unicode mathematical symbols as the canonical/i)
    // Set difference has an explicit command.
    expect(prompt).toContain('\\setminus')
    // Symmetric difference must not be transcribed from a circled-plus glyph.
    expect(prompt).toMatch(/\\triangle, NOT \\oplus/)
  })
})
