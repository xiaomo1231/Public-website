import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HomeworkWalkthroughPanel } from '@/widgets/homework/walkthrough/HomeworkWalkthroughPanel'
import type { HomeworkSet } from '@/entities/homework/types'

const hook = vi.hoisted(() => ({
  setSource: vi.fn(async () => {}),
  setLevel: vi.fn(async () => {}),
}))

vi.mock('@/features/homework/useWalkthrough', () => {
  const question = (id: string, number: string) => ({
    id,
    number,
    prompt: 'Solve the system.',
  })
  const generated = (id: string, body: string, extra: object = {}) => ({
    id,
    kind: 'question',
    questionId: id.slice(2),
    title: id,
    conclusion: 'Unique solution.',
    body,
    status: 'ready',
    inputHash: 'h',
    generatedAt: 1,
    ...extra,
  })
  const imported = {
    ...generated('q:q1', 'Imported working of the author.'),
    origin: 'imported',
    sourceDocumentId: 'd1',
    alternate: generated('q:q1', 'Generated working.', { level: 'detailed' }),
  }
  return {
    useWalkthrough: () => ({
      state: {
        language: 'en',
        questions: [question('q1', '1'), question('q2', '2')],
        plan: [
          {
            id: 'q:q1',
            kind: 'question',
            question: question('q1', '1'),
            inputHash: 'h',
            needsWork: false,
            outdated: false,
            section: imported,
            generated: imported.alternate,
          },
          {
            id: 'q:q2',
            kind: 'question',
            question: question('q2', '2'),
            inputHash: 'h',
            needsWork: false,
            outdated: false,
            section: generated('q:q2', 'Only generated.'),
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
      generateVariants: vi.fn(),
      restorePrevious: vi.fn(),
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

describe('生成的讲解 / 导入的讲解', () => {
  it('shows the switch only with two sources, and switches on click', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <HomeworkWalkthroughPanel set={set} mode="review" />
      </MemoryRouter>,
    )
    const q1 = document.getElementById('wt-q:q1')!
    const group = within(q1).getByRole('group', { name: /source/i })
    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    const importedButton = buttons.find((button) => button.textContent === 'Imported')!
    const generatedButton = buttons.find((button) => button.textContent === 'Generated')!
    expect(importedButton).toHaveAttribute('aria-pressed', 'true')
    expect(generatedButton).toHaveAttribute('aria-pressed', 'false')
    // The import has one level: no 普通 / 详细 toggle while it is shown.
    expect(q1.querySelector('[data-walkthrough-level]')).toBeNull()
    expect(q1.textContent).toContain('Imported working of the author.')
    expect(q1.textContent).not.toContain('Generated working.')
    // The regenerate button says it rewrites the generated version.
    expect(within(q1).getByRole('button', { name: /regenerate/i })).toHaveAttribute(
      'title',
      expect.stringMatching(/generated/i),
    )

    await user.click(generatedButton)
    expect(hook.setSource).toHaveBeenCalledWith('q:q1', 'generated')

    const q2 = document.getElementById('wt-q:q2')!
    expect(q2.querySelector('[data-walkthrough-source]')).toBeNull()
    expect(q2.querySelector('[data-walkthrough-level]')).not.toBeNull()
  })

  it('prints the source shown', () => {
    vi.useFakeTimers()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    render(
      <MemoryRouter>
        <HomeworkWalkthroughPanel set={set} mode="review" />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /print/i })[0]!)
    const sheet = document.getElementById('walkthrough-print')!
    expect(sheet.textContent).toContain('Imported working of the author.')
    expect(sheet.textContent).not.toContain('Generated working.')
    vi.runOnlyPendingTimers()
    print.mockRestore()
    vi.useRealTimers()
  })
})
