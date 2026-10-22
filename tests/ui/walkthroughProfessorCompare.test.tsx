import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeworkWalkthroughPanel } from '@/widgets/homework/walkthrough/HomeworkWalkthroughPanel'
import type { HomeworkSet } from '@/entities/homework/types'

const hook = vi.hoisted(() => ({
  compareSection: vi.fn(async () => ({ generated: 1, failed: 0 })),
  compareAll: vi.fn(async () => ({ generated: 1, failed: 0 })),
  alignToProfessor: vi.fn(async () => ({ generated: 1, failed: 0 })),
  dismissCompare: vi.fn(async () => {}),
}))

const { ANSWER } = vi.hoisted(() => ({
  ANSWER: '(a) Solution: row reduce with R1/2 first; three pivot columns.',
}))

vi.mock('@/features/homework/useWalkthrough', async () => {
  const compare = await import('@/entities/homework/professorCompare')
  const question = (id: string, number: string) => ({
    id,
    number,
    prompt: '(a) Show it. (b) Find it.',
    answerStatus: 'matched',
    answerText: ANSWER,
  })
  const ready = (id: string, body: string, extra: object = {}) => ({
    id,
    kind: 'question',
    title: id,
    conclusion: 'Independent.',
    body,
    status: 'ready',
    inputHash: 'h',
    generatedAt: 1,
    ...extra,
  })
  const s1 = ready('q:q1', 'Swap R1 and R2 first.')
  const report = {
    answerHash: compare.professorAnswerHash(ANSWER),
    sectionHash: compare.compareSectionHash(s1),
    items: [
      {
        label: 'a',
        status: 'method_differs',
        note: 'The professor divides R1 by 2 first.',
        professorQuote: 'row reduce with R1/2 first',
      },
      { label: 'b', status: 'not_in_professor', note: 'No professor solution.' },
    ],
    recommendation: 'align',
    suggestion: 'Start with R1/2.',
    comparedAt: 1,
  }
  return {
    useWalkthrough: () => ({
      state: {
        language: 'en',
        questions: [question('q1', '1'), question('q2', '2'), question('q3', '3')],
        plan: [
          {
            id: 'q:q1',
            kind: 'question',
            question: question('q1', '1'),
            inputHash: 'h',
            needsWork: false,
            outdated: false,
            section: { ...s1, professorCompare: report },
          },
          {
            id: 'q:q2',
            kind: 'question',
            question: question('q2', '2'),
            inputHash: 'h',
            needsWork: false,
            outdated: false,
            section: ready('q:q2', 'Aligned work.', {
              professorAligned: { answerHash: compare.professorAnswerHash(ANSWER) },
            }),
          },
          {
            id: 'q:q3',
            kind: 'question',
            question: question('q3', '3'),
            inputHash: 'h',
            needsWork: false,
            outdated: false,
            section: ready('q:q3', 'Older work.'),
          },
        ],
      },
      notes: [],
      progress: undefined,
      loading: false,
      error: null,
      generate: vi.fn(),
      aiReady: true,
      regenerateSection: vi.fn(),
      setLevel: vi.fn(),
      generateVariants: vi.fn(),
      ...hook,
    }),
  }
})
vi.mock('@/features/homework/useHomeworkService', () => ({ useHomeworkService: () => null }))

const set = {
  id: 's1',
  projectId: 'p1',
  title: 'PS4',
  walkthroughNoticeSeenAt: 1,
} as unknown as HomeworkSet

describe('与教授答案对照', () => {
  it('lists the comparison per sub-part and rewrites following the professor on click', async () => {
    const user = userEvent.setup()
    render(<HomeworkWalkthroughPanel set={set} mode="review" />)
    const q1 = document.getElementById('wt-q:q1')!
    const report = q1.querySelector('[data-professor-compare]') as HTMLElement
    expect(report).not.toBeNull()
    expect(within(report).getByText('Method differs')).toBeInTheDocument()
    expect(within(report).getByText('Not solved by professor')).toBeInTheDocument()
    expect(within(report).getByText('The professor divides R1 by 2 first.')).toBeInTheDocument()
    await user.click(within(report).getByRole('button', { name: 'Rewrite to match professor' }))
    expect(hook.alignToProfessor).toHaveBeenCalledWith(
      'q:q1',
      expect.stringContaining('(a) method differs from the professor: The professor divides R1'),
    )
    await user.click(within(report).getByRole('button', { name: 'Keep as is' }))
    expect(hook.dismissCompare).toHaveBeenCalledWith('q:q1')
  })

  it('marks aligned sections, offers a comparison per section and for all waiting ones', async () => {
    const user = userEvent.setup()
    render(<HomeworkWalkthroughPanel set={set} mode="review" />)
    const q2 = document.getElementById('wt-q:q2')!
    expect(within(q2).getByText('Follows professor’s answer')).toBeInTheDocument()
    const q3 = document.getElementById('wt-q:q3')!
    expect(within(q3).queryByText('Follows professor’s answer')).toBeNull()
    await user.click(within(q3).getByRole('button', { name: 'Compare with professor' }))
    expect(hook.compareSection).toHaveBeenCalledWith('q:q3')
    // Only q3 is neither aligned nor compared.
    const prompt = document.querySelector('[data-compare-prompt]') as HTMLElement
    expect(prompt).toHaveTextContent('1 questions have professor answers to compare')
    await user.click(
      within(prompt).getByRole('button', { name: 'Compare all with professor answers' }),
    )
    expect(hook.compareAll).toHaveBeenCalled()
  })
})
