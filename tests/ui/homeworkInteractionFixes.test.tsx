import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { currentSection } from '@/widgets/homework/walkthrough/scrollSpy'
import { WalkthroughSpoilerGate } from '@/widgets/homework/walkthrough/WalkthroughSpoilerGate'
import { practiceSourceFor } from '@/widgets/homework/practice/practiceSource'
import { pausedCardActions } from '@/widgets/homework/pausedCardActions'
import { entryWidthEm, sharedColumnWidths } from '@/widgets/homework/walkthrough/stepLayout'

const r = (n: number, d = 1) => ({ n: BigInt(n), d: BigInt(d) })

describe('walkthrough contents scroll-spy', () => {
  const order = ['overview', 'q1', 'q2', 'summary']

  it('highlights the first section crossing the reading band, in document order', () => {
    expect(currentSection(order, new Set(['q2', 'q1']), 'overview')).toBe('q1')
    expect(currentSection(order, new Set(['summary']), 'q1')).toBe('summary')
  })

  it('keeps the previous section between sections, else starts at the first', () => {
    expect(currentSection(order, new Set(), 'q2')).toBe('q2')
    expect(currentSection(order, new Set(), null)).toBe('overview')
    // A section that no longer exists is not kept.
    expect(currentSection(order, new Set(), 'gone')).toBe('overview')
    expect(currentSection([], new Set(), null)).toBeNull()
  })
})

describe('walkthrough spoiler gate', () => {
  it('offers "practice first" as the primary choice and still opens the walkthrough', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onPractice = vi.fn()
    render(<WalkthroughSpoilerGate onOpen={onOpen} onPractice={onPractice} />)
    await user.click(screen.getByRole('button', { name: /Practice first/ }))
    expect(onPractice).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /open the walkthrough/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows only "open" without a practice view', () => {
    render(<WalkthroughSpoilerGate onOpen={() => undefined} />)
    expect(screen.queryByRole('button', { name: /Practice first/ })).toBeNull()
  })
})

describe('practice-set question source', () => {
  const practice = { kind: 'practice' as const, parentSetId: 'hw1', projectId: 'p1' }
  const parent = { id: 'hw1', title: 'HW3 — Row Reduction' }
  const parentQuestions = [{ id: 'a', number: '1' }, { id: 'b', number: ' 2(b) ' }, { id: 'c' }]

  it('links back to the parent assignment and names the mirrored question', () => {
    expect(
      practiceSourceFor(practice, parent, parentQuestions, {
        practice: {
          origin: 'ai',
          parts: [],
          knowledgePoints: [],
          templates: [],
          sourceQuestionId: 'b',
        },
      } as never),
    ).toEqual({
      parent: { title: parent.title, href: '/projects/p1/homework/hw1?view=walkthrough' },
      questionLabel: '2(b)',
    })
    // Unnumbered original: its position.
    expect(
      practiceSourceFor(practice, parent, parentQuestions, {
        practice: { sourceQuestionId: 'c' },
      } as never)?.questionLabel,
    ).toBe('3')
  })

  it('names only the assignment in short mode, nothing for ordinary assignments', () => {
    expect(practiceSourceFor(practice, parent, parentQuestions, {})).toEqual({
      parent: { title: parent.title, href: '/projects/p1/homework/hw1?view=walkthrough' },
    })
    expect(practiceSourceFor({ ...practice, kind: 'assignment' }, parent, [], {})).toBeNull()
    expect(practiceSourceFor(practice, null, [], {})).toEqual({ parent: null })
  })
})

describe('paused assignment card', () => {
  it('makes 继续 the primary action and 打开讲解 secondary', () => {
    expect(pausedCardActions({ live: false, questionCount: 3 })).toEqual({
      resume: true,
      open: 'secondary',
    })
    expect(pausedCardActions({ live: false, questionCount: 0 })).toEqual({
      resume: true,
      open: null,
    })
    // Running again: nothing to resume, opening is the main action.
    expect(pausedCardActions({ live: true, questionCount: 3 })).toEqual({
      resume: false,
      open: 'primary',
    })
  })
})

describe('step card matrices', () => {
  it('gives the matrices before and after a step the same column widths', () => {
    const before = { rows: [[r(1), r(2), r(10)]], bar: 2 }
    const after = { rows: [[r(0), r(-12), r(1, 2)]], bar: 2 }
    const widths = sharedColumnWidths(before, after)
    expect(widths).toHaveLength(3)
    expect(widths[0]).toBe(entryWidthEm(r(1)))
    // −12 is wider than 2; the fraction ½ is as wide as one digit, less than 10.
    expect(widths[1]).toBeCloseTo(entryWidthEm(r(-12)))
    expect(widths[2]).toBeCloseTo(entryWidthEm(r(10)))
    expect(entryWidthEm(r(-1, 2))).toBeGreaterThan(entryWidthEm(r(1, 2)))
  })
})
