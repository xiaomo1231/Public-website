import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { MarketSpec } from '@/entities/econ/market'
import {
  decodeDrawAnswer,
  decodeShiftAnswer,
  gradeMarketQuestion,
  type MarketQuestion,
} from '@/entities/econ/graphQuestion'
import { MarketDrawInput } from '@/widgets/econ/MarketDrawInput'
import { ShiftIdInput } from '@/widgets/econ/ShiftIdInput'
import { MarketQuestionFigure } from '@/widgets/econ/MarketQuestionFigure'
import { MarketPartsAnswer } from '@/widgets/econ/MarketAnswerInput'
import { setUILanguage } from '@/i18n'
import { installPointerEvent } from '../helpers/pointerEvent'

// Demand P = 100 − 2Q, supply P = 20 + 2Q, a tax of 8 on sellers:
// Q_t = 18, P_b = 64. Axes: Q 0–60, P 0–120 (520 × 380, pad 50/16/16/34).
const TAX: MarketSpec = {
  demand: { form: 'price', intercept: 100, slope: -2 },
  supply: { form: 'price', intercept: 20, slope: 2 },
  scenario: { kind: 'tax', amount: 8, on: 'sellers' },
}
const QUESTION: MarketQuestion = {
  kind: 'draw_diagram',
  figure: { spec: TAX, show: 'before', priceUnit: '$' },
  draw: { items: ['curve', 'direction', 'amount', 'equilibrium', 'region'], region: 'dwl' },
}
const PLOT = { left: 50, top: 16, w: 520 - 50 - 16, h: 380 - 16 - 34, q: 60, p: 120 }
const x = (q: number) => PLOT.left + (q / PLOT.q) * PLOT.w
const y = (p: number) => PLOT.top + (1 - p / PLOT.p) * PLOT.h

let latest = ''
function Controlled({ question = QUESTION }: { question?: MarketQuestion }) {
  const [value, setValue] = useState('')
  return (
    <MarketDrawInput
      question={question}
      value={value}
      onChange={(next) => {
        latest = next
        setValue(next)
      }}
    />
  )
}

let restorePointer: (() => void) | null = null
beforeEach(() => {
  setUILanguage('en')
  latest = ''
  restorePointer = installPointerEvent()
})
afterEach(() => {
  restorePointer?.()
  restorePointer = null
})

describe('drawing on the diagram (pointer)', () => {
  it('drag supply up by the tax, tap the outcome, choose the region: every item right', () => {
    const { container } = render(<Controlled />)
    const handle = container.querySelector('[data-drag="supply"]')!
    // 22 px up on a 330 px axis of 120 = 8.
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 200, pointerId: 1, pointerType: 'pen' })
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 190, pointerId: 1, pointerType: 'pen' })
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 178, pointerId: 1, pointerType: 'pen' })
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 178, pointerId: 1, pointerType: 'pen' })
    expect(decodeDrawAnswer(latest)?.supply).toEqual({ dq: 0, dp: 8 })
    expect(container.querySelector('[data-curve="student-supply"]')).not.toBeNull()
    expect(container.querySelector('[data-curve="supply"]')?.getAttribute('data-dashed')).toBe(
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark the outcome' }))
    fireEvent.click(container.querySelector('[data-plot-area]')!, {
      clientX: x(18),
      clientY: y(64),
    })
    expect(decodeDrawAnswer(latest)?.point).toEqual({ q: 18, p: 64 })
    expect(container.querySelector('[data-student-point]')).not.toBeNull()

    const regions = screen.getByRole('radiogroup', { name: 'Region:' })
    fireEvent.click(within(regions).getByRole('radio', { name: 'Deadweight loss' }))
    // The selected region is shaded from the student's own drawing.
    expect(container.querySelector('[data-student-region="dwl"]')).not.toBeNull()

    const result = gradeMarketQuestion(QUESTION, latest)!
    expect(result.items.map((item) => [item.key, item.correct])).toEqual([
      ['curve', true],
      ['direction', true],
      ['amount', true],
      ['equilibrium', true],
      ['region', true],
    ])
  })

  it('a drag the wrong way is graded wrong on direction and amount only', () => {
    const { container } = render(<Controlled />)
    const handle = container.querySelector('[data-drag="supply"]')!
    fireEvent.pointerDown(handle, {
      clientX: 300,
      clientY: 200,
      pointerId: 1,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(handle, {
      clientX: 300,
      clientY: 222,
      pointerId: 1,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 222, pointerId: 1, pointerType: 'touch' })
    const result = gradeMarketQuestion(QUESTION, latest)!
    const byKey = Object.fromEntries(result.items.map((item) => [item.key, item.correct]))
    expect(byKey).toMatchObject({ curve: true, direction: false, amount: false })
  })

  it('tapping inside a shaded region of the drawing selects it', () => {
    const { container } = render(<Controlled />)
    const handle = container.querySelector('[data-drag="supply"]')!
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 178, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 178, pointerId: 1 })
    // Inside the DWL triangle between Q = 18 and Q = 20, near P = 60.
    fireEvent.click(container.querySelector('[data-plot-area]')!, {
      clientX: x(19),
      clientY: y(60),
    })
    expect(decodeDrawAnswer(latest)?.region).toBe('dwl')
  })
})

describe('drawing with the keyboard', () => {
  it('arrow keys move the selected curve and the outcome marker; Enter places it', () => {
    const { container } = render(<Controlled />)
    const plot = container.querySelector('[data-market-draw-plot]') as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: 'Supply' }))
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(plot, { key: 'ArrowUp' })
    expect(decodeDrawAnswer(latest)?.supply).toEqual({ dq: 0, dp: 8 })
    fireEvent.click(screen.getByRole('button', { name: 'Mark the outcome' }))
    fireEvent.keyDown(plot, { key: 'Enter' })
    expect(decodeDrawAnswer(latest)?.point).toEqual({ q: 20, p: 60 })
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    fireEvent.keyDown(plot, { key: 'ArrowUp' })
    fireEvent.keyDown(plot, { key: 'ArrowUp' })
    expect(decodeDrawAnswer(latest)?.point).toEqual({ q: 18, p: 64 })
    expect(container.querySelector('[data-draw-summary]')?.textContent).toContain('Q ≈ 18')
  })

  it('a policy line is placed with a button and moved with the arrows', () => {
    const ceiling: MarketQuestion = {
      kind: 'draw_diagram',
      figure: { spec: { ...TAX, scenario: { kind: 'ceiling', price: 50 } }, show: 'before' },
      draw: { items: ['policy', 'equilibrium', 'region'], region: 'dwl' },
    }
    const { container } = render(<Controlled question={ceiling} />)
    fireEvent.click(screen.getByRole('button', { name: 'Place the policy line' }))
    expect(decodeDrawAnswer(latest)?.policy).toBe(60)
    const plot = container.querySelector('[data-market-draw-plot]') as HTMLElement
    for (let i = 0; i < 5; i += 1) fireEvent.keyDown(plot, { key: 'ArrowDown' })
    expect(decodeDrawAnswer(latest)?.policy).toBe(50)
    const graded = gradeMarketQuestion(ceiling, latest)!
    expect(graded.items.find((item) => item.key === 'policy')?.correct).toBe(true)
  })
})

describe('shift identification choices', () => {
  function Shift() {
    const [value, setValue] = useState('')
    return <ShiftIdInput value={value} onChange={(next) => ((latest = next), setValue(next))} />
  }

  it('segmented choices ≥ 44 px, arrow keys move within a row', () => {
    render(<Shift />)
    const demand = screen.getByRole('radiogroup', { name: 'Demand curve' })
    const right = within(demand).getByRole('radio', { name: 'Right (increase)' })
    expect(right.className).toContain('min-h-11')
    fireEvent.click(right)
    expect(decodeShiftAnswer(latest)).toEqual({ demand: 'increase' })
    fireEvent.keyDown(right, { key: 'ArrowRight' })
    expect(decodeShiftAnswer(latest)?.demand).toBe('decrease')
    const price = screen.getByRole('radiogroup', { name: 'Equilibrium price P*' })
    fireEvent.click(within(price).getByRole('radio', { name: 'Ambiguous' }))
    expect(decodeShiftAnswer(latest)).toEqual({ demand: 'decrease', price: 'ambiguous' })
  })
})

describe('the question figure', () => {
  it('draws the curves; “before” marks the equilibrium; “after” the change, never areas', () => {
    const { container, rerender } = render(
      <MarketQuestionFigure figure={{ spec: TAX, show: 'curves' }} />,
    )
    expect(container.querySelector('[data-equilibrium]')).toBeNull()
    rerender(<MarketQuestionFigure figure={{ spec: TAX, show: 'before' }} />)
    expect(container.querySelector('[data-equilibrium]')).not.toBeNull()
    expect(container.querySelector('[data-curve="new-supply"]')).toBeNull()
    rerender(<MarketQuestionFigure figure={{ spec: TAX, show: 'after' }} />)
    expect(container.querySelector('[data-curve="new-supply"]')).not.toBeNull()
    expect(container.querySelector('[data-outcome]')).not.toBeNull()
    expect(container.querySelector('[data-area]')).toBeNull()
  })

  it('graph parts write their answers into the draft as (a) / (b) lines', () => {
    let draft = ''
    function Parts() {
      const [value, setValue] = useState('')
      return (
        <MarketPartsAnswer
          parts={[
            {
              label: 'a',
              grader: {
                kind: 'market',
                question: {
                  kind: 'shift_id',
                  figure: {
                    spec: { ...TAX, scenario: { kind: 'shift', supply: { dq: -5 } } },
                    show: 'before',
                  },
                },
              },
            },
            { label: 'b', grader: { kind: 'text' } },
          ]}
          value={value}
          onChange={(next) => ((draft = next), setValue(next))}
        />
      )
    }
    render(<Parts />)
    const supply = screen.getByRole('radiogroup', { name: 'Supply curve' })
    fireEvent.click(within(supply).getByRole('radio', { name: 'Left (decrease)' }))
    expect(draft).toBe('(a) shift: supply=decrease\n(b)')
  })
})
