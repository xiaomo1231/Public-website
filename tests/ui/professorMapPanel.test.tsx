import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HomeworkAnswerDialog } from '@/widgets/homework/HomeworkAnswerDialog'
import { ProfessorMapPanel } from '@/widgets/homework/ProfessorMapPanel'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import type { HomeworkService } from '@/services/homeworkService'
import { withProfessorMapEdit } from '@/entities/homework/professorMap'

// Synthetic: (a) only follows from (b)'s work; (c) says "same as part (f)".
const PROMPT = [
  'Let V be the set of all (p, q, r) in R^3 with p + q - r = 0.',
  '(a) Show that V is a subspace of R^3.',
  '(b) Find a basis of V.',
  '(c) Show that the basis in (b) can be listed in either order.',
].join('\n')
const ANSWER = [
  '(b) Solving r = p + q, V = span{(1, 0, 1), (0, 1, 1)} and the two vectors are independent.',
  '(c) This is the same as part (f): the order does not matter.',
].join('\n')

function question(over: Partial<HomeworkQuestion> = {}): HomeworkQuestion {
  return {
    id: 'q1',
    projectId: 'p1',
    setId: 's1',
    documentId: 'd1',
    documentName: 'hw.txt',
    order: 0,
    number: '1',
    prompt: PROMPT,
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
    answerStatus: 'matched',
    answerText: ANSWER,
    answerNumber: '1',
    ...over,
  }
}

describe('ProfessorMapPanel', () => {
  it('shows each sub-part with its excerpts and 「请确认」 on the uncertain ones', async () => {
    const service = {
      remapProfessorAnswer: vi.fn(),
      setProfessorMapEdit: vi.fn(),
    }
    render(<ProfessorMapPanel question={question()} service={service} onQuestionChange={vi.fn()} />)
    const rows = document.querySelectorAll('[data-map-part]')
    expect([...rows].map((row) => row.getAttribute('data-map-part'))).toEqual(['a', 'b', 'c'])
    // (a): no label in the key — not located; (c): a reference to a missing part.
    expect(rows[0]!.getAttribute('data-map-coverage')).toBe('unlocated')
    expect(rows[1]!.getAttribute('data-map-coverage')).toBe('direct')
    expect(within(rows[1] as HTMLElement).getByText(/Solving r = p \+ q/)).toBeInTheDocument()
    expect(rows[0]!.querySelector('[data-map-confirm-badge]')).not.toBeNull()
    expect(rows[2]!.querySelector('[data-map-confirm-badge]')).not.toBeNull()
    expect(document.querySelector('[data-map-to-confirm]')?.textContent).toMatch(/2/)
  })

  it('saves the student’s choice: pick an excerpt for (a)', async () => {
    const user = userEvent.setup()
    const updated = question({
      professorMapEdits: withProfessorMapEdit(question(), 'a', {
        coverage: 'indirect',
        quotes: [ANSWER.split('\n')[0]!],
      }),
    })
    const service = {
      remapProfessorAnswer: vi.fn(),
      setProfessorMapEdit: vi.fn(async () => updated),
    }
    const onQuestionChange = vi.fn()
    render(
      <ProfessorMapPanel
        question={question()}
        service={service}
        onQuestionChange={onQuestionChange}
      />,
    )
    const rowA = document.querySelector('[data-map-part="a"]') as HTMLElement
    await user.click(within(rowA).getByRole('button', { name: /Change/ }))
    await user.click(within(rowA).getByRole('radio', { name: /Indirect/ }))
    const save = within(rowA).getByRole('button', { name: /^Save$/ })
    expect(save).toBeDisabled()
    const boxes = rowA.querySelectorAll('[data-map-segment]')
    await user.click(boxes[0] as HTMLElement)
    await user.click(save)
    await waitFor(() => expect(service.setProfessorMapEdit).toHaveBeenCalled())
    expect(service.setProfessorMapEdit).toHaveBeenCalledWith('q1', 'a', {
      coverage: 'indirect',
      quotes: [ANSWER.split('\n')[0]],
    })
    expect(onQuestionChange).toHaveBeenCalledWith(updated)
  })

  it('shows an edit as the student’s choice, without 「请确认」, with a reset', () => {
    const edited = question({
      professorMapEdits: withProfessorMapEdit(question(), 'a', { coverage: 'none', quotes: [] }),
    })
    render(
      <ProfessorMapPanel
        question={edited}
        service={{ remapProfessorAnswer: vi.fn(), setProfessorMapEdit: vi.fn() }}
        onQuestionChange={vi.fn()}
      />,
    )
    const rowA = document.querySelector('[data-map-part="a"]') as HTMLElement
    expect(rowA.getAttribute('data-map-coverage')).toBe('none')
    expect(within(rowA).getByText('Your choice')).toBeInTheDocument()
    expect(rowA.querySelector('[data-map-confirm-badge]')).toBeNull()
    expect(within(rowA).getByRole('button', { name: /Back to automatic/ })).toBeInTheDocument()
  })

  it('asks the AI to map by content and shows its result', async () => {
    const user = userEvent.setup()
    const remapped = question({
      professorMap: {
        answerHash: '',
        questionHash: '',
        promptVersion: 'professor-answer-map/v1',
        entries: [],
        createdAt: 1,
      },
    })
    const service = {
      remapProfessorAnswer: vi.fn(async () => remapped),
      setProfessorMapEdit: vi.fn(),
    }
    const onQuestionChange = vi.fn()
    render(
      <ProfessorMapPanel
        question={question()}
        service={service}
        onQuestionChange={onQuestionChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Map by content/ }))
    await waitFor(() => expect(onQuestionChange).toHaveBeenCalledWith(remapped))
  })
})

describe('HomeworkAnswerDialog shows the map for a confirmed answer', () => {
  it('renders the panel under the selected answer', async () => {
    const set: HomeworkSet = {
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
    const service = {
      buildAnswerMapping: vi.fn(async () => ({
        document: { id: 'a1', name: 'answers.pdf', status: 'ready' },
        entries: [{ number: '1', text: ANSWER, chunkIds: ['c1'], pageNumbers: [1] }],
        lines: [],
        manual: false,
        summary: { total: 1, numbered: 1, unnumbered: 0, unsplit: false },
        result: {
          assignments: [
            { questionId: 'q1', status: 'matched', reason: 'number-unique', answerIndex: 0 },
          ],
          unmatchedAnswers: [],
        },
      })),
      listQuestions: vi.fn(async () => [question()]),
      remapProfessorAnswer: vi.fn(),
      setProfessorMapEdit: vi.fn(),
    } as unknown as HomeworkService
    render(
      <MemoryRouter>
        <HomeworkAnswerDialog
          projectId="p1"
          set={set}
          service={service}
          open
          onOpenChange={vi.fn()}
          onRequestUpload={vi.fn()}
          onChanged={vi.fn()}
        />
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('[data-professor-map]')).not.toBeNull())
    expect(document.querySelectorAll('[data-map-part]')).toHaveLength(3)
  })
})
