import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Mistake } from '@/entities/mistake/types'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  analyze: vi.fn(),
}))

vi.mock('@/services/mistakeService', () => ({
  MistakeService: class {
    list = mocks.list
    stats = mocks.stats
  },
}))

vi.mock('@/services/weaknessService', () => ({
  WeaknessService: class {
    analyze = mocks.analyze
  },
}))

// Imported after the mocks are registered.
const { MistakeBookPage } = await import('@/pages/MistakeBookPage')

function mistake(overrides: Partial<Mistake> = {}): Mistake {
  return {
    id: crypto.randomUUID(),
    projectId: 'p1',
    knowledgePoint: 'Chain Rule',
    difficulty: 'basic',
    questionType: 'numeric',
    question: 'Differentiate sin(2x)',
    studentAnswer: 'cos(2x)',
    correctAnswer: '2cos(2x)',
    mistakeType: 'formula',
    analysisStatus: 'pending',
    status: 'active',
    source: 'auto',
    attemptIds: [],
    attemptCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/p1/mistakes']}>
      <Routes>
        <Route path="/projects/:id/mistakes" element={<MistakeBookPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MistakeBookPage search', () => {
  beforeEach(() => {
    mocks.list.mockReset()
    mocks.stats.mockReset()
    mocks.analyze.mockReset()
    mocks.list.mockResolvedValue([])
    mocks.stats.mockResolvedValue({
      total: 0,
      active: 0,
      understood: 0,
      archived: 0,
      byType: {},
      byKnowledgePoint: [],
    })
    mocks.analyze.mockResolvedValue({ areas: [], totalMistakes: 0, generatedAt: 0 })
  })

  it('does not query the database once per keystroke', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()

    // Wait for the initial load to settle.
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))

    const input = screen.getByPlaceholderText(/search questions or knowledge points/i)
    await user.type(input, 'quiz')

    // 4 keystrokes must collapse into a single debounced query.
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    expect(mocks.list.mock.calls.length).toBeLessThanOrEqual(2)

    const lastFilter = mocks.list.mock.calls.at(-1)?.[1]
    expect(lastFilter).toMatchObject({ query: 'quiz' })
  })

  it('loads stats only once, independently of the search text', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await waitFor(() => expect(mocks.stats).toHaveBeenCalledTimes(1))

    const input = screen.getByPlaceholderText(/search questions or knowledge points/i)
    await user.type(input, 'chain')

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))
    // Typing must not trigger extra stats scans.
    expect(mocks.stats).toHaveBeenCalledTimes(1)
  })

  it('applies a cleared search immediately without waiting for the debounce', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))

    const input = screen.getByPlaceholderText(/search questions or knowledge points/i)
    await user.type(input, 'chain')
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))

    await user.clear(input)
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3))
    expect(mocks.list.mock.calls.at(-1)?.[1]?.query).toBeUndefined()
  })

  it('ignores a slow stale response that resolves after a newer one', async () => {
    const user = userEvent.setup({ delay: null })
    const stale = mistake({ id: 'stale', question: 'STALE RESULT' })
    const fresh = mistake({ id: 'fresh', question: 'FRESH RESULT' })

    let resolveSlow: ((value: Mistake[]) => void) | undefined
    mocks.list
      // Initial mount load.
      .mockResolvedValueOnce([])
      // First search: resolves later.
      .mockImplementationOnce(
        () =>
          new Promise<Mistake[]>((resolve) => {
            resolveSlow = resolve
          }),
      )
      // Second search: resolves immediately.
      .mockResolvedValueOnce([fresh])

    renderPage()
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))

    const input = screen.getByPlaceholderText(/search questions or knowledge points/i)
    await user.type(input, 'slow')
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2))

    await user.clear(input)
    await user.type(input, 'fast')
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(3))

    // The fresh result is rendered.
    await waitFor(() => expect(screen.getByText('FRESH RESULT')).toBeInTheDocument())

    // Now let the stale request finish. It must not overwrite the newer result.
    resolveSlow?.([stale])
    await waitFor(() => expect(screen.getByText('FRESH RESULT')).toBeInTheDocument())
    expect(screen.queryByText('STALE RESULT')).not.toBeInTheDocument()
  })
})
