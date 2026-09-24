import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectionTranslator } from '@/widgets/translation/SelectionTranslator'
import { buildAIServices } from '@/services/aiServices'

vi.mock('@/services/aiServices', () => ({ buildAIServices: vi.fn() }))
vi.mock('@/features/project/useCurrentProject', () => ({
  useCurrentProject: () => ({ id: 'p1', name: 'Sets' }),
}))

/** A controllable ResizeObserver so a content change can be simulated. */
class ControlledResizeObserver {
  static instances: ControlledResizeObserver[] = []
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ControlledResizeObserver.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  emit(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function installResizeObserver(): void {
  ControlledResizeObserver.instances = []
  globalThis.ResizeObserver = ControlledResizeObserver as unknown as typeof ResizeObserver
}

beforeEach(() => {
  vi.mocked(buildAIServices).mockReset()
  vi.mocked(buildAIServices).mockResolvedValue({
    translation: {
      translate: vi.fn().mockResolvedValue({ translation: '译文', contextNote: '', alternatives: [] }),
    },
    contextualTutor: { ask: vi.fn().mockResolvedValue({ answer: 'ok' }) },
  } as never)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  window.history.pushState({}, '', '/projects/p1/tutor/t1')
})

afterEach(() => {
  vi.restoreAllMocks()
})

function selectNode(element: Element, rect: Partial<DOMRect>): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect
  const spy = vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    toString: () => element.textContent ?? '',
    getRangeAt: () => range,
    removeAllRanges: () => undefined,
    addRange: () => undefined,
  } as unknown as Selection)

  document.dispatchEvent(new Event('selectionchange'))

  spy.mockReturnValue({
    isCollapsed: true,
    rangeCount: 0,
    toString: () => '',
    getRangeAt: () => range,
    removeAllRanges: () => undefined,
    addRange: () => undefined,
  } as unknown as Selection)
}

function renderToolbar(): void {
  render(
    <>
      <article>
        <h1>Sets</h1>
        <p data-testid="passage">If an object x belongs to a set A, we write x ∈ A.</p>
      </article>
      <SelectionTranslator />
    </>,
  )
}

function popup(): HTMLElement {
  const element = document.querySelector('div.fixed')
  if (!element) throw new Error('popup not rendered')
  return element as HTMLElement
}

describe('SelectionTranslator — popup positioning', () => {
  it('flips below a selection near the top of the viewport', async () => {
    renderToolbar()
    selectNode(screen.getByTestId('passage'), { top: 5, left: 480, width: 40, height: 10 })
    await screen.findByRole('button', { name: 'Translate' })
    // 5 + 10 + gap(8) = 23, i.e. below the selection rather than clipped above.
    expect(popup().style.top).toBe('23px')
  })

  it('shows above a selection near the bottom of the viewport', async () => {
    renderToolbar()
    selectNode(screen.getByTestId('passage'), { top: 760, left: 480, width: 40, height: 20 })
    await screen.findByRole('button', { name: 'Translate' })
    expect(Number.parseInt(popup().style.top, 10)).toBeLessThan(760)
  })

  it('clamps a left-edge selection inside the viewport', async () => {
    renderToolbar()
    selectNode(screen.getByTestId('passage'), { top: 400, left: 0, width: 10, height: 20 })
    await screen.findByRole('button', { name: 'Translate' })
    expect(popup().style.left).toBe('8px')
  })

  it('repositions when the content grows after Translate', async () => {
    installResizeObserver()
    const user = userEvent.setup()
    renderToolbar()
    selectNode(screen.getByTestId('passage'), { top: 300, left: 400, width: 40, height: 20 })
    await user.click(await screen.findByRole('button', { name: 'Translate' }))
    await screen.findByText('译文')

    // The popup is now much taller than the room above the selection.
    const element = popup()
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 400 })
    act(() => ControlledResizeObserver.instances[0]!.emit())

    // spaceBelow = (800 - 8) - (300 + 20 + 8) = 464, so a 400px popup fits below.
    expect(element.style.top).toBe('328px')
  })

  it('repositions on window resize and clamps its height', async () => {
    installResizeObserver()
    renderToolbar()
    selectNode(screen.getByTestId('passage'), { top: 300, left: 400, width: 40, height: 20 })
    await screen.findByRole('button', { name: 'Translate' })

    const element = popup()
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 400 })
    act(() => ControlledResizeObserver.instances[0]!.emit())
    expect(element.style.top).toBe('328px')

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(element.style.top).not.toBe('328px')
    // spaceAbove = 300 - gap(8) - margin(8) = 284.
    expect(element.style.maxHeight).toBe('284px')
    expect(element.style.overflowY).toBe('auto')
  })

  it('removes its viewport listeners on unmount', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(
      <>
        <article>
          <h1>Sets</h1>
          <p data-testid="passage">If an object x belongs to a set A, we write x ∈ A.</p>
        </article>
        <SelectionTranslator />
      </>,
    )
    selectNode(screen.getByTestId('passage'), { top: 300, left: 400, width: 40, height: 20 })
    await screen.findByRole('button', { name: 'Translate' })
    expect(addSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true)

    unmount()
    expect(removeSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true)
  })

  it('keeps a long translation inside a scrollable popup', async () => {
    installResizeObserver()
    const user = userEvent.setup()
    renderToolbar()
    selectNode(screen.getByTestId('passage'), { top: 300, left: 400, width: 40, height: 20 })
    await user.click(await screen.findByRole('button', { name: 'Translate' }))
    await screen.findByText('译文')

    const element = popup()
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 2000 })
    act(() => ControlledResizeObserver.instances[0]!.emit())
    expect(element.style.maxHeight).toBeTruthy()
    expect(element.style.overflowY).toBe('auto')
  })
})
