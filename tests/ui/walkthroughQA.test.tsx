import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectionTranslator } from '@/widgets/translation/SelectionTranslator'
import { FloatingQALayer } from '@/widgets/homework/walkthrough/FloatingQALayer'
import { useFloatingQA } from '@/features/homework/floatingQAStore'
import { buildAIServices } from '@/services/aiServices'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { HomeworkRepository } from '@/entities/homework/repository'
import { WalkthroughRepository } from '@/entities/homework/walkthroughRepository'

vi.mock('@/services/aiServices', () => ({ buildAIServices: vi.fn() }))
vi.mock('@/features/project/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'p1', name: 'Linear algebra' }),
}))

const askMock = vi.fn()
let db: AppDatabase

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  await new HomeworkRepository(db).upsertSet({
    id: 's1',
    projectId: 'p1',
    documentId: 'd1',
    documentName: 'hw3.pdf',
    title: 'HW3',
    status: 'ready',
    language: 'en',
    questionCount: 1,
    promptVersion: 'v1',
    createdAt: 1,
    updatedAt: 1,
  })
  askMock.mockReset()
  askMock
    .mockResolvedValueOnce({ question: 'q', answer: 'It clears the entry below the pivot.' })
    .mockResolvedValueOnce({ question: 'q', answer: 'Because row 1 has the pivot.' })
  vi.mocked(buildAIServices).mockResolvedValue({ contextualTutor: { ask: askMock } } as never)
  useFloatingQA.setState({ windows: [], nextZ: 1 })
  window.history.pushState({}, '', '/projects/p1/homework/s1')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** jsdom's Selection does not report an added range; stub what the toolbar reads. */
function select(node: Text, start: number, end: number): void {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = (collapsed: boolean) =>
    ({
      isCollapsed: collapsed,
      rangeCount: collapsed ? 0 : 1,
      toString: () => (collapsed ? '' : range.toString()),
      getRangeAt: () => range,
      removeAllRanges: () => undefined,
      addRange: () => undefined,
    }) as unknown as Selection
  const spy = vi.spyOn(window, 'getSelection').mockReturnValue(selection(false))
  act(() => document.dispatchEvent(new Event('selectionchange')))
  spy.mockReturnValue(selection(true))
}

function renderWalkthrough(): Text {
  render(
    <>
      <article
        data-selection-context="walkthrough"
        data-walkthrough-project="p1"
        data-walkthrough-set="s1"
        data-selection-title="HW3"
      >
        <section data-walkthrough-section="q:q1" data-section-title="Question 1">
          <p data-testid="step">First do R2 minus 2 R1, then scale.</p>
        </section>
      </article>
      <SelectionTranslator />
      <FloatingQALayer setId="s1" />
    </>,
  )
  return screen.getByTestId('step').firstChild as Text
}

describe('questions about the walkthrough', () => {
  it('opens a movable window, keeps the conversation and saves it with its passage', async () => {
    const user = userEvent.setup()
    const text = renderWalkthrough()
    select(text, 9, 22)
    await user.click(await screen.findByRole('button', { name: 'Explain' }))

    const dialog = await screen.findByRole('dialog', { name: /R2 minus 2 R1/ })
    expect(await screen.findByText('It clears the entry below the pivot.')).toBeInTheDocument()
    expect(askMock).toHaveBeenCalledWith(
      expect.objectContaining({ contextKind: 'walkthrough', selectedText: 'R2 minus 2 R1', sectionHeading: 'Question 1', topicTitle: 'HW3' }),
    )
    // Placed beside the selection, in its own fixed position.
    expect(dialog.style.left).not.toBe('')

    await user.type(screen.getByLabelText('Your question'), 'Why row 1?{Enter}')
    expect(await screen.findByText('Because row 1 has the pivot.')).toBeInTheDocument()
    expect(askMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        question: 'Why row 1?',
        history: [{ question: 'Explain this passage.', answer: 'It clears the entry below the pivot.' }],
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await new WalkthroughRepository(db).listNotes('s1')).toHaveLength(1))
    const [note] = await new WalkthroughRepository(db).listNotes('s1')
    expect(note).toMatchObject({
      projectId: 'p1',
      sectionId: 'q:q1',
      quote: 'R2 minus 2 R1',
      anchor: { text: 'R2 minus 2 R1', prefix: 'First do ', suffix: ', then scale.' },
      // Started with Explain: named after the passage, not the generic question.
      title: 'R2 minus 2 R1',
    })
    expect(note!.turns).toHaveLength(2)
    expect(await screen.findAllByText('Saved')).not.toHaveLength(0)
  })

  it('asks before closing a conversation that is not saved', async () => {
    const user = userEvent.setup()
    const text = renderWalkthrough()
    select(text, 9, 22)
    await user.click(await screen.findByRole('button', { name: 'Explain' }))
    await screen.findByText('It clears the entry below the pivot.')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText(/not saved and will be lost/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: "Don't save" }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await new WalkthroughRepository(db).listNotes('s1')).toEqual([])
  })

  it('keeps at most three windows open and tucks older ones into the dock', () => {
    const passage = {
      projectId: 'p1', setId: 's1', setTitle: 'HW3', sectionId: 'q:q1', sectionTitle: 'Question 1',
      quote: 'R2', anchor: { text: 'R2', prefix: '', suffix: '' }, surrounding: '', language: 'en' as const,
    }
    const store = useFloatingQA.getState()
    const ids = [1, 2, 3, 4].map(() => store.open({ passage, turns: [], rect: { x: 10, y: 10, width: 400, height: 400 } }))
    const windows = useFloatingQA.getState().windows
    expect(windows.filter((window) => window.minimized).map((window) => window.id)).toEqual([ids[0]])
    useFloatingQA.getState().focus(ids[0]!)
    expect(useFloatingQA.getState().windows.filter((window) => window.minimized).map((window) => window.id)).toEqual([ids[1]])
  })
})
