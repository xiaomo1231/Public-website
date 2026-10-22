import 'fake-indexeddb/auto'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuidedMatrixPractice } from '@/widgets/homework/guided/GuidedMatrixPractice'
import { GuidedBlankPractice } from '@/widgets/homework/guided/GuidedBlankPractice'
import { MatrixInputGrid } from '@/widgets/homework/guided/MatrixParts'
import { AnswerInput } from '@/widgets/quiz/AnswerInput'
import { buildGuidedChains } from '@/entities/homework/guidedMatrix'
import type { GuidedBlankStepProgress, GuidedChainProgress } from '@/entities/homework/guided'
import type { Question } from '@/entities/question/types'

const matrix = (rows: number[][]) =>
  `$$\\left[\\begin{array}{cc|c} ${rows.map((row) => row.join(' & ')).join(' \\\\ ')} \\end{array}\\right]$$`

const BODY = [
  matrix([
    [1, 2, 3],
    [2, 1, 4],
    [3, 3, 7],
  ]),
  '',
  '作 $R_2 \\to R_2 - 2R_1$：',
  '',
  matrix([
    [1, 2, 3],
    [0, -3, -2],
    [3, 3, 7],
  ]),
].join('\n')

function MatrixHarness(): JSX.Element {
  const chains = buildGuidedChains(BODY)
  const [progress, setProgress] = useState<GuidedChainProgress[]>([{ records: [] }])
  return (
    <GuidedMatrixPractice
      chains={chains}
      progress={progress}
      onChange={(index, next) =>
        setProgress((current) => current.map((item, i) => (i === index ? next : item)))
      }
    />
  )
}

describe('row-operation quick insert', () => {
  it('offers R1…Rn for the matrix, fills templates at the caret and keeps focus', async () => {
    const user = userEvent.setup()
    render(<MatrixHarness />)
    const op = screen.getByLabelText('Row operation for this step') as HTMLInputElement
    const bar = screen.getByRole('group', { name: 'Quick insert for the row operation' })
    const rows = within(bar)
      .getAllByRole('button')
      .filter((button) => /^R\d+$/.test(button.textContent ?? ''))
    expect(rows.map((button) => button.textContent)).toEqual(['R1', 'R2', 'R3'])
    expect(within(bar).getByRole('button', { name: /^Swap/ })).toHaveTextContent('Swap')
    expect(within(bar).getByRole('button', { name: /^Scale/ })).toBeInTheDocument()

    await user.click(op)
    await user.click(within(bar).getByRole('button', { name: /^Add a multiple of a row/ }))
    expect(op).toHaveValue('R? -> R? - ?R?')
    expect(op).toHaveFocus()
    expect([op.selectionStart, op.selectionEnd]).toEqual([1, 2])

    // Row buttons fill the `?` of `R?`; typing replaces a `?`; Tab goes on.
    await user.click(within(bar).getByRole('button', { name: 'Insert R2' }))
    expect(op).toHaveValue('R2 -> R? - ?R?')
    expect(op).toHaveFocus()
    await user.click(within(bar).getByRole('button', { name: 'Insert R2' }))
    await user.keyboard('2')
    expect(op).toHaveValue('R2 -> R2 - 2R?')
    await user.keyboard('{Tab}')
    expect(op).toHaveFocus()
    expect(op.value.slice(op.selectionStart!, op.selectionEnd!)).toBe('?')
    await user.keyboard('1')
    expect(op).toHaveValue('R2 -> R2 - 2R1')

    // Inserted at the caret, not at the end.
    act(() => op.setSelectionRange(2, 2))
    await user.click(
      within(bar).getByRole('button', { name: 'Delete the character before the cursor' }),
    )
    expect(op).toHaveValue('R -> R2 - 2R1')
    expect(op.selectionStart).toBe(1)
    await user.click(within(bar).getByRole('button', { name: 'Insert R2' }))
    expect(op).toHaveValue('RR2 -> R2 - 2R1')
    expect(op).toHaveFocus()
  })
})

describe('matrix cell quick insert', () => {
  it('shows − and / while a cell is focused and inserts into that cell', async () => {
    const user = userEvent.setup()
    function Grid(): JSX.Element {
      const [values, setValues] = useState([
        ['', ''],
        ['', ''],
      ])
      return (
        <>
          <MatrixInputGrid
            values={values}
            label="Result"
            onSubmit={() => undefined}
            onChange={(r, c, value) =>
              setValues((current) =>
                current.map((row, rr) =>
                  row.map((cell, cc) => (rr === r && cc === c ? value : cell)),
                ),
              )
            }
          />
          <button type="button">outside</button>
        </>
      )
    }
    render(<Grid />)
    expect(screen.queryByRole('group', { name: /Quick insert for row/ })).not.toBeInTheDocument()
    const cell = screen.getByLabelText('Row 2, column 1')
    await user.click(cell)
    const bar = screen.getByRole('group', { name: 'Quick insert for row 2, column 1' })
    await user.click(within(bar).getByRole('button', { name: 'Insert -' }))
    await user.keyboard('3')
    await user.click(within(bar).getByRole('button', { name: 'Insert /' }))
    await user.keyboard('2')
    expect(cell).toHaveValue('-3/2')
    expect(cell).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('group', { name: /Quick insert for row/ })).not.toBeInTheDocument()
  })
})

describe('guided blank quick insert', () => {
  it('gives each blank the symbols of its kind', async () => {
    const steps = [
      {
        text: 'v = [[1]], x(t) = [[2]], reaction [[3]], organelle [[4]].',
        explanation: '',
        blanks: [
          { id: '1', answer: '19.6 m/s', kind: 'quantity' as const },
          { id: '2', answer: 'v0*t + a*t^2/2', kind: 'expression' as const },
          { id: '3', answer: '2H2 + O2 -> 2H2O', kind: 'chemistry' as const },
          { id: '4', answer: 'mitochondria', kind: 'text' as const },
        ],
      },
    ]
    function Harness(): JSX.Element {
      const [progress, setProgress] = useState<GuidedBlankStepProgress[]>([{ values: {} }])
      return (
        <GuidedBlankPractice
          steps={steps}
          progress={progress}
          subject="physics"
          onChange={(index, next) =>
            setProgress((current) => current.map((item, i) => (i === index ? next : item)))
          }
        />
      )
    }
    const user = userEvent.setup()
    render(<Harness />)
    const blocks = document.querySelectorAll<HTMLElement>('[data-blank-kind]')
    const barOf = (kind: string) =>
      [...blocks]
        .find((block) => block.dataset.blankKind === kind)!
        .querySelector<HTMLElement>('[data-quick-insert]')
    const faces = (kind: string) =>
      [...within(barOf(kind)!).getAllByRole('button')].map((button) => button.textContent)

    expect(faces('quantity')).toEqual(expect.arrayContaining(['m/s', 'm', 's', '·', '×10ⁿ']))
    expect(faces('expression')).toEqual(expect.arrayContaining(['v0', 'a', 't', 'xⁿ', '√', 'π']))
    expect(faces('chemistry')).toEqual(expect.arrayContaining(['→', '⇌', '(aq)', '(g)', '⁺']))
    expect(barOf('text')).toBeNull()

    const field = screen.getByLabelText('Blank 1')
    await user.click(field)
    await user.keyboard('19.6')
    await user.click(within(barOf('quantity')!).getByRole('button', { name: 'Insert m/s' }))
    expect(field).toHaveValue('19.6 m/s')
    expect(field).toHaveFocus()
  })
})

describe('quiz expression quick insert', () => {
  it('shows the variables of the expected answer', () => {
    const question: Question = {
      id: 'q1',
      projectId: 'p1',
      knowledgePoint: 'Integrals',
      type: 'math_expr',
      difficulty: 'basic',
      prompt: '∫ 2u du',
      correctAnswer: 'u^2 + C',
      hints: [],
      sourceRefs: [],
      promptVersion: 'v1',
      createdAt: 1,
    }
    render(<AnswerInput question={question} value="" onChange={() => undefined} />)
    const bar = screen.getByRole('group', { name: 'Quick insert' })
    expect(within(bar).getByRole('button', { name: 'Insert u' })).toBeInTheDocument()
    expect(within(bar).queryByRole('button', { name: 'Insert C' })).not.toBeInTheDocument()
  })
})
