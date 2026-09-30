import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FunctionPlot } from '@/widgets/dashboard/FunctionPlot'

/**
 * The interactive plot must keep its three faces in agreement — the drawn
 * curve, the printed formula and the coordinate readout all come from the same
 * coefficients — and the randomly chosen family must be stable for the whole
 * visit.
 */
function setRange(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('FunctionPlot', () => {
  beforeEach(() => {
    // Deterministic initial family: 0 → the first entry (linear).
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the chosen family with a local coordinate readout', () => {
    render(<FunctionPlot />)

    expect(screen.getByText('f(x) = x')).toBeInTheDocument()
    // a = 1, b = 0, probe x = 1 → f(1) = 1
    expect(screen.getByText('P (1, 1)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('img', { name: /Interactive plot/ })).toBeInTheDocument()
  })

  it('switches family and shows that family’s parameters', () => {
    render(<FunctionPlot />)

    fireEvent.click(screen.getByRole('button', { name: 'Quadratic' }))
    expect(screen.getByText('f(x) = x²')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quadratic' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute('aria-pressed', 'false')
    // The quadratic exposes a, b and c.
    expect(screen.getByLabelText('a')).toBeInTheDocument()
    expect(screen.getByLabelText('c')).toBeInTheDocument()
  })

  it('keeps the formula and the readout in step with the coefficients', () => {
    render(<FunctionPlot />)
    fireEvent.click(screen.getByRole('button', { name: 'Quadratic' }))

    setRange('a', '-2')
    expect(screen.getByText('f(x) = −2·x²')).toBeInTheDocument()
    // Probe x = 1 → f(1) = -2
    expect(screen.getByText('P (1, -2)')).toBeInTheDocument()
  })

  it('resets the current family to its defaults', () => {
    render(<FunctionPlot />)
    fireEvent.click(screen.getByRole('button', { name: 'Cubic' }))

    setRange('c', '2')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(screen.getByText('f(x) = 0.3·x³')).toBeInTheDocument()
  })

  it('does not re-roll the family on parameter changes', () => {
    render(<FunctionPlot />)
    expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute('aria-pressed', 'true')

    // A parameter change re-renders but must not change the chosen family.
    setRange('a', '2.5')
    expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute('aria-pressed', 'true')

    // A manual choice also persists across further edits.
    fireEvent.click(screen.getByRole('button', { name: 'Sine' }))
    setRange('A', '3')
    expect(screen.getByRole('button', { name: 'Sine' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('honours the random initial family', () => {
    vi.mocked(Math.random).mockReturnValue(0.9)
    render(<FunctionPlot />)
    expect(screen.getByRole('button', { name: 'Sine' })).toHaveAttribute('aria-pressed', 'true')
  })
})
