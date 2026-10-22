import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  cardAutoHeightCap,
  clampCard,
  convertCardPin,
  fitCardHeight,
  useFloatingQA,
  type FloatingPassage,
} from '@/features/homework/floatingQAStore'
import { FloatingQALayer } from '@/widgets/homework/walkthrough/FloatingQALayer'
import { WalkthroughNoteService } from '@/services/walkthroughNoteService'
import { installPointerEvent } from '../helpers/pointerEvent'

const passage: FloatingPassage = {
  projectId: 'p1',
  setId: 's1',
  setTitle: 'HW3',
  sectionId: 'q:q1',
  sectionTitle: 'Question 1',
  quote: 'R2 minus 2 R1',
  anchor: { text: 'R2 minus 2 R1', prefix: '', suffix: '' },
  surrounding: '',
  language: 'en',
}
const turn = { question: 'Why R1?', answer: 'Because row 1 has the pivot.', at: 1 }

function store() {
  return useFloatingQA.getState()
}

/*
 * jsdom has no layout. The card's header is 30px; its content is
 * `contentHeight` tall; the card is as tall as its inline height, or its
 * content (capped by its inline max-height) when it has none.
 */
const HEADER = 30
let contentHeight = 0
const originals = {
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!,
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!,
}

function cardHeight(card: HTMLElement): number {
  const set = parseFloat(card.style.height)
  if (set) return set
  const max = parseFloat(card.style.maxHeight) || Infinity
  return Math.min(HEADER + contentHeight, max)
}

beforeEach(() => {
  useFloatingQA.setState({ windows: [], nextZ: 1, cardPinned: true })
  contentHeight = 0
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-card-content')) return contentHeight
      if (this.hasAttribute('data-qa-card')) return cardHeight(this)
      return 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-card-body'))
        return cardHeight(this.closest<HTMLElement>('[data-qa-card]')!) - HEADER
      return 0
    },
  })
})

afterEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originals.offsetHeight)
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight
  vi.restoreAllMocks()
})

async function shrinkWindow(noteId?: string): Promise<{ id: string; card: HTMLElement }> {
  const user = userEvent.setup()
  const id = store().open({
    passage,
    turns: [turn],
    rect: { x: 100, y: 100, width: 400, height: 400 },
    ...(noteId ? { noteId } : {}),
  })
  render(<FloatingQALayer setId="s1" />)
  await user.click(screen.getByRole('button', { name: 'Shrink to a card' }))
  return { id, card: screen.getByRole('group', { name: /Question card/ }) }
}

describe('card size helpers', () => {
  it('fits the content up to min(60vh, 520px), never below the minimum', () => {
    expect(cardAutoHeightCap(768)).toBe(461)
    expect(cardAutoHeightCap(1_200)).toBe(520)
    expect(fitCardHeight(230, 768)).toBe(230)
    expect(fitCardHeight(2_000, 768)).toBe(461)
    expect(fitCardHeight(40, 768)).toBe(120)
  })

  it('clamps a card with its real size; an oversized hand-set card shrinks to fit', () => {
    const view = { width: 1_024, height: 768 }
    expect(clampCard({ x: 900, y: 700, pinned: true, width: 400, height: 300 }, view)).toEqual({
      x: 1_024 - 400 - 12,
      y: 768 - 300 - 12,
      pinned: true,
      width: 400,
      height: 300,
    })
    expect(
      clampCard({ x: 50, y: 50, pinned: true, width: 2_000, height: 2_000, manual: true }, view),
    ).toEqual({ x: 12, y: 12, pinned: true, width: 1_000, height: 744, manual: true })
  })

  it('keeps the size when pinning or attaching a card', () => {
    const card = { x: 400, y: 200, pinned: true, width: 350, height: 260, manual: true }
    const attached = convertCardPin(card, false, { left: 120, top: -300 })
    expect(attached).toEqual({ ...card, x: 280, y: 500, pinned: false })
    expect(convertCardPin(attached, true, { left: 120, top: -300 })).toEqual(card)
  })
})

describe('a card fits its content', () => {
  it('starts 320px wide and as tall as the question and the whole answer', async () => {
    contentHeight = 200
    const { card } = await shrinkWindow()
    expect(store().windows[0]!.compact).toMatchObject({ width: 320, height: 230 })
    expect(store().windows[0]!.compact!.manual).toBeUndefined()
    expect(card.style.width).toBe('320px')
    expect(card.style.height).toBe('230px')
    expect(within(card).getByText('Why R1?')).toBeInTheDocument()
    expect(within(card).getByText('Because row 1 has the pivot.')).toBeInTheDocument()
    expect(card.querySelector('[data-card-body]')).not.toHaveAttribute('data-overflowing')
  })

  it('stops at the cap and scrolls the rest, with a fade', async () => {
    contentHeight = 900
    const { card } = await shrinkWindow()
    expect(store().windows[0]!.compact!.height).toBe(461)
    const body = card.querySelector<HTMLElement>('[data-card-body]')!
    expect(body).toHaveAttribute('data-overflowing')
    expect(body.className).toContain('overflow-y-auto')
    expect(body.className).toContain('mask-image')
  })

  it('re-fits when a new answer arrives', async () => {
    contentHeight = 100
    const { id } = await shrinkWindow()
    expect(store().windows[0]!.compact!.height).toBe(130)
    contentHeight = 300
    act(() => store().update(id, { turns: [turn, { ...turn, answer: 'A longer answer.' }] }))
    expect(store().windows[0]!.compact!.height).toBe(330)
  })
})

describe('resizing a card', () => {
  let restorePointerEvent: () => void = () => undefined
  beforeEach(() => {
    restorePointerEvent = installPointerEvent()
  })
  afterEach(() => restorePointerEvent())

  function drag(handle: HTMLElement, dx: number, dy: number, pointerType = 'mouse'): void {
    fireEvent.pointerDown(handle, { pointerType, pointerId: 7, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, {
      pointerType,
      pointerId: 7,
      buttons: 1,
      clientX: dx,
      clientY: dy,
    })
    fireEvent.pointerUp(window, { pointerType, pointerId: 7 })
  }

  it('keeps the hand-set size and stops fitting; the next card of the window starts at it', async () => {
    const saveCardSize = vi
      .spyOn(WalkthroughNoteService.prototype, 'saveCardSize')
      .mockResolvedValue(undefined)
    contentHeight = 200
    const { id, card } = await shrinkWindow('n1')
    const grip = card.querySelector<HTMLElement>('[data-card-resize]')!
    expect(grip.className).toContain('touch-none')
    expect(grip.className).toContain('coarse:h-11')
    const capture = vi.fn()
    grip.setPointerCapture = capture
    drag(grip, 60, 40, 'touch')
    expect(capture).toHaveBeenCalledWith(7)
    expect(store().windows[0]!.compact).toMatchObject({ width: 380, height: 270, manual: true })
    expect(store().windows[0]!.cardSize).toEqual({ width: 380, height: 270 })
    expect(saveCardSize).toHaveBeenCalledWith('n1', { width: 380, height: 270 })

    // A new answer no longer changes the size.
    contentHeight = 400
    act(() => store().update(id, { turns: [turn, { ...turn, answer: 'More.' }] }))
    expect(store().windows[0]!.compact).toMatchObject({ width: 380, height: 270 })

    // Below the minimum is not allowed.
    drag(
      screen.getByRole('group', { name: /Question card/ }).querySelector('[data-card-resize]')!,
      -500,
      -500,
    )
    expect(store().windows[0]!.compact).toMatchObject({ width: 240, height: 120 })

    // Expand and shrink again: the hand-set size comes back.
    act(() => store().expand(id))
    expect(store().windows[0]!.compact).toBeUndefined()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Shrink to a card' }))
    expect(store().windows[0]!.compact).toMatchObject({ width: 240, height: 120, manual: true })
  })

  it('a wobble under the drag threshold does not resize', async () => {
    contentHeight = 200
    const { card } = await shrinkWindow()
    drag(card.querySelector<HTMLElement>('[data-card-resize]')!, 3, 3, 'touch')
    expect(store().windows[0]!.compact).toMatchObject({ width: 320, height: 230 })
    expect(store().windows[0]!.compact!.manual).toBeUndefined()
  })
})
