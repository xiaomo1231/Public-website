import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { applySymbol, symbolGroupsFor, type SymbolItem } from '@/shared/lib/mathInput'
import { previewExpression, compareMath } from '@/infrastructure/math/expressionEvaluator'
import { previewQuantity, compareQuantity } from '@/infrastructure/math/quantityAnswer'
import { MathField } from '@/widgets/mathInput/MathField'
import type { MathInputMode } from '@/shared/lib/mathInput'

const find = (mode: MathInputMode, glyph: string, subject?: string): SymbolItem => {
  const item = symbolGroupsFor(mode, subject)
    .flatMap((group) => group.items)
    .find((candidate) => candidate.glyph === glyph)
  if (!item) throw new Error(`no ${glyph} in ${mode}`)
  return item
}

describe('applySymbol', () => {
  it('inserts at the caret and moves the caret after a plain symbol', () => {
    expect(applySymbol('x  1', 2, 2, find('text', '≤'))).toEqual({
      value: 'x ≤ 1',
      selectionStart: 3,
      selectionEnd: 3,
    })
  })

  it('places the caret inside a template', () => {
    const result = applySymbol('', 0, 0, find('expression', '√'))
    expect(result.value).toBe('sqrt()')
    expect(result.selectionStart).toBe(5)
  })

  it('wraps the selection in a template', () => {
    const result = applySymbol('x+1', 0, 3, find('expression', '√'))
    expect(result.value).toBe('sqrt(x+1)')
    expect(result.selectionStart).toBe(9)
  })

  it('replaces a selection with a plain symbol', () => {
    expect(applySymbol('a <= b', 2, 4, find('text', '≤')).value).toBe('a ≤ b')
  })
})

describe('symbol groups', () => {
  it('orders free-text groups by course subject', () => {
    expect(symbolGroupsFor('text', 'discrete_math')[0]!.id).toBe('sets')
    expect(symbolGroupsFor('text', 'stats')[0]!.id).toBe('stats')
    expect(symbolGroupsFor('text', 'chemistry')[0]!.id).toBe('chemistry')
    expect(symbolGroupsFor('text', undefined)[0]!.id).toBe('basic')
  })

  it('every graded-mode template produces input the grader accepts', () => {
    // Expression keys build mathjs syntax, so the result must parse.
    for (const group of symbolGroupsFor('expression')) {
      for (const item of group.items) {
        // Use each key the way a student would: fill its brackets, and give
        // an operator something on both sides.
        let sample = item.insert.split('()').join('(x)').trim()
        if (/^[-+*/^]/.test(sample)) sample = `x${sample}`
        if (/[-+*/^]$/.test(sample)) sample = `${sample}x`
        expect(previewExpression(sample).status, `${item.glyph} → ${sample}`).toBe('ok')
      }
    }
  })

  it('reads keyboard-built answers the same way the graders do', () => {
    expect(compareMath('pi*x^(2)', 'π x²').equivalent).toBe(true)
    expect(compareMath('(x)/(2) + C', 'x/2').equivalent).toBe(true)
    expect(compareQuantity('3×10^8 m/s', '3e8', 'm/s').isCorrect).toBe(true)
    expect(compareQuantity('5 μΩ', '5e-6', 'ohm').isCorrect).toBe(true)
  })
})

describe('live previews', () => {
  it('shows how an expression is read, including + C and equations', () => {
    expect(previewExpression('x^3/3 + C')).toMatchObject({ status: 'ok' })
    expect((previewExpression('x^3/3 + C') as { latex: string }).latex).toContain('+ C')
    expect((previewExpression('y = 2x + 1') as { latex: string }).latex).toContain('=')
    expect(previewExpression('sqrt(x')).toEqual({ status: 'error' })
    expect(previewExpression('  ')).toEqual({ status: 'empty' })
  })

  it('explains a quantity before it is submitted', () => {
    expect(previewQuantity('9.8 m/s²')).toEqual({ status: 'ok', value: 9.8, unit: 'm/s^2' })
    expect(previewQuantity('9.8')).toEqual({ status: 'no-unit', value: 9.8 })
    expect(previewQuantity('9.8 parsecs-ish')).toMatchObject({ status: 'bad-unit' })
    expect(previewQuantity('m/s')).toEqual({ status: 'bad-number' })
  })
})

function Harness(props: { mode: MathInputMode; onSubmit?: () => void; multiline?: boolean; initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '')
  return (
    <MathField
      mode={props.mode}
      value={value}
      onChange={setValue}
      aria-label="answer"
      {...(props.multiline ? { multiline: true } : {})}
      {...(props.onSubmit ? { onSubmit: props.onSubmit } : {})}
    />
  )
}

describe('MathField', () => {
  it('inserts a template at the caret from the symbol bar', async () => {
    const user = userEvent.setup()
    render(<Harness mode="expression" />)
    const field = screen.getByRole('textbox', { name: 'answer' })
    await user.type(field, '2*')
    await user.click(screen.getByRole('button', { name: 'Insert sqrt()' }))
    expect(field).toHaveValue('2*sqrt()')
    // Focus and the caret come back inside the brackets, so typing continues there.
    await waitFor(() => expect(field).toHaveFocus())
    expect((field as HTMLInputElement).selectionStart).toBe(7)
    await user.keyboard('x')
    expect(field).toHaveValue('2*sqrt(x)')
    // The preview shows how the grader reads it.
    await waitFor(() => expect(screen.getByText('Will be read as')).toBeInTheDocument())
  })

  it('warns about an unreadable expression and a missing unit', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness mode="expression" initial="sqrt(x" />)
    expect(screen.getByText(/cannot be read yet/)).toBeInTheDocument()
    unmount()
    render(<Harness mode="quantity" />)
    await user.type(screen.getByRole('textbox', { name: 'answer' }), '9.8')
    expect(screen.getByText(/No unit yet/)).toBeInTheDocument()
  })

  it('keeps the free-text keyboard folded until asked for', async () => {
    const user = userEvent.setup()
    render(<Harness mode="text" multiline />)
    expect(screen.queryByRole('button', { name: 'Insert ≤' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Symbols' }))
    await user.click(screen.getByRole('button', { name: 'Insert ≤' }))
    expect(screen.getByRole('textbox', { name: 'answer' })).toHaveValue('≤')
  })

  it('submits with Enter, or Ctrl+Enter in a multi-line field', async () => {
    const user = userEvent.setup()
    const single = vi.fn()
    const { unmount } = render(<Harness mode="number" onSubmit={single} />)
    await user.type(screen.getByRole('textbox', { name: 'answer' }), '42{Enter}')
    expect(single).toHaveBeenCalledTimes(1)
    unmount()

    const multi = vi.fn()
    render(<Harness mode="text" multiline onSubmit={multi} />)
    const area = screen.getByRole('textbox', { name: 'answer' })
    await user.type(area, 'line one{Enter}line two')
    expect(multi).not.toHaveBeenCalled()
    expect(area).toHaveValue('line one\nline two')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(multi).toHaveBeenCalledTimes(1)
  })
})
