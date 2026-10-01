import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HomeworkAnswerDialog } from '@/widgets/homework/HomeworkAnswerDialog'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { AnswerEntry, AnswerLine } from '@/entities/homework/answerMatching'
import type { AnswerGenerationProgress, HomeworkService } from '@/services/homeworkService'

const SET: HomeworkSet = {
  id: 's1',
  projectId: 'p1',
  documentId: 'd1',
  documentName: 'hw.txt',
  title: 'hw',
  status: 'ready',
  language: 'en',
  questionCount: 1,
  promptVersion: 'v2',
  answerDocumentId: 'a1',
  createdAt: 1,
  updatedAt: 1,
}

function question(partial: Partial<HomeworkQuestion> = {}): HomeworkQuestion {
  return {
    id: 'q1',
    projectId: 'p1',
    setId: 's1',
    documentId: 'd1',
    documentName: 'hw.txt',
    order: 0,
    number: '1',
    prompt: 'Add 4 and 5.',
    sourceRefs: [],
    hints: [],
    generationStatus: 'ready',
    promptVersion: 'v3',
    draftText: '',
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

interface StubMapping {
  entries: AnswerEntry[]
  lines: AnswerLine[]
  manual: boolean
  summary: { total: number; numbered: number; unnumbered: number; unsplit: boolean }
  result: {
    assignments: Array<{ questionId: string; status: string; reason: string; answerIndex?: number }>
    unmatchedAnswers: number[]
  }
}

function makeMapping(overrides: Partial<StubMapping> = {}): StubMapping {
  return {
    entries: [],
    lines: [],
    manual: false,
    summary: { total: 0, numbered: 0, unnumbered: 0, unsplit: false },
    result: { assignments: [], unmatchedAnswers: [] },
    ...overrides,
  }
}

function renderDialog(mapping: StubMapping, questions = [question()]) {
  const confirmAnswerMapping = vi.fn(async (_setId: string, _selections: unknown[]) => 1)
  const saveAnswerEntries = vi.fn(async (_setId: string, _entries: AnswerEntry[]) => 1)
  const clearAnswerEntries = vi.fn(async (_setId: string) => undefined)
  const generateAnswerContent = vi.fn(async (
    _setId: string,
    _questionIds?: readonly string[],
    _onProgress?: (progress: AnswerGenerationProgress) => void,
  ) => ({ generated: 1, failed: 0, skipped: 0 }))
  const onChanged = vi.fn()
  const onOpenChange = vi.fn()
  const service = {
    buildAnswerMapping: vi.fn(async () => ({
      document: { id: 'a1', name: 'answers.pdf', status: 'ready' },
      ...mapping,
    })),
    listQuestions: vi.fn(async () => questions),
    confirmAnswerMapping,
    saveAnswerEntries,
    clearAnswerEntries,
    generateAnswerContent,
    detachAnswerDocument: vi.fn(async () => undefined),
  } as unknown as HomeworkService

  render(
    <MemoryRouter>
      <HomeworkAnswerDialog
        projectId="p1"
        set={SET}
        service={service}
        open
        onOpenChange={onOpenChange}
        onRequestUpload={vi.fn()}
        onChanged={onChanged}
      />
    </MemoryRouter>,
  )
  return { confirmAnswerMapping, saveAnswerEntries, clearAnswerEntries, generateAnswerContent, onChanged, onOpenChange }
}

const UNSPLIT: StubMapping = makeMapping({
  lines: [
    { text: 'blob line one', chunkId: 'c1', pageNumber: 1 },
    { text: 'blob line two', chunkId: 'c2', pageNumber: 2 },
  ],
  entries: [{ text: 'blob line one\nblob line two', chunkIds: ['c1', 'c2'], pageNumbers: [1, 2] }],
  summary: { total: 1, numbered: 0, unnumbered: 1, unsplit: true },
  result: {
    assignments: [{ questionId: 'q1', status: 'none', reason: 'answer-number-missing' }],
    unmatchedAnswers: [0],
  },
})

describe('HomeworkAnswerDialog — answer matching', () => {
  it('explains a single un-split fragment and offers manual division', async () => {
    renderDialog(UNSPLIT)
    expect(await screen.findByText(/Only one un-split text block was recognized/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Divide answers manually/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /Open answer file/ }).length).toBeGreaterThan(0)
  })

  it('shows the selected answer content and its source page', async () => {
    renderDialog(
      makeMapping({
        entries: [{ number: '1', text: 'The answer is 9.', chunkIds: ['c1'], pageNumbers: [2] }],
        summary: { total: 1, numbered: 1, unnumbered: 0, unsplit: false },
        result: {
          assignments: [{ questionId: 'q1', status: 'matched', reason: 'number-unique', answerIndex: 0 }],
          unmatchedAnswers: [],
        },
      }),
    )
    expect((await screen.findAllByText(/The answer is 9\./)).length).toBeGreaterThan(0)
    expect(screen.getByText(/Page 2/)).toBeInTheDocument()
  })

  it('explains when the selected entry leaves the problem to the student', async () => {
    renderDialog(makeMapping({
      entries: [{ number: '3', text: 'Solution: This is similar to the last problem and is left to you.', chunkIds: ['c3'], pageNumbers: [3] }],
      summary: { total: 1, numbered: 1, unnumbered: 0, unsplit: false },
      result: { assignments: [{ questionId: 'q1', status: 'matched', reason: 'number-unique', answerIndex: 0 }], unmatchedAnswers: [] },
    }), [question({ generationStatus: 'failed', generationError: 'Old timeout' })])
    expect(await screen.findByText(/professor leaves this problem to the student/i)).toBeInTheDocument()
    expect(screen.queryByText(/Old timeout/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry this question/ })).not.toBeInTheDocument()
  })

  it('applies a manual division built from the extracted lines', async () => {
    const user = userEvent.setup()
    const { saveAnswerEntries } = renderDialog(UNSPLIT)
    await user.click(await screen.findByRole('button', { name: /Divide answers manually/ }))
    expect(await screen.findByText('Divide the extracted text')).toBeInTheDocument()

    const starts = screen.getAllByRole('button', { name: 'Starts a new answer' })
    expect(starts).toHaveLength(2)
    await user.click(starts[1]!)
    await user.click(screen.getByRole('button', { name: /Use this division/ }))

    await waitFor(() => expect(saveAnswerEntries).toHaveBeenCalled())
    const [setId, entries] = saveAnswerEntries.mock.calls[0]!
    expect(setId).toBe('s1')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ text: 'blob line one', chunkIds: ['c1'], number: '1' })
    expect(entries[1]).toMatchObject({ text: 'blob line two', chunkIds: ['c2'], number: '2' })
  })

  it('confirms the auto-matched mapping through the service', async () => {
    const user = userEvent.setup()
    const { confirmAnswerMapping, onChanged } = renderDialog(
      makeMapping({
        entries: [{ number: '1', text: 'nine', chunkIds: ['c1'], pageNumbers: [1] }],
        summary: { total: 1, numbered: 1, unnumbered: 0, unsplit: false },
        result: {
          assignments: [{ questionId: 'q1', status: 'matched', reason: 'number-unique', answerIndex: 0 }],
          unmatchedAnswers: [],
        },
      }),
    )
    await user.click(await screen.findByRole('button', { name: /Save mapping/ }))
    await waitFor(() =>
      expect(confirmAnswerMapping).toHaveBeenCalledWith('s1', [{ questionId: 'q1', answerIndex: 0 }]),
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows per-question generation progress and keeps the dialog closable', async () => {
    const user = userEvent.setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { generateAnswerContent, onOpenChange } = renderDialog(makeMapping({
      entries: [{ number: '1', text: 'nine', chunkIds: ['c1'], pageNumbers: [1] }],
      summary: { total: 1, numbered: 1, unnumbered: 0, unsplit: false },
      result: {
        assignments: [{ questionId: 'q1', status: 'matched', reason: 'number-unique', answerIndex: 0 }],
        unmatchedAnswers: [],
      },
    }))
    generateAnswerContent.mockImplementation(async (_setId, _ids, onProgress) => {
      onProgress?.({ completed: 0, total: 1, generated: 0, failed: 0, skipped: 0 })
      await gate
      onProgress?.({ completed: 1, total: 1, generated: 1, failed: 0, skipped: 0 })
      return { generated: 1, failed: 0, skipped: 0 }
    })
    await user.click(await screen.findByRole('button', { name: /Save & generate help/ }))
    expect(await screen.findByText(/Generating explanations · 0\/1 questions finished/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    const close = screen.getAllByRole('button', { name: 'Close' }).at(-1)!
    expect(close).not.toBeDisabled()
    await user.click(close)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    release()
    await waitFor(() => expect(generateAnswerContent).toHaveBeenCalledTimes(1))
  })

  it('shows a failed question reason and retries only that question', async () => {
    const user = userEvent.setup()
    const { generateAnswerContent } = renderDialog(makeMapping({
      entries: [{ number: '1', text: 'nine', chunkIds: ['c1'] }],
      result: {
        assignments: [{ questionId: 'q1', status: 'matched', reason: 'number-unique', answerIndex: 0 }],
        unmatchedAnswers: [],
      },
    }), [question({
      answerStatus: 'matched', answerText: 'nine',
      generationStatus: 'failed', generationError: 'The model response was cut off.',
    })])
    expect(await screen.findByText(/The model response was cut off/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry this question' }))
    await waitFor(() => expect(generateAnswerContent).toHaveBeenCalledWith('s1', ['q1'], expect.any(Function)))
  })
})
