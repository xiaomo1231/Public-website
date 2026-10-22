import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectionTranslator } from '@/widgets/translation/SelectionTranslator'
import { buildAIServices } from '@/services/aiServices'
import { recordVocabLookup } from '@/features/vocab/recordLookup'

vi.mock('@/services/aiServices', () => ({ buildAIServices: vi.fn() }))
vi.mock('@/features/vocab/recordLookup', () => ({ recordVocabLookup: vi.fn() }))
vi.mock('@/features/project/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'p1', name: 'Anatomy' }),
}))

beforeEach(() => {
  vi.mocked(recordVocabLookup).mockReset()
  vi.mocked(buildAIServices).mockReset()
  vi.mocked(buildAIServices).mockResolvedValue({
    translation: {
      translate: vi
        .fn()
        .mockResolvedValue({ translation: '心包', contextNote: '', alternatives: [] }),
    },
    contextualTutor: { ask: vi.fn().mockResolvedValue({ answer: 'ok' }) },
  } as never)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  window.history.pushState({}, '', '/projects/p1/tutor/t1')
})

function select(element: Element): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 200,
      width: 40,
      height: 10,
      right: 140,
      bottom: 210,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    }) as DOMRect
  const spy = vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    toString: () => element.textContent ?? '',
    getRangeAt: () => range,
    removeAllRanges: () => undefined,
    addRange: () => undefined,
  } as unknown as Selection)
  document.dispatchEvent(new Event('selectionchange'))
  spy.mockReturnValue({
    isCollapsed: true,
    rangeCount: 0,
    toString: () => '',
    getRangeAt: () => range,
    removeAllRanges: () => undefined,
    addRange: () => undefined,
  } as unknown as Selection)
}

function renderPage(): void {
  render(
    <>
      <article>
        <h1>The heart</h1>
        <p>
          The heart lies in the mediastinum. The <span data-testid="word">pericardium</span>{' '}
          surrounds it.
        </p>
      </article>
      <SelectionTranslator />
    </>,
  )
}

describe('looked-up words join the course word book', () => {
  it('records a translated word with its meaning and paragraph', async () => {
    const user = userEvent.setup()
    renderPage()
    select(screen.getByTestId('word'))
    await user.click(await screen.findByRole('button', { name: 'Translate' }))
    await waitFor(() => expect(recordVocabLookup).toHaveBeenCalledTimes(1))
    const call = vi.mocked(recordVocabLookup).mock.calls[0]![0]
    expect(call).toMatchObject({ projectId: 'p1', text: 'pericardium', meaning: '心包' })
    expect(call.surrounding).toContain('The pericardium surrounds it.')
  })

  it('records a word asked to be explained', async () => {
    const user = userEvent.setup()
    renderPage()
    select(screen.getByTestId('word'))
    await user.click(await screen.findByRole('button', { name: 'Explain' }))
    await waitFor(() =>
      expect(recordVocabLookup).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p1', text: 'pericardium' }),
      ),
    )
  })
})
