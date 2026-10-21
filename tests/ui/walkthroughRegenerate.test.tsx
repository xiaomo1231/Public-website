import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeworkWalkthroughPanel } from '@/widgets/homework/walkthrough/HomeworkWalkthroughPanel'
import type { HomeworkSet } from '@/entities/homework/types'

const hook = vi.hoisted(() => ({
  regenerateSection: vi.fn(async () => ({ generated: 1, failed: 0 })),
  restorePrevious: vi.fn(async () => true),
}))

const question = (id: string, prompt: string) => ({ id, number: id.slice(1), prompt })

vi.mock('@/features/homework/useWalkthrough', () => ({
  useWalkthrough: () => ({
    state: {
      language: 'en',
      questions: [question('q1', 'Solve the system.'), question('q2', '(a) x (b) y (c) z')],
      plan: [
        {
          id: 'q:q1',
          kind: 'question',
          question: question('q1', 'Solve the system.'),
          inputHash: 'h',
          needsWork: false,
          outdated: false,
          section: {
            id: 'q:q1',
            kind: 'question',
            title: '1',
            body: 'Second version of the work.',
            status: 'ready',
            inputHash: 'h',
            generatedAt: 2,
            previous: { body: 'First version.', inputHash: 'h', generatedAt: 1 },
          },
        },
        {
          id: 'q:q2',
          kind: 'question',
          question: question('q2', '(a) x (b) y (c) z'),
          inputHash: 'h2',
          needsWork: true,
          outdated: false,
          section: {
            id: 'q:q2',
            kind: 'question',
            title: '2',
            body: '',
            status: 'partial',
            inputHash: 'h2',
            generatedAt: 2,
            draft: {
              mode: 'generate',
              inputHash: 'h2',
              labels: ['a', 'b', 'c'],
              parts: [
                { label: 'a', heading: 'Find x', conclusion: 'x = 1', body: 'Work for a.' },
                { label: 'b', heading: 'Find y', conclusion: 'y = 2', body: 'Work for b.' },
              ],
              startedAt: 1,
            },
          },
        },
      ],
    },
    notes: [],
    progress: undefined,
    loading: false,
    error: null,
    generate: vi.fn(async () => ({ generated: 1, failed: 0 })),
    aiReady: true,
    regenerateSection: hook.regenerateSection,
    restorePrevious: hook.restorePrevious,
  }),
}))
vi.mock('@/features/homework/useHomeworkService', () => ({ useHomeworkService: () => null }))

const set = {
  id: 's1',
  projectId: 'p1',
  title: 'HW3',
  walkthroughNoticeSeenAt: 1,
} as unknown as HomeworkSet

describe('regenerating one walkthrough section', () => {
  it('opens the suggestion dialog and regenerates the section with it', async () => {
    const user = userEvent.setup()
    render(<HomeworkWalkthroughPanel set={set} mode="review" />)
    const q1 = document.getElementById('wt-q:q1')!
    await user.click(within(q1).getByRole('button', { name: 'Regenerate this section' }))
    const dialog = screen.getByRole('dialog', { name: /Regenerate “Question 1”/ })
    const field = within(dialog).getByLabelText('Suggestions (optional)')
    expect(field).toHaveAttribute('placeholder', expect.stringContaining('free variable'))
    await user.type(field, 'Use s for the free variable')
    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }))
    expect(hook.regenerateSection).toHaveBeenCalledWith('q:q1', 'Use s for the free variable')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('restores the previous version', async () => {
    const user = userEvent.setup()
    render(<HomeworkWalkthroughPanel set={set} mode="review" />)
    const q1 = document.getElementById('wt-q:q1')!
    await user.click(within(q1).getByRole('button', { name: 'Restore previous version' }))
    expect(hook.restorePrevious).toHaveBeenCalledWith('q:q1')
  })

  it('shows the finished sub-parts of a partly written question with a continue button', () => {
    render(<HomeworkWalkthroughPanel set={set} mode="review" />)
    const q2 = document.getElementById('wt-q:q2')!
    expect(within(q2).getByText('2 / 3 sub-questions written')).toBeInTheDocument()
    expect(within(q2).getByText('Work for b.')).toBeInTheDocument()
    expect(within(q2).getByRole('button', { name: 'Continue writing' })).toBeInTheDocument()
    // Not finished: no 重新生成 for it yet.
    expect(within(q2).queryByRole('button', { name: 'Regenerate this section' })).toBeNull()
  })
})
