import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuidedPracticeView } from '@/widgets/homework/guided/GuidedPracticeView'
import { buildGuidedChains } from '@/entities/homework/guidedMatrix'
import {
  blankStepsKey,
  chainsKey,
  progressFor,
  type GuidedProgress,
} from '@/entities/homework/guided'
import type { GuidedQuestionState, GuidedStepsService } from '@/services/guidedStepsService'
import type { HomeworkQuestion } from '@/entities/homework/types'

const matrix = (rows: number[][]) =>
  `$$\\left[\\begin{array}{cc|c} ${rows.map((row) => row.join(' & ')).join(' \\\\ ')} \\end{array}\\right]$$`

const BODY = [
  '增广矩阵为',
  '',
  matrix([
    [2, 4, 6],
    [1, 3, 5],
  ]),
  '',
  '先把主元化为 1，作 $R_1 \\to \\tfrac{1}{2}R_1$：',
  '',
  matrix([
    [1, 2, 3],
    [1, 3, 5],
  ]),
  '',
  '作 $R_2 \\to R_2 - R_1$：',
  '',
  matrix([
    [1, 2, 3],
    [0, 1, 2],
  ]),
  '',
  '作 $R_1 \\to R_1 - 2R_2$：',
  '',
  matrix([
    [1, 0, -1],
    [0, 1, 2],
  ]),
].join('\n')

const QUESTION: HomeworkQuestion = {
  id: 'q1',
  projectId: 'p1',
  setId: 's1',
  documentId: 'd1',
  documentName: 'hw.txt',
  order: 0,
  number: '1',
  prompt: 'Solve the linear system.',
  sourceRefs: [],
  hints: [],
  generationStatus: 'ready',
  promptVersion: 'v1',
  draftText: '',
  revealedHints: 0,
  solutionRevealed: false,
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

function stub(state: Omit<GuidedQuestionState, 'question' | 'hasAI'>) {
  const saved: GuidedProgress[] = []
  const service = {
    load: vi.fn(async () => ({ question: QUESTION, hasAI: true, ...state })),
    saveProgress: vi.fn(async (_id: string, progress: GuidedProgress) => {
      saved.push(progress)
    }),
    resetProgress: vi.fn(async () => undefined),
    prepareSteps: vi.fn(),
  } as unknown as GuidedStepsService
  return { service, saved }
}

describe('GuidedPracticeView — row reduction', () => {
  it('unlocks the matrix after a correct operation, checks cells, marks hints and answers', async () => {
    const user = userEvent.setup()
    const chains = buildGuidedChains(BODY)
    const key = chainsKey(chains)
    const { service, saved } = stub({
      level: 'standard',
      source: { kind: 'matrix', chains, key },
      progress: progressFor(undefined, 'matrix', key, chains.length),
    })
    render(
      <GuidedPracticeView
        setId="s1"
        question={QUESTION}
        onOpenWalkthrough={vi.fn()}
        service={service}
      />,
    )

    const op = await screen.findByLabelText('Row operation for this step')
    expect(
      screen.getByText('The resulting matrix opens once the operation is correct.'),
    ).toBeInTheDocument()

    // Not an elementary operation: rejected, the matrix stays locked.
    await user.type(op, 'R2 -> 2R1{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('not an elementary row operation')
    expect(screen.queryByLabelText('Row 1, column 1')).not.toBeInTheDocument()

    await user.clear(op)
    await user.type(op, 'R1 -> 1/2 R1')
    await user.click(screen.getByRole('button', { name: 'Check operation' }))
    expect(screen.getByText(/Correct operation/)).toBeInTheDocument()

    // Row 2 does not change: fill it in one click.
    await user.click(screen.getByRole('button', { name: 'Fill unchanged rows' }))
    expect(screen.getByLabelText('Row 2, column 1')).toHaveValue('1')
    expect(screen.getByLabelText('Row 2, column 3')).toHaveValue('5')

    await user.type(screen.getByLabelText('Row 1, column 1'), '1')
    await user.type(screen.getByLabelText('Row 1, column 2'), '2')
    await user.type(screen.getByLabelText('Row 1, column 3'), '4{Enter}')
    const problems = screen.getByRole('alert')
    expect(within(problems).getByText(/Row 1, column 3/)).toBeInTheDocument()
    expect(problems).toHaveTextContent('compute')
    expect(screen.getByLabelText('Row 1, column 3')).toHaveAttribute('aria-invalid', 'true')

    await user.clear(screen.getByLabelText('Row 1, column 3'))
    await user.type(screen.getByLabelText('Row 1, column 3'), '3{Enter}')
    expect(await screen.findByText('Correct — on to the next step.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Step 2' })).toBeInTheDocument()

    // Hint for step 2, then show its answer: both are recorded.
    await user.click(screen.getByRole('button', { name: 'Hint' }))
    expect(document.querySelector('[data-guided-hint]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show this step' }))
    expect(screen.getByRole('heading', { name: 'Step 3' })).toBeInTheDocument()
    expect(screen.getByText('Hint used')).toBeInTheDocument()
    expect(screen.getByText('Answer viewed')).toBeInTheDocument()

    await waitFor(() => expect(saved.length).toBeGreaterThan(0))
    const last = saved[saved.length - 1]!
    expect(last.chains![0]!.records).toHaveLength(2)
    expect(last.chains![0]!.records[1]).toMatchObject({ hintViewed: true, answerViewed: true })

    // Last step on their own → summary.
    await user.type(screen.getByLabelText('Row operation for this step'), 'R1 -> R1 - 2R2{Enter}')
    await user.click(screen.getByRole('button', { name: 'Show this step' }))
    expect(await screen.findByText('Summary')).toBeInTheDocument()
    expect(screen.getByText('Steps done: 3')).toBeInTheDocument()
    expect(screen.getByText(/agrees with the walkthrough/)).toBeInTheDocument()
  })

  it('resumes saved progress', async () => {
    const chains = buildGuidedChains(BODY)
    const key = chainsKey(chains)
    const progress: GuidedProgress = {
      ...progressFor(undefined, 'matrix', key, 1),
      chains: [
        {
          records: [{ op: 'R_1 \\to \\tfrac{1}{2}R_1' }],
          pending: {
            typedOp: 'R2 -> R2 - R1',
            op: 'R_2 \\to R_2 - R_1',
            cells: [
              ['1', '', ''],
              ['', '', ''],
            ],
          },
        },
      ],
    }
    const { service } = stub({
      level: 'standard',
      source: { kind: 'matrix', chains, key },
      progress,
    })
    render(
      <GuidedPracticeView
        setId="s1"
        question={QUESTION}
        onOpenWalkthrough={vi.fn()}
        service={service}
      />,
    )
    expect(await screen.findByRole('heading', { name: 'Step 2' })).toBeInTheDocument()
    expect(screen.getByLabelText('Row operation for this step')).toHaveValue('R2 -> R2 - R1')
    expect(screen.getByLabelText('Row 1, column 1')).toHaveValue('1')
  })

  it('asks for the walkthrough first when there is none', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const { service } = stub({
      level: 'standard',
      source: { kind: 'no-walkthrough' },
      progress: null,
    })
    render(
      <GuidedPracticeView
        setId="s1"
        question={QUESTION}
        onOpenWalkthrough={open}
        service={service}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Open the walkthrough' }))
    expect(open).toHaveBeenCalled()
  })
})

describe('GuidedPracticeView — blanks', () => {
  it('grades blanks locally and completes the steps', async () => {
    const user = userEvent.setup()
    const steps = [
      {
        title: 'Speed',
        text: 'The final speed is [[1]].',
        explanation: 'Use v = at.',
        blanks: [{ id: '1', answer: '19.6 m/s', kind: 'quantity' as const }],
      },
    ]
    const key = blankStepsKey(steps)
    const { service } = stub({
      level: 'standard',
      subject: 'physics',
      source: { kind: 'blanks', steps, key, droppedBlanks: 0 },
      progress: progressFor(undefined, 'blanks', key, 1),
    })
    render(
      <GuidedPracticeView
        setId="s1"
        question={QUESTION}
        onOpenWalkthrough={vi.fn()}
        service={service}
      />,
    )
    const field = await screen.findByLabelText('Blank 1')
    await user.type(field, '19.6')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('Add the unit.')).toBeInTheDocument()
    await user.type(field, ' m/s')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Summary')).toBeInTheDocument()
    expect(screen.getByText('All steps on your own — well done.')).toBeInTheDocument()
  })
})
