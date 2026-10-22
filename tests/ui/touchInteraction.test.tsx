import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WalkthroughBody } from '@/widgets/homework/walkthrough/WalkthroughBody'
import { TooltipProvider, TooltipWrapper } from '@/shared/ui/Tooltip'
import {
  SelectionTranslator,
  SELECTION_SETTLE_TOUCH_MS,
} from '@/widgets/translation/SelectionTranslator'
import { OrderingInput } from '@/widgets/quiz/OrderingInput'
import { buildAIServices } from '@/services/aiServices'
import { LONG_PRESS_MS } from '@/shared/lib/pointerGesture'
import { TOUCH_POPUP_GAP } from '@/shared/lib/popupPosition'
import type { Question } from '@/entities/question/types'
import { installPointerEvent } from '../helpers/pointerEvent'

vi.mock('@/services/aiServices', () => ({ buildAIServices: vi.fn() }))
vi.mock('@/features/project/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'p1', name: 'Sets' }),
}))

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

let restorePointerEvent: () => void = () => undefined
beforeEach(() => {
  restorePointerEvent = installPointerEvent()
})
afterEach(() => {
  restorePointerEvent()
  vi.restoreAllMocks()
})

// --- Step cards: tap shows a changed entry's arithmetic --------------------

const STEP = [
  '$$\\left[\\begin{array}{cc|c} 1 & 2 & 3 \\\\ 2 & 1 & 4 \\end{array}\\right]$$',
  '',
  '作 $R_2 \\to R_2 - 2R_1$：',
  '',
  '$$\\left[\\begin{array}{cc|c} 1 & 2 & 3 \\\\ 0 & -3 & -2 \\end{array}\\right]$$',
].join('\n')

describe('step card arithmetic by tap (2h3)', () => {
  function setup() {
    const { container } = render(
      <>
        <WalkthroughBody text={STEP} />
        <p data-testid="outside">elsewhere</p>
      </>,
    )
    const after = container.querySelectorAll('[data-walkthrough-step="1"] table')[1]!
    const cell = after.querySelectorAll('tr')[1]!.querySelectorAll('td')[1]!
    const readout = container.querySelector('[data-walkthrough-readout]')!
    return { after, cell, readout }
  }

  function tap(element: Element, pointerType: 'touch' | 'pen'): void {
    fireEvent.pointerDown(element, { pointerType })
    // The browser's emulated mouse events after a tap must not change anything.
    fireEvent.mouseEnter(element)
    fireEvent.pointerUp(element, { pointerType })
    fireEvent.click(element)
  }

  it('a tap toggles the readout; a tap outside the card hides it', () => {
    const { cell, readout } = setup()
    expect(readout.querySelector('.katex')).toBeNull()
    tap(cell, 'touch')
    expect(readout.querySelector('.katex')).not.toBeNull()
    // Emulated mouseleave / blur after the tap keep it.
    fireEvent.mouseLeave(cell.parentElement!)
    fireEvent.blur(cell)
    expect(readout.querySelector('.katex')).not.toBeNull()
    tap(cell, 'pen')
    expect(readout.querySelector('.katex')).toBeNull()
    tap(cell, 'pen')
    expect(readout.querySelector('.katex')).not.toBeNull()
    fireEvent.pointerDown(screen.getByTestId('outside'), { pointerType: 'touch' })
    expect(readout.querySelector('.katex')).toBeNull()
  })

  it('a mouse still shows it on hover only (a click does not pin it)', () => {
    const { after, cell, readout } = setup()
    fireEvent.mouseEnter(after.querySelectorAll('tr')[1]!)
    expect(readout.querySelector('.katex')).not.toBeNull()
    fireEvent.mouseLeave(after.querySelectorAll('tr')[1]!)
    expect(readout.querySelector('.katex')).toBeNull()
    fireEvent.pointerDown(cell, { pointerType: 'mouse' })
    fireEvent.click(cell)
    expect(readout.querySelector('.katex')).toBeNull()
  })
})

// --- Tooltips on icon buttons: long-press --------------------------------

describe('tooltip long-press (2h3)', () => {
  function renderButton(onClick = vi.fn()) {
    render(
      <TooltipProvider>
        <TooltipWrapper content="Tuck into the text">
          <button type="button" aria-label="Tuck" onClick={onClick}>
            T
          </button>
        </TooltipWrapper>
        <p data-testid="outside">elsewhere</p>
      </TooltipProvider>,
    )
    return { button: screen.getByRole('button', { name: 'Tuck' }), onClick }
  }

  it('a held finger shows the tooltip without pressing the button', async () => {
    const { button, onClick } = renderButton()
    fireEvent.pointerDown(button, { pointerType: 'touch', clientX: 5, clientY: 5 })
    await wait(LONG_PRESS_MS + 50)
    expect(screen.getAllByText('Tuck into the text').length).toBeGreaterThan(0)
    fireEvent.pointerUp(button, { pointerType: 'touch' })
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    // The next tap anywhere hides it.
    await wait(30)
    fireEvent.pointerDown(screen.getByTestId('outside'), { pointerType: 'touch' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('a short tap is a normal press; a press that scrolls away is no long-press', async () => {
    const { button, onClick } = renderButton()
    fireEvent.pointerDown(button, { pointerType: 'touch', clientX: 5, clientY: 5 })
    fireEvent.pointerUp(button, { pointerType: 'touch' })
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(button, { pointerType: 'touch', clientX: 5, clientY: 5 })
    fireEvent.pointerMove(button, { pointerType: 'touch', clientX: 5, clientY: 40 })
    await wait(LONG_PRESS_MS + 50)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('a mouse press never triggers it (hover keeps working as before)', async () => {
    const { button } = renderButton()
    fireEvent.pointerDown(button, { pointerType: 'mouse', clientX: 5, clientY: 5 })
    await wait(LONG_PRESS_MS + 50)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

// --- Selection popup after a touch selection ------------------------------

describe('selection popup with finger / pen (2h3)', () => {
  beforeEach(() => {
    vi.mocked(buildAIServices).mockResolvedValue(null as never)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    window.history.pushState({}, '', '/projects/p1/tutor/t1')
  })

  function renderToolbar(): HTMLElement {
    render(
      <>
        <article>
          <h1>Sets</h1>
          <p data-testid="passage">If an object x belongs to a set A, we write x ∈ A.</p>
        </article>
        <SelectionTranslator />
      </>,
    )
    return screen.getByTestId('passage')
  }

  function select(element: Element): void {
    const range = document.createRange()
    range.selectNodeContents(element)
    range.getBoundingClientRect = () =>
      ({ left: 400, top: 300, width: 100, height: 20, right: 500, bottom: 320 }) as DOMRect
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => element.textContent ?? '',
      getRangeAt: () => range,
      removeAllRanges: () => undefined,
      addRange: () => undefined,
    } as unknown as Selection)
    document.dispatchEvent(new Event('selectionchange'))
  }

  function popupTop(): number {
    const element = document.querySelector<HTMLElement>('div.fixed')!
    const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(element.style.transform)
    return Number(match![2])
  }

  it('waits while the finger is still selecting, then shows below the selection', async () => {
    const passage = renderToolbar()
    fireEvent.pointerDown(passage, { pointerType: 'touch' })
    select(passage)
    await wait(SELECTION_SETTLE_TOUCH_MS + 50)
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull()
    fireEvent.pointerUp(passage, { pointerType: 'touch' })
    expect(await screen.findByRole('button', { name: 'Explain' })).toBeInTheDocument()
    // Below the selection, clear of the iPadOS menu above and its handle.
    expect(popupTop()).toBe(300 + 20 + TOUCH_POPUP_GAP)
  })

  it('a long-press that ends without pointerup still shows it (touchend)', async () => {
    const passage = renderToolbar()
    fireEvent.pointerDown(passage, { pointerType: 'pen' })
    select(passage)
    fireEvent.touchEnd(passage)
    expect(await screen.findByRole('button', { name: 'Explain' })).toBeInTheDocument()
  })

  it('a handle drag (selectionchange only) shows it once the selection settles', async () => {
    const passage = renderToolbar()
    fireEvent.pointerDown(passage, { pointerType: 'touch' })
    fireEvent.pointerUp(passage, { pointerType: 'touch' })
    select(passage)
    await wait(150)
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull()
    await wait(SELECTION_SETTLE_TOUCH_MS)
    expect(screen.getByRole('button', { name: 'Explain' })).toBeInTheDocument()
  })

  it('a mouse selection keeps the desktop placement above the text', async () => {
    const passage = renderToolbar()
    fireEvent.pointerDown(passage, { pointerType: 'mouse' })
    select(passage)
    fireEvent.pointerUp(passage, { pointerType: 'mouse' })
    await screen.findByRole('button', { name: 'Explain' })
    expect(popupTop()).toBeLessThan(300)
  })
})

// --- Ordering question: drag by the grip with finger / pen ----------------

describe('ordering items by finger / pen (2h3)', () => {
  const question = {
    id: 'q-order',
    type: 'ordering',
    orderItems: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A\nB\nC\nD',
  } as unknown as Question

  function setup() {
    const onChange = vi.fn()
    render(<OrderingInput question={question} value={'B\nA\nD\nC'} onChange={onChange} />)
    const items = Array.from(document.querySelectorAll('ol > li'))
    items.forEach((item, index) => {
      item.getBoundingClientRect = () =>
        ({ top: index * 40, height: 40, bottom: index * 40 + 40, left: 0, width: 300 }) as DOMRect
    })
    const handles = Array.from(document.querySelectorAll<HTMLElement>('[data-drag-handle]'))
    return { onChange, items, handles }
  }

  it('only the grip opts out of page scrolling', () => {
    const { items, handles } = setup()
    expect(handles[0]!.className).toContain('touch-none')
    expect(items[0]!.className).not.toContain('touch-none')
  })

  it('drags an item down past two others, with pointer capture', () => {
    const { onChange, handles } = setup()
    const capture = vi.fn()
    handles[0]!.setPointerCapture = capture
    fireEvent.pointerDown(handles[0]!, {
      pointerType: 'touch',
      pointerId: 9,
      clientX: 10,
      clientY: 20,
    })
    expect(capture).toHaveBeenCalledWith(9)
    fireEvent.pointerMove(window, { pointerType: 'touch', pointerId: 9, clientX: 10, clientY: 110 })
    expect(document.querySelector('[data-drop-target]')).not.toBeNull()
    fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 9 })
    expect(onChange).toHaveBeenCalledWith('A\nD\nB\nC')
  })

  it('a small wobble is not a drag, and a mouse uses native drag and drop', () => {
    const { onChange, handles } = setup()
    fireEvent.pointerDown(handles[1]!, {
      pointerType: 'pen',
      pointerId: 2,
      clientX: 10,
      clientY: 60,
    })
    fireEvent.pointerMove(window, { pointerType: 'pen', pointerId: 2, clientX: 12, clientY: 63 })
    fireEvent.pointerUp(window, { pointerType: 'pen', pointerId: 2 })
    const capture = vi.fn()
    handles[0]!.setPointerCapture = capture
    fireEvent.pointerDown(handles[0]!, {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 10,
      clientY: 20,
    })
    fireEvent.pointerMove(window, { pointerType: 'mouse', pointerId: 1, clientX: 10, clientY: 150 })
    fireEvent.pointerUp(window, { pointerType: 'mouse', pointerId: 1 })
    expect(capture).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })
})
