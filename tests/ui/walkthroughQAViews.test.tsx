import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  clampCard,
  convertCardPin,
  MAX_COMPACT_CARDS,
  useFloatingQA,
  windowMode,
  type FloatingPassage,
} from '@/features/homework/floatingQAStore'
import { FloatingQALayer } from '@/widgets/homework/walkthrough/FloatingQALayer'
import { HomeworkWalkthroughPanel } from '@/widgets/homework/walkthrough/HomeworkWalkthroughPanel'
import { hitPassage, pointInPassage } from '@/widgets/homework/walkthrough/passage'
import type { WalkthroughNote } from '@/entities/homework/walkthrough'
import type { HomeworkSet } from '@/entities/homework/types'

const walkthrough = vi.hoisted(() => ({ notes: [] as unknown[] }))

vi.mock('@/features/homework/useWalkthrough', () => ({
  useWalkthrough: () => ({
    state: {
      language: 'en',
      questions: [{ id: 'q1', number: '1', prompt: 'Solve the system.' }],
      plan: [
        {
          id: 'q:q1',
          kind: 'question',
          question: { id: 'q1', number: '1', prompt: 'Solve the system.' },
          inputHash: 'h',
          needsWork: false,
          outdated: false,
          section: {
            id: 'q:q1',
            kind: 'question',
            title: '',
            body: 'First do R2 minus 2 R1, then scale.',
            status: 'ready',
            inputHash: 'h',
            generatedAt: 1,
          },
        },
      ],
    },
    notes: walkthrough.notes,
    progress: undefined,
    loading: false,
    error: null,
    generate: vi.fn(),
  }),
}))
vi.mock('@/features/homework/useHomeworkService', () => ({ useHomeworkService: () => null }))

const passage: FloatingPassage = {
  projectId: 'p1',
  setId: 's1',
  setTitle: 'HW3',
  sectionId: 'q:q1',
  sectionTitle: 'Question 1',
  quote: 'R2 minus 2 R1',
  anchor: { text: 'R2 minus 2 R1', prefix: 'First do ', suffix: ', then scale.' },
  surrounding: '',
  language: 'en',
}
const rect = { x: 500, y: 100, width: 400, height: 400 }
const turn = { question: 'Why R1?', answer: 'Because row 1 has the pivot.', at: 1 }

const set = {
  id: 's1',
  projectId: 'p1',
  title: 'HW3',
  walkthroughNoticeSeenAt: 1,
} as unknown as HomeworkSet

const savedNote: WalkthroughNote = {
  id: 'n1',
  projectId: 'p1',
  setId: 's1',
  sectionId: 'q:q1',
  sectionTitle: 'Question 1',
  quote: 'R2 minus 2 R1',
  anchor: passage.anchor,
  surrounding: '',
  title: 'Row step',
  turns: [{ question: 'What is R2?', answer: 'The second row of the matrix.', at: 1 }],
  createdAt: 1,
  updatedAt: 1,
}

function store() {
  return useFloatingQA.getState()
}

function openWindow(): string {
  return store().open({ passage, turns: [turn], rect })
}

beforeEach(() => {
  useFloatingQA.setState({ windows: [], nextZ: 1, cardPinned: true })
  walkthrough.notes = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint
})

describe('window modes in the store', () => {
  it('moves between full, card and tucked; cards do not count toward three windows', () => {
    const [a, b, c] = [openWindow(), openWindow(), openWindow()]
    store().compact(a, { x: 10, y: 10, pinned: true })
    expect(windowMode(store().windows.find((w) => w.id === a)!)).toBe('compact')
    // A fourth full window fits: the card is not one of the three.
    const d = openWindow()
    expect(store().windows.filter((w) => w.minimized)).toEqual([])

    store().tuck(b)
    expect(windowMode(store().windows.find((w) => w.id === b)!)).toBe('tucked')

    // Raising a card keeps it a card.
    store().raise(a)
    expect(windowMode(store().windows.find((w) => w.id === a)!)).toBe('compact')

    // Expanding the card: three full windows again, the card's in front.
    store().focus(a)
    const modes = () => Object.fromEntries(store().windows.map((w) => [w.id, windowMode(w)]))
    expect(modes()).toEqual({ [a]: 'full', [b]: 'tucked', [c]: 'full', [d]: 'full' })
    const topZ = Math.max(...store().windows.map((w) => w.z))
    expect(store().windows.find((w) => w.id === a)!.z).toBe(topZ)

    // A tucked window comes back as a full window in front; the one at the back is docked.
    store().focus(b)
    expect(modes()).toEqual({ [a]: 'full', [b]: 'full', [c]: 'minimized', [d]: 'full' })
  })

  it(`shows at most ${MAX_COMPACT_CARDS} cards and docks the card at the back`, () => {
    const ids = Array.from({ length: MAX_COMPACT_CARDS + 1 }, () => openWindow())
    for (const id of ids) store().compact(id, { x: 10, y: 10, pinned: true })
    const docked = store().windows.filter((w) => w.minimized)
    expect(docked.map((w) => w.id)).toEqual([ids[0]])
    expect(docked[0]!.compact).toBeUndefined()
    expect(store().windows.filter((w) => windowMode(w) === 'compact')).toHaveLength(
      MAX_COMPACT_CARDS,
    )
  })

  it('remembers whether the last card was pinned', () => {
    const id = openWindow()
    store().compact(id, { x: 10, y: 10, pinned: true })
    store().setCard(id, { x: 10, y: 10, pinned: false })
    expect(store().cardPinned).toBe(false)
  })

  it('converts a card between screen and page coordinates without moving it', () => {
    const layer = { left: 120, top: -300 }
    const pinned = { x: 400, y: 200, pinned: true }
    const attached = convertCardPin(pinned, false, layer)
    expect(attached).toEqual({ x: 280, y: 500, pinned: false })
    expect(convertCardPin(attached, true, layer)).toEqual(pinned)
    expect(convertCardPin(pinned, true, layer)).toBe(pinned)
    // Clamped into its bounds (viewport or card layer).
    expect(clampCard({ x: -50, y: 9_000, pinned: false }, { width: 700, height: 1_000 })).toEqual({
      x: 4,
      y: 1_000 - 140 - 4,
      pinned: false,
    })
  })
})

describe('hit-testing marked passages', () => {
  function setup(): { text: Text; ranges: [string, Range][] } {
    const p = document.createElement('p')
    p.textContent = 'First do R2 minus 2 R1, then scale.'
    document.body.append(p)
    const text = p.firstChild as Text
    const make = (start: number, end: number): Range => {
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, end)
      return range
    }
    return {
      text,
      ranges: [
        ['a', make(9, 22)],
        ['b', make(9, 30)],
      ],
    }
  }

  it('finds the first passage that holds the caret, else none', () => {
    const { text, ranges } = setup()
    const point = { x: 5, y: 5 }
    expect(hitPassage(ranges, { node: text, offset: 12 }, point)).toBe('a')
    expect(hitPassage(ranges, { node: text, offset: 25 }, point)).toBe('b')
    expect(hitPassage(ranges, { node: text, offset: 2 }, point)).toBeNull()
    expect(hitPassage(ranges, null, point)).toBeNull()
  })

  it('ignores a caret snapped to text beside the pointer', () => {
    const { text, ranges } = setup()
    const range = ranges[0]![1]
    const box = { left: 0, right: 100, top: 0, bottom: 20 } as DOMRect
    range.getClientRects = () => [box] as unknown as DOMRectList
    expect(pointInPassage(range, { node: text, offset: 12 }, { x: 50, y: 10 })).toBe(true)
    expect(pointInPassage(range, { node: text, offset: 12 }, { x: 50, y: 80 })).toBe(false)
  })
})

describe('cards that follow the page', () => {
  function layerElement(): HTMLDivElement {
    const layer = document.createElement('div')
    document.body.append(layer)
    Object.defineProperty(layer, 'clientWidth', { value: 680 })
    Object.defineProperty(layer, 'clientHeight', { value: 3_000 })
    layer.getBoundingClientRect = () =>
      ({ left: 100, top: -400, width: 680, height: 3_000 }) as DOMRect
    return layer
  }

  it('renders an attached card inside the card layer, in its coordinates', () => {
    const layer = layerElement()
    const id = openWindow()
    store().compact(id, { x: 30, y: 900, pinned: false })
    render(<FloatingQALayer setId="s1" cardLayer={layer} />)
    const card = screen.getByRole('group', { name: /Question card/ })
    expect(card.parentElement).toBe(layer)
    expect(card.className).toContain('absolute')
    expect(card.style.left).toBe('30px')
    expect(card.style.top).toBe('900px')
    expect(within(card).getByText('Because row 1 has the pivot.')).toBeInTheDocument()
  })

  it('pins and unpins without the card moving on screen', async () => {
    const user = userEvent.setup()
    const layer = layerElement()
    const id = openWindow()
    store().compact(id, { x: 200, y: 150, pinned: true })
    render(<FloatingQALayer setId="s1" cardLayer={layer} />)
    const toggle = screen.getByRole('button', { name: 'Pin to the screen' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await user.click(toggle)
    expect(store().windows[0]!.compact).toEqual({ x: 100, y: 550, pinned: false })
    expect(screen.getByRole('group', { name: /Question card/ }).parentElement).toBe(layer)
    const again = screen.getByRole('button', { name: 'Pin to the screen' })
    expect(again).toHaveAttribute('aria-pressed', 'false')
    expect(document.activeElement).toBe(again)
    await user.click(again)
    expect(store().windows[0]!.compact).toEqual({ x: 200, y: 150, pinned: true })
  })
})

describe('compact cards and passages tucked into the text', () => {
  function renderPanel(): HTMLElement {
    render(<HomeworkWalkthroughPanel set={set} mode="review" />)
    return document.querySelector<HTMLElement>('[data-selection-context="walkthrough"]')!
  }

  /** Put the caret inside "R2 minus 2 R1" and move the pointer over it. */
  function hoverPassage(article: HTMLElement): void {
    const text = within(article).getByText(/First do R2/).firstChild as Text
    ;(
      document as { caretPositionFromPoint?: (x: number, y: number) => unknown }
    ).caretPositionFromPoint = () => ({ offsetNode: text, offset: 12 })
    fireEvent.pointerMove(article, { clientX: 40, clientY: 40 })
  }

  it('shrinks a window to a card showing the latest answer and expands it again', async () => {
    const user = userEvent.setup()
    renderPanel()
    act(() => void openWindow())
    await user.click(screen.getByRole('button', { name: 'Shrink to a card' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const card = screen.getByRole('group', { name: /Question card/ })
    expect(within(card).getByText('Because row 1 has the pivot.')).toBeInTheDocument()
    expect(document.activeElement).toBe(card)
    await user.click(within(card).getByRole('button', { name: 'Expand' }))
    expect(screen.getByRole('dialog', { name: /R2 minus 2 R1/ })).toBeInTheDocument()
    expect(store().windows[0]!.rect).toMatchObject({ width: 400, height: 400 })
  })

  it('tucks a window into the text; the chip opens it again from the keyboard', async () => {
    const user = userEvent.setup()
    renderPanel()
    act(() => void openWindow())
    await user.click(screen.getByRole('button', { name: 'Tuck into the text' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const chip = document.querySelector<HTMLElement>('[data-tucked-chip]')!
    expect(document.activeElement).toBe(chip)
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: /R2 minus 2 R1/ })).toBeInTheDocument()
    expect(document.querySelector('[data-tucked-chip]')).toBeNull()
  })

  it('shows the latest answer when hovering a tucked passage; Escape closes it', async () => {
    const article = renderPanel()
    act(() => {
      const id = openWindow()
      store().tuck(id)
    })
    hoverPassage(article)
    const card = await screen.findByRole('dialog', { name: /R2 minus 2 R1/ })
    expect(card).toHaveAttribute('data-passage-hover-card')
    expect(within(card).getByText('Because row 1 has the pivot.')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens the full window from the hover card', async () => {
    const user = userEvent.setup()
    const article = renderPanel()
    act(() => {
      store().tuck(openWindow())
    })
    hoverPassage(article)
    const card = await screen.findByRole('dialog', { name: /R2 minus 2 R1/ })
    await user.click(within(card).getByRole('button', { name: 'Open window' }))
    expect(windowMode(store().windows[0]!)).toBe('full')
    expect(document.querySelector('[data-passage-hover-card]')).toBeNull()
  })

  it('shows a saved note on hover too', async () => {
    walkthrough.notes = [savedNote]
    const article = renderPanel()
    hoverPassage(article)
    const card = await screen.findByRole('dialog', { name: 'Row step' })
    expect(within(card).getByText('The second row of the matrix.')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Review cards' })).toBeInTheDocument()
  })
})
