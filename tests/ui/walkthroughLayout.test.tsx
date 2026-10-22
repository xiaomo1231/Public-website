import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WalkthroughBody } from '@/widgets/homework/walkthrough/WalkthroughBody'
import { HomeworkWalkthroughPanel } from '@/widgets/homework/walkthrough/HomeworkWalkthroughPanel'
import type { HomeworkSet } from '@/entities/homework/types'

const HW3 = [
  '### (a) 判断方程组是否相容',
  '',
  '$$\\left[\\begin{array}{ccc|c} 1 & 2 & 0 & 3 \\\\ 2 & 1 & 1 & 4 \\\\ 3 & 0 & 1 & 1 \\end{array}\\right]$$',
  '',
  '作 $R_2 \\to R_2 - 2R_1$，$R_3 \\to R_3 - 3R_1$：',
  '',
  // Row 3, column 4 is wrong on purpose: 1 - 3·3 = -8, written -7.
  '$$\\left[\\begin{array}{ccc|c} 1 & 2 & 0 & 3 \\\\ 0 & -3 & 1 & -2 \\\\ 0 & -6 & 1 & -7 \\end{array}\\right]$$',
  '',
  '所以第一列已消去。',
  '',
  '### (b) 另一问',
  '',
  '这一问只需要读出结果。',
].join('\n')

describe('walkthrough body layout (2k)', () => {
  it('limits the reading width and carries both interface styles', () => {
    const { container } = render(<WalkthroughBody text="A sentence." />)
    const body = container.querySelector('[data-walkthrough-body]')!
    expect(body.className).toContain('max-w-[70ch]')
    expect(body.className).toContain('tabular-nums')
    expect(body.className).toMatch(/lecture:\[&_h3\]/)
    expect(body.className).toMatch(/lab:\[&_h3\]/)
  })

  it('shows a row operation as a numbered step card with before → after', () => {
    const { container } = render(<WalkthroughBody text={HW3} conclusion="(a) 相容; (b) 唯一解" />)
    const step = container.querySelector('[data-walkthrough-step="1"]')!
    expect(step).not.toBeNull()
    expect(step.className).toContain('border-l-2')
    expect(step.querySelectorAll('table')).toHaveLength(2)
    // Changed rows are highlighted; unchanged ones are not.
    const after = step.querySelectorAll('table')[1]!
    const rows = after.querySelectorAll('tr')
    expect(rows[0]!.hasAttribute('data-changed')).toBe(false)
    expect(rows[1]!.hasAttribute('data-changed')).toBe(true)
    expect(rows[2]!.hasAttribute('data-changed')).toBe(true)
    // The text around the step stays.
    expect(screen.getByText('所以第一列已消去。')).toBeInTheDocument()
  })

  it('explains a changed entry on hover and focus, computed locally', () => {
    const { container } = render(<WalkthroughBody text={HW3} />)
    const after = container.querySelectorAll('[data-walkthrough-step="1"] table')[1]!
    const cell = after.querySelectorAll('tr')[1]!.querySelectorAll('td')[1]!
    expect(cell).toHaveAttribute('tabindex', '0')
    const description = document.getElementById(cell.getAttribute('aria-describedby')!)!
    expect(description.textContent).toContain('1 − 2·2 = −3')
    const readout = container.querySelector('[data-walkthrough-readout]')!
    fireEvent.focus(cell)
    expect(readout.querySelector('.katex')).not.toBeNull()
    fireEvent.blur(cell)
    expect(readout.querySelector('.katex')).toBeNull()
    fireEvent.mouseEnter(after.querySelectorAll('tr')[2]!)
    // The whole row: one calculation per column.
    expect(readout.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(4)
  })

  it('flags a written entry that disagrees with the operation, with the correct value', () => {
    const { container } = render(<WalkthroughBody text={HW3} />)
    const wrong = container.querySelectorAll('[data-wrong]')
    expect(wrong).toHaveLength(1)
    const description = document.getElementById(wrong[0]!.getAttribute('aria-describedby')!)!
    expect(description.textContent).toContain('−8')
    expect(container.textContent).toContain('the operation gives −8')
  })

  it('boxes a sub-part answer that was never boxed, and only then', () => {
    const { container } = render(
      <WalkthroughBody
        text={`${HW3}\n\n$$x = \\boxed{1}$$`.replace('### (b) 另一问', '### (b) 另一问')}
        conclusion="(a) 相容; (b) 唯一解"
      />,
    )
    expect(container.querySelector('[data-walkthrough-final="a"]')).not.toBeNull()
    // (b) already ends with a box.
    expect(container.querySelector('[data-walkthrough-final="b"]')).toBeNull()
  })

  it('renders an unreadable step as plain text, with no flags', () => {
    const text =
      '作 $R_2 \\to R_2 \\cdot x$：\n\n$$\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}$$\n\n$$\\begin{bmatrix}a&2\\\\3&4\\end{bmatrix}$$'
    const { container } = render(<WalkthroughBody text={text} />)
    expect(container.querySelector('[data-walkthrough-step]')).toBeNull()
    expect(container.querySelector('[data-wrong]')).toBeNull()
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0)
  })
})

// --- 普通 / 详细 in the panel -------------------------------------------------

const hook = vi.hoisted(() => ({
  setLevel: vi.fn(async () => undefined),
  generateVariants: vi.fn(async () => ({ generated: 1, failed: 0 })),
}))

const question = (id: string) => ({ id, number: id.slice(1), prompt: 'Solve it.' })
const readySection = (id: string, extra: Record<string, unknown> = {}) => ({
  id: `q:${id}`,
  kind: 'question',
  title: id,
  conclusion: 'x = 1',
  body: `Standard work for ${id}.`,
  status: 'ready',
  inputHash: 'h',
  generatedAt: 2,
  ...extra,
})

vi.mock('@/features/homework/useWalkthrough', () => ({
  useWalkthrough: () => ({
    state: {
      language: 'en',
      questions: [question('q1'), question('q2')],
      plan: [
        {
          id: 'q:q1',
          kind: 'question',
          question: question('q1'),
          inputHash: 'h',
          needsWork: false,
          outdated: false,
          section: readySection('q1'),
        },
        {
          id: 'q:q2',
          kind: 'question',
          question: question('q2'),
          inputHash: 'h',
          needsWork: false,
          outdated: false,
          section: readySection('q2', {
            level: 'detailed',
            variants: {
              detailed: { body: 'Detailed work for q2.', inputHash: 'h', generatedAt: 3 },
            },
          }),
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
    restorePrevious: vi.fn(),
    setLevel: hook.setLevel,
    generateVariants: hook.generateVariants,
  }),
}))
vi.mock('@/features/homework/useHomeworkService', () => ({ useHomeworkService: () => null }))

const set = {
  id: 's1',
  projectId: 'p1',
  title: 'HW3',
  walkthroughNoticeSeenAt: 1,
} as unknown as HomeworkSet

describe('普通 / 详细 toggle', () => {
  it('shows each section at its level and writes a missing detailed version on demand', async () => {
    const user = userEvent.setup()
    render(<HomeworkWalkthroughPanel set={set} mode="review" />)
    const q1 = document.getElementById('wt-q:q1')!
    const q2 = document.getElementById('wt-q:q2')!
    expect(within(q1).getByText('Standard work for q1.')).toBeInTheDocument()
    expect(within(q2).getByText('Detailed work for q2.')).toBeInTheDocument()
    const group = within(q1).getByRole('group', { name: 'Level of detail' })
    expect(within(group).getByRole('button', { name: 'Standard' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(group).getByRole('button', { name: 'Detailed' }))
    expect(hook.setLevel).toHaveBeenCalledWith(['q:q1'], 'detailed')
    await waitFor(() => expect(hook.generateVariants).toHaveBeenCalledWith(['q:q1']))
  })

  it('全部切到详细版 switches every section and writes only what is missing', async () => {
    hook.setLevel.mockClear()
    hook.generateVariants.mockClear()
    const user = userEvent.setup()
    render(<HomeworkWalkthroughPanel set={set} mode="review" />)
    await user.click(screen.getByRole('button', { name: 'Switch all to detailed' }))
    expect(hook.setLevel).toHaveBeenCalledWith('all', 'detailed')
    await waitFor(() => expect(hook.generateVariants).toHaveBeenCalledWith(undefined))
  })
})
