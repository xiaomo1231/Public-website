import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  KEYBOARD_INSET_EVENT,
  keyboardLift,
  publishStickyFooter,
  readStickyFooter,
  revealAboveKeyboard,
} from '@/shared/lib/keyboardInset'
import { answerFieldAttrs, FRACTION_PATTERN, isAppleTouch } from '@/shared/lib/answerFieldAttrs'
import { useFloatingQA, type FloatingPassage } from '@/features/homework/floatingQAStore'
import { FloatingQALayer } from '@/widgets/homework/walkthrough/FloatingQALayer'
import { WalkthroughBody } from '@/widgets/homework/walkthrough/WalkthroughBody'
import { FillBlankInput } from '@/widgets/quiz/ExamFormatInputs'
import { OrderingInput } from '@/widgets/quiz/OrderingInput'
import { MatrixInputGrid } from '@/widgets/homework/guided/MatrixParts'
import { SaveBar } from '@/widgets/settings/SaveBar'
import type { Question } from '@/entities/question/types'
import { installPointerEvent } from '../helpers/pointerEvent'

const root = document.documentElement
const source = (file: string): string =>
  readFileSync(path.resolve(__dirname, '../../src', file), 'utf8')

let restorePointerEvent: () => void = () => undefined
beforeEach(() => {
  restorePointerEvent = installPointerEvent()
  useFloatingQA.setState({ windows: [], nextZ: 1, cardPinned: true })
})
afterEach(() => {
  restorePointerEvent()
  root.style.removeProperty('--keyboard-inset')
  root.style.removeProperty('--sticky-footer')
  vi.restoreAllMocks()
})

describe('T01 settings save bar above the keyboard', () => {
  it('a revealed field clears the sticky footer as well as the keyboard', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.getBoundingClientRect = () => ({ top: 640, bottom: 684 }) as DOMRect
    // innerHeight 768: without a footer the field already fits.
    revealAboveKeyboard(field)
    expect(scrollBy).not.toHaveBeenCalled()
    root.style.setProperty('--sticky-footer', '80px')
    revealAboveKeyboard(field)
    // Bottom must sit 24px above the bar: 684 - (768 - 80 - 24) = 20.
    expect(scrollBy).toHaveBeenCalledWith({ top: 20 })
    field.remove()
  })

  it('a field inside the footer itself is not pushed above it', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    root.style.setProperty('--sticky-footer', '80px')
    const bar = document.createElement('div')
    bar.setAttribute('data-sticky-footer', '')
    const field = document.createElement('input')
    bar.appendChild(field)
    document.body.appendChild(bar)
    field.getBoundingClientRect = () => ({ top: 700, bottom: 730 }) as DOMRect
    revealAboveKeyboard(field)
    expect(scrollBy).not.toHaveBeenCalled()
    bar.remove()
  })

  it('the save bar publishes its height while shown, 0 once gone', () => {
    const element = document.createElement('div')
    element.getBoundingClientRect = () => ({ height: 61.4 }) as DOMRect
    const stop = publishStickyFooter(element)
    expect(readStickyFooter()).toBe(61)
    stop()
    expect(readStickyFooter()).toBe(0)

    const { rerender } = render(
      <SaveBar visible saving={false} onSave={() => undefined} onDiscard={() => undefined} />,
    )
    expect(root.style.getPropertyValue('--sticky-footer')).toBe('0px')
    expect(document.querySelector('[data-sticky-footer]')).not.toBeNull()
    rerender(
      <SaveBar
        visible={false}
        saving={false}
        onSave={() => undefined}
        onDiscard={() => undefined}
      />,
    )
    expect(root.style.getPropertyValue('--sticky-footer')).toBe('')
  })

  it('focused fields keep a scroll margin above keyboard and footer', () => {
    const css = source('shared/styles/globals.css')
    expect(css).toContain('--sticky-footer: 0px')
    expect(css).toContain('calc(var(--keyboard-inset) + var(--sticky-footer) + 24px)')
    // The unused opt-out is gone.
    expect(css).not.toContain('data-touch-compact')
  })
})

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

describe('T02 floating window above the keyboard', () => {
  it('lifts only as far as needed', () => {
    expect(keyboardLift({ y: 100, height: 400 }, 0, 768)).toBe(0)
    // Bottom 500, keyboard top 468, 12px gap → up 44.
    expect(keyboardLift({ y: 100, height: 400 }, 300, 768)).toBe(-44)
    expect(keyboardLift({ y: 20, height: 200 }, 300, 768)).toBe(0)
  })

  it('moves while focus is inside and the keyboard is up; the stored rect stays', async () => {
    const id = useFloatingQA.getState().open({
      passage,
      turns: [turn],
      rect: { x: 500, y: 100, width: 400, height: 400 },
    })
    render(
      <>
        <FloatingQALayer setId="s1" />
        <button type="button">outside</button>
      </>,
    )
    const dialog = screen.getByRole('dialog')
    const box = screen.getByRole('textbox')
    expect(box).toHaveAttribute('enterkeyhint', 'send')
    expect(dialog.style.top).toBe('100px')
    act(() => {
      root.style.setProperty('--keyboard-inset', '300px')
      window.dispatchEvent(new Event(KEYBOARD_INSET_EVENT))
    })
    // No focus inside yet: it stays put.
    expect(dialog.style.top).toBe('100px')
    act(() => box.focus())
    expect(dialog.style.top).toBe('56px')
    expect(useFloatingQA.getState().windows.find((w) => w.id === id)!.rect.y).toBe(100)
    // Focus leaves: back where it was.
    act(() => screen.getByRole('button', { name: 'outside' }).focus())
    expect(dialog.style.top).toBe('100px')
    // Keyboard closes while typing: back too.
    act(() => box.focus())
    expect(dialog.style.top).toBe('56px')
    act(() => {
      root.style.setProperty('--keyboard-inset', '0px')
      window.dispatchEvent(new Event(KEYBOARD_INSET_EVENT))
    })
    expect(dialog.style.top).toBe('100px')
    await Promise.resolve()
  })

  it('the resize corner is 44px on touch (T08)', () => {
    useFloatingQA
      .getState()
      .open({ passage, turns: [turn], rect: { x: 100, y: 100, width: 400, height: 400 } })
    render(<FloatingQALayer setId="s1" />)
    const grip = document.querySelector('[data-resize-handle]')!
    expect(grip.className).toContain('coarse:h-11')
    expect(grip.className).toContain('coarse:w-11')
  })
})

describe('T09 expanding a card keeps the window on screen', () => {
  it('clamps the rect on expand and when a docked window comes back', () => {
    const store = useFloatingQA.getState()
    const id = store.open({
      passage,
      turns: [turn],
      rect: { x: 100, y: 100, width: 400, height: 400 },
    })
    store.compact(id, { x: 200, y: 600, pinned: true })
    // A rect 4px past the bottom of the 768px viewport.
    useFloatingQA.getState().expand(id, { x: 200, y: 372, width: 400, height: 400 })
    const rect = useFloatingQA.getState().windows[0]!.rect
    expect(rect.y + rect.height).toBeLessThanOrEqual(window.innerHeight - 12)
    // A stale rect restored from the dock is clamped too.
    useFloatingQA.setState({
      windows: [
        {
          ...useFloatingQA.getState().windows[0]!,
          minimized: true,
          rect: { x: 900, y: 500, width: 400, height: 400 },
        },
      ],
    })
    useFloatingQA.getState().setMinimized(id, false)
    const back = useFloatingQA.getState().windows[0]!.rect
    expect(back.x + back.width).toBeLessThanOrEqual(window.innerWidth - 12)
    expect(back.y + back.height).toBeLessThanOrEqual(window.innerHeight - 12)
  })
})

describe('T06 fill-blank Enter', () => {
  it('moves to the next blank, and submits from the last', async () => {
    const onSubmit = vi.fn()
    const question = { id: 'q', type: 'fill_blank', blanks: [['a'], ['b'], ['c']] } as Question
    render(
      <FillBlankInput
        question={question}
        value=""
        onChange={() => undefined}
        onSubmit={onSubmit}
      />,
    )
    const [first, second, third] = screen.getAllByRole('textbox')
    first!.focus()
    await userEvent.keyboard('{Enter}')
    expect(second).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(third).toHaveFocus()
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(first).toHaveAttribute('enterkeyhint', 'next')
    expect(third).toHaveAttribute('enterkeyhint', 'go')
  })
})

describe('T11 matrix cell keyboards per platform', () => {
  it('numeric keypad only on iPadOS; elsewhere the full keyboard with a pattern', () => {
    const iPad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 5 }
    const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 0 }
    const android = { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710)', maxTouchPoints: 10 }
    expect(isAppleTouch(iPad)).toBe(true)
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' })).toBe(true)
    expect(isAppleTouch(mac)).toBe(false)
    expect(isAppleTouch(android)).toBe(false)
    expect(answerFieldAttrs('fraction', iPad)).toMatchObject({ inputMode: 'numeric' })
    expect(answerFieldAttrs('fraction', iPad).pattern).toBeUndefined()
    expect(answerFieldAttrs('fraction', android)).toMatchObject({
      inputMode: 'text',
      pattern: FRACTION_PATTERN,
    })
    const pattern = new RegExp(`^(?:${FRACTION_PATTERN})$`, 'v')
    expect(pattern.test('-3/2')).toBe(true)
    expect(pattern.test('−1.5')).toBe(true)
    expect(pattern.test('x')).toBe(false)
  })

  it('Enter goes to the next blank cell ("next"); checks when none is left or from the last ("go")', async () => {
    const onSubmit = vi.fn()
    render(
      <MatrixInputGrid
        values={[
          ['', ''],
          ['', ''],
        ]}
        onChange={() => undefined}
        onSubmit={onSubmit}
        label="Result"
      />,
    )
    const cells = screen.getAllByRole('textbox')
    cells[1]!.focus()
    await userEvent.keyboard('{Enter}')
    expect(cells[2]).toHaveFocus()
    expect(onSubmit).not.toHaveBeenCalled()
    cells[3]!.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Enter checks from any cell once every cell is filled', async () => {
    const onSubmit = vi.fn()
    render(
      <MatrixInputGrid
        values={[
          ['1', '2'],
          ['3', '4'],
        ]}
        onChange={() => undefined}
        onSubmit={onSubmit}
        label="Result"
      />,
    )
    screen.getAllByRole('textbox')[0]!.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

const STEP = [
  '$$\\left[\\begin{array}{cc|c} 1 & 2 & 3 \\\\ 2 & 1 & 4 \\end{array}\\right]$$',
  '',
  '作 $R_2 \\to R_2 - 2R_1$：',
  '',
  '$$\\left[\\begin{array}{cc|c} 1 & 2 & 3 \\\\ 0 & -3 & -2 \\end{array}\\right]$$',
].join('\n')

describe('T15 / T05 step cards', () => {
  function setup() {
    const { container } = render(<WalkthroughBody text={STEP} />)
    const tables = container.querySelectorAll('[data-walkthrough-step="1"] table')
    const after = tables[1]!
    const row = after.querySelectorAll('tr')[1]!
    const cell = row.querySelectorAll('td')[1]!
    const readout = container.querySelector('[data-walkthrough-readout]')!
    return { tables, row, cell, readout }
  }
  function tap(element: Element): void {
    fireEvent.pointerDown(element, { pointerType: 'touch' })
    fireEvent.pointerUp(element, { pointerType: 'touch' })
    fireEvent.click(element)
  }

  it('a real mouse move ends tap mode, so hover works again at once', () => {
    const { row, cell, readout } = setup()
    tap(cell)
    fireEvent.mouseLeave(row)
    expect(readout.querySelector('.katex')).not.toBeNull()
    // A touch move does not end it.
    fireEvent.pointerMove(document, { pointerType: 'touch' })
    fireEvent.mouseLeave(row)
    expect(readout.querySelector('.katex')).not.toBeNull()
    fireEvent.pointerMove(document, { pointerType: 'mouse' })
    fireEvent.mouseLeave(row)
    expect(readout.querySelector('.katex')).toBeNull()
    fireEvent.mouseEnter(row)
    expect(readout.querySelector('.katex')).not.toBeNull()
  })

  it('a key press ends tap mode, so keyboard focus drives the readout', () => {
    const { cell, readout } = setup()
    tap(cell)
    fireEvent.blur(cell)
    expect(readout.querySelector('.katex')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.blur(cell)
    expect(readout.querySelector('.katex')).toBeNull()
    fireEvent.focus(cell)
    expect(readout.querySelector('.katex')).not.toBeNull()
  })

  it('every entry of both matrices is 44px on touch (columns stay aligned)', () => {
    const { tables } = setup()
    for (const table of Array.from(tables)) {
      for (const td of Array.from(table.querySelectorAll('td'))) {
        expect(td.className).toContain('coarse:h-11')
        expect(td.className).toContain('coarse:w-11')
      }
    }
  })
})

describe('T10 / T04 ordering drag', () => {
  const question = {
    id: 'q-order',
    type: 'ordering',
    orderItems: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A\nB\nC\nD',
  } as unknown as Question

  it('the lifted row stays opaque; the rows it passes shift to open a gap', () => {
    render(<OrderingInput question={question} value={'B\nA\nD\nC'} onChange={() => undefined} />)
    const items = Array.from(document.querySelectorAll<HTMLElement>('ol > li'))
    items.forEach((item, index) => {
      item.getBoundingClientRect = () =>
        ({ top: index * 46, height: 40, bottom: index * 46 + 40, left: 0, width: 300 }) as DOMRect
    })
    const handle = document.querySelectorAll<HTMLElement>('[data-drag-handle]')[0]!
    expect(handle.className).toContain('coarse:w-11')
    fireEvent.pointerDown(handle, { pointerType: 'touch', pointerId: 9, clientX: 10, clientY: 20 })
    fireEvent.pointerMove(window, { pointerType: 'touch', pointerId: 9, clientX: 10, clientY: 120 })
    const rows = Array.from(document.querySelectorAll<HTMLElement>('ol > li'))
    expect(rows[0]!.className).not.toContain('opacity-60')
    expect(rows[0]!.className).toContain('shadow-lift')
    // Rows 1 and 2 move up one step (40px row + 6px gap); row 3 stays.
    expect(rows[1]!.style.transform).toBe('translateY(-46px)')
    expect(rows[2]!.style.transform).toBe('translateY(-46px)')
    expect(rows[3]!.style.transform).toBe('')
    expect(rows[1]!.className).toContain('duration-200')
    expect(rows[1]!.className).toContain('motion-reduce:transition-none')
    fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 9 })
    for (const row of Array.from(document.querySelectorAll<HTMLElement>('ol > li')))
      expect(row.style.transform).toBe('')
  })
})

describe('touch sizes and labels (T03 / T07 / T13)', () => {
  it('walkthrough contents links are 44px in both styles', () => {
    expect(source('widgets/homework/walkthrough/HomeworkWalkthroughPanel.tsx')).toContain(
      'coarse:!py-3',
    )
  })

  it('plain links grow to 44px on touch', () => {
    expect(source('pages/ProjectDetailPage.tsx')).toContain('coarse:h-11 coarse:w-11')
    expect(source('widgets/documents/DocumentList.tsx')).toContain('coarse:py-3')
    expect(source('pages/TutorPage.tsx')).toContain('lab:hover:bg-muted coarse:min-h-11')
    expect(source('pages/QuizLandingPage.tsx')).toMatch(/const ROW_LINK =\s+'[^']*coarse:min-h-11/)
    const dashboard = source('pages/DashboardPage.tsx')
    expect(dashboard).toContain('rounded-sm coarse:min-h-11 coarse:py-1')
    expect(dashboard).toContain('coarse:inline-flex coarse:min-h-11 coarse:items-center')
    expect(source('app/layout/TopNav.tsx')).toContain('coarse:min-h-11 coarse:min-w-11')
  })

  it('the guided operation field has its own label', () => {
    const file = source('widgets/homework/guided/GuidedMatrixPractice.tsx')
    expect(file).toContain("aria-label={t('guided.opLabel')}")
    expect(file).toContain('htmlFor={`${opFieldId}-op-${stepNumber}`}')
  })
})
