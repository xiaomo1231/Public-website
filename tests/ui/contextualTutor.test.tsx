import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectionTranslator } from '@/widgets/translation/SelectionTranslator'
import { ContextualTutorPopup, type ContextualTutorContext } from '@/widgets/tutor/ContextualTutorPopup'
import { buildAIServices } from '@/services/aiServices'

vi.mock('@/services/aiServices', () => ({ buildAIServices: vi.fn() }))
vi.mock('@/features/project/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'p1', name: 'Sets' }),
}))

const translateMock = vi.fn()
const askMock = vi.fn()

beforeEach(() => {
  vi.mocked(buildAIServices).mockReset()
  translateMock.mockReset()
  askMock.mockReset()
  translateMock.mockResolvedValue({ translation: '译文', contextNote: '', alternatives: [] })
  askMock.mockResolvedValue({ question: 'q', answer: 'Here, \\(x \\in A\\) means membership.' })
  vi.mocked(buildAIServices).mockResolvedValue({
    translation: { translate: translateMock },
    contextualTutor: { ask: askMock },
  } as never)
  window.history.pushState({}, '', '/projects/p1/tutor/t1')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * jsdom's Selection does not report the text of an added range, so a real
 * selection cannot be simulated. We stub `getSelection` with the minimum the
 * widget reads.
 */
function selectNode(element: Element): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  const spy = vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    toString: () => element.textContent ?? '',
    getRangeAt: () => range,
    removeAllRanges: () => undefined,
    addRange: () => undefined,
  } as unknown as Selection)

  document.dispatchEvent(new Event('selectionchange'))

  // Later selectionchange events (focusing a button, clicking) must look
  // collapsed, otherwise they would rebuild the selection and reset the action.
  spy.mockReturnValue({
    isCollapsed: true,
    rangeCount: 0,
    toString: () => '',
    getRangeAt: () => range,
    removeAllRanges: () => undefined,
    addRange: () => undefined,
  } as unknown as Selection)
}

function renderToolbar(): void {
  render(
    <>
      <article>
        <h1>Sets</h1>
        <h2>Element Notation</h2>
        <p data-testid="passage-1">If an object x belongs to a set A, we write x ∈ A.</p>
        <h2>Union</h2>
        <p data-testid="passage-2">The union of two sets contains every element.</p>
      </article>
      <SelectionTranslator />
    </>,
  )
}

describe('SelectionTranslator — three separate actions', () => {
  it('Case D — shows nothing until text is selected', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: 'Ask AI' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Explain' })).not.toBeInTheDocument()
  })

  it('offers Translate, Explain and Ask AI for a selection', async () => {
    renderToolbar()
    selectNode(screen.getByTestId('passage-1'))

    expect(await screen.findByRole('button', { name: 'Translate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeInTheDocument()
    // Selecting alone must not call the AI.
    expect(translateMock).not.toHaveBeenCalled()
    expect(askMock).not.toHaveBeenCalled()
  })

  it('Case A — Translate only triggers translation', async () => {
    const user = userEvent.setup()
    renderToolbar()
    selectNode(screen.getByTestId('passage-1'))

    await user.click(await screen.findByRole('button', { name: 'Translate' }))

    await waitFor(() => expect(translateMock).toHaveBeenCalledTimes(1))
    expect(askMock).not.toHaveBeenCalled()
    expect(await screen.findByText('译文')).toBeInTheDocument()
  })

  it('Case B — Explain only triggers the contextual tutor', async () => {
    const user = userEvent.setup()
    renderToolbar()
    selectNode(screen.getByTestId('passage-1'))

    await user.click(await screen.findByRole('button', { name: 'Explain' }))

    await waitFor(() => expect(askMock).toHaveBeenCalledTimes(1))
    expect(translateMock).not.toHaveBeenCalled()
    // The selection is sent as context.
    expect(askMock.mock.calls[0]![0].selectedText).toContain('x ∈ A')
  })

  it('Case C — Ask AI sends the learner’s own question', async () => {
    const user = userEvent.setup()
    renderToolbar()
    selectNode(screen.getByTestId('passage-1'))

    await user.click(await screen.findByRole('button', { name: 'Ask AI' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Your question'), 'Why is this useful?')
    await user.click(within(dialog).getByRole('button', { name: 'Ask' }))

    await waitFor(() => expect(askMock).toHaveBeenCalledTimes(1))
    expect(askMock.mock.calls[0]![0].question).toBe('Why is this useful?')
    expect(translateMock).not.toHaveBeenCalled()
  })

  it('Case E — closing without asking makes no AI request', async () => {
    const user = userEvent.setup()
    renderToolbar()
    selectNode(screen.getByTestId('passage-1'))

    await screen.findByRole('button', { name: 'Ask AI' })
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ask AI' })).not.toBeInTheDocument())
    expect(translateMock).not.toHaveBeenCalled()
    expect(askMock).not.toHaveBeenCalled()
  })

  it('Case F — a new selection replaces the previous context', async () => {
    const user = userEvent.setup()
    renderToolbar()
    selectNode(screen.getByTestId('passage-1'))
    await user.click(await screen.findByRole('button', { name: 'Ask AI' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('If an object x belongs')

    // Select a different passage: the old context is dropped.
    selectNode(screen.getByTestId('passage-2'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(await screen.findByRole('button', { name: 'Ask AI' }))
    expect((await screen.findByRole('dialog')).textContent).toContain('The union of two sets')
  })
})

describe('ContextualTutorPopup', () => {
  const context: ContextualTutorContext = {
    projectId: 'p1',
    topicId: 't1',
    topicTitle: 'Sets',
    sectionHeading: 'Element Notation',
    selectedText: 'x \\in A',
    surroundingContext: 'If an object x belongs to a set A, we write x ∈ A.',
    language: 'en',
  }

  it('Explain answers without the learner typing anything', async () => {
    render(<ContextualTutorPopup mode="explain" context={context} onClose={vi.fn()} />)

    await waitFor(() => expect(askMock).toHaveBeenCalledTimes(1))
    expect(askMock.mock.calls[0]![0].question).toBe('Explain this passage.')
    expect(await screen.findByText(/means membership/)).toBeInTheDocument()
  })

  it('does not send a figure’s OCR text to the model', async () => {
    render(
      <ContextualTutorPopup
        mode="explain"
        context={{ ...context, selectedText: '\uF0C5 ( ) ( ) A B', fromVisual: true }}
        onClose={vi.fn()}
      />,
    )

    expect(
      await screen.findByText(/This part comes from a diagram/),
    ).toBeInTheDocument()
    expect(askMock).not.toHaveBeenCalled()
  })

  it('offers a way to continue in the Interactive Tutor', async () => {
    render(<ContextualTutorPopup mode="ask" context={context} onClose={vi.fn()} />)
    const link = screen.getByRole('link', { name: /Continue in Interactive Tutor/ })
    expect(link).toHaveAttribute('href', '/projects/p1/tutor/t1/interactive')
  })
})
