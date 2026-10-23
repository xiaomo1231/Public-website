import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { normalizeVisualizations } from '@/entities/tutorVisualization/normalize'
import { looksLikeMarketText } from '@/entities/tutorVisualization/graphable'
import type { TutorVisualization } from '@/entities/tutorVisualization/types'
import type { Subject } from '@/entities/project/types'
import { prompts, PROMPT_VERSIONS } from '@/infrastructure/ai/prompts'
import * as V10 from '@/infrastructure/ai/prompts/visualization-generator/v10'
import * as V11 from '@/infrastructure/ai/prompts/visualization-generator/v11'
import { TutorVisualizationFigure } from '@/widgets/tutor/TutorVisualizationFigure'
import { installPointerEvent } from '../helpers/pointerEvent'

function one(draft: Record<string, unknown>): TutorVisualization | string {
  const result = normalizeVisualizations({ visualizations: [draft] })
  return result.visualizations[0] ?? result.rejected[0]!.reason
}

function draw(draft: Record<string, unknown>) {
  const value = one(draft)
  if (typeof value === 'string') throw new Error(value)
  return render(<TutorVisualizationFigure visualization={value} />)
}

const taxDraft = {
  type: 'market_2d',
  demand: { form: 'price', intercept: 180, slope: -2 },
  supply: { form: 'price', intercept: 60, slope: 2 },
  scenario: { kind: 'tax', amount: 40, on: 'sellers' },
  priceUnit: '$',
}

const ceilingDraft = {
  type: 'market_2d',
  demand: { form: 'quantity', intercept: 24, slope: -2 },
  supply: { form: 'quantity', intercept: 0, slope: 2 },
  scenario: { kind: 'ceiling', price: 4 },
  priceUnit: '$',
}

const readout = (container: HTMLElement) =>
  container.querySelector('[data-market-readout]')!.textContent ?? ''

describe('market_2d normalization', () => {
  it('stores only the lesson parameters and validates them by solving', () => {
    const value = one(taxDraft)
    expect(value).toMatchObject({
      type: 'market_2d',
      schemaVersion: 11,
      priceUnit: '$',
      panels: [{ spec: { scenario: { kind: 'tax', amount: 40, on: 'sellers' } } }],
    })
    expect(JSON.stringify(value)).not.toContain('equilibrium"')
  })

  it('drops markets that cannot be drawn correctly', () => {
    expect(
      one({
        ...taxDraft,
        demand: { form: 'price', intercept: 50, slope: -1 },
        supply: { form: 'price', intercept: 60, slope: 1 },
      }),
    ).toBe('market-equilibrium-not-positive')
    expect(one({ ...taxDraft, demand: { form: 'price', intercept: 50, slope: 1 } })).toBe(
      'market-demand-slopes-up',
    )
    expect(one({ ...taxDraft, scenario: { kind: 'tax', amount: 200, on: 'sellers' } })).toBe(
      'market-market-shut-down',
    )
    expect(one({ ...taxDraft, scenario: { kind: 'magic' } })).toBe('invalid-market')
    expect(one({ type: 'market_2d', demand: 'P = 180 - 2Q' })).toBe('invalid-market')
  })

  it('reads two panels, curve labels and the quantity scale', () => {
    const value = one({
      type: 'market_2d',
      labels: { demand: 'D', supply: 'S + <b>' },
      quantityScale: 'thousands',
      panels: [
        {
          title: 'Elastic',
          demand: { form: 'price', intercept: 100, slope: -0.5 },
          supply: taxDraft.supply,
          scenario: { kind: 'equilibrium' },
        },
        {
          title: 'Inelastic',
          demand: { form: 'price', intercept: 300, slope: -6 },
          supply: taxDraft.supply,
          scenario: { kind: 'equilibrium' },
        },
        { title: 'ignored', demand: taxDraft.demand, supply: taxDraft.supply },
      ],
    })
    expect(value).toMatchObject({
      quantityScale: 'thousands',
      panels: [{ title: 'Elastic', labels: { demand: 'D' } }, { title: 'Inelastic' }],
    })
    expect((value as { panels: unknown[] }).panels).toHaveLength(2)
  })
})

describe('visualization prompt v11', () => {
  const others: Subject[] = [
    'calculus',
    'linear_algebra',
    'discrete_math',
    'physics',
    'chemistry',
    'biology',
    'cs',
    'stats',
    'medicine',
    'language',
  ]

  it('is registered and byte-identical to v10 for subjects without the market family', () => {
    expect(PROMPT_VERSIONS.visualizationGenerator).toBe('v11')
    expect(prompts.visualizationGenerator.VERSION).toBe('v11')
    for (const subject of others) {
      expect(V11.scienceFiguresFor(subject).market).toBe(false)
      expect(V11.buildSystemPrompt({ subject })).toBe(V10.buildSystemPrompt({ subject }))
    }
  })

  it('adds the market rules for economics and open courses, leaving the rest unchanged', () => {
    for (const subject of ['economics', 'other', undefined] as Array<Subject | undefined>) {
      const options = subject ? { subject } : {}
      const prompt = V11.buildSystemPrompt(options)
      expect(prompt).toContain('`market_2d`')
      expect(prompt).toMatch(/"type": "function_2d \| [^"]* \| market_2d"/)
      const withoutMarket = prompt
        .replace(`${V11.MARKET_RULES.join('\n')}\n\n`, '')
        .replace(' | market_2d"', '"')
      expect(withoutMarket).toBe(V10.buildSystemPrompt(options))
    }
    expect(V11.buildUserPrompt).toBe(V10.buildUserPrompt)
  })

  it('gates market lessons on economic vocabulary', () => {
    expect(looksLikeMarketText('The demand curve shifts right.')).toBe(true)
    expect(looksLikeMarketText('税收归宿与无谓损失')).toBe(true)
    expect(looksLikeMarketText('A price ceiling of $4 creates a shortage.')).toBe(true)
    expect(looksLikeMarketText('The integral of x squared.')).toBe(false)
  })
})

describe('market_2d rendering', () => {
  let restorePointer: (() => void) | null = null
  afterEach(() => {
    restorePointer?.()
    restorePointer = null
    vi.restoreAllMocks()
  })

  it('draws the tax example with computed labels, areas and readouts', () => {
    const { container } = draw(taxDraft)
    expect(container.querySelector('[data-curve="demand"]')).not.toBeNull()
    expect(container.querySelector('[data-curve="supply"][data-dashed="true"]')).not.toBeNull()
    expect(container.querySelector('[data-curve="new-supply"]')).not.toBeNull()
    expect(container.querySelector('[data-area="revenue"]')).not.toBeNull()
    expect(container.querySelector('[data-area="dwl"]')).not.toBeNull()
    expect(container.querySelector('[data-wedge]')).not.toBeNull()
    expect(screen.getByText('P₁* = $120')).toBeInTheDocument()
    expect(screen.getByText('Pb = $140')).toBeInTheDocument()
    expect(screen.getByText('Ps = $100')).toBeInTheDocument()
    expect(readout(container)).toContain('Q₂ = 20')
    expect(readout(container)).toContain('Per unit: buyers bear $20, sellers bear $20')
    const legend = container.querySelector('[data-area-legend]')!
    expect(within(legend as HTMLElement).getByText('Deadweight loss')).toBeInTheDocument()
    expect(legend.textContent).toContain('$200')
    expect(legend.textContent).toContain('$800')
    const summary = container.querySelector('[data-market-summary]')!.textContent ?? ''
    expect(summary).toContain('Demand: P = 180 − 2Q. Supply: P = 60 + 2Q.')
    expect(summary).toContain('Buyers pay $140 and sellers receive $100.')
    expect(summary).toContain('deadweight loss $200')
  })

  it('reveals the figure step by step', () => {
    const { container } = draw(taxDraft)
    const prev = screen.getByRole('button', { name: 'Previous step' })
    expect(screen.getByText('Step 5 of 5: Areas')).toBeInTheDocument()
    fireEvent.click(prev)
    expect(container.querySelector('[data-area]')).toBeNull()
    expect(container.querySelector('[data-outcome]')).not.toBeNull()
    fireEvent.click(prev)
    expect(container.querySelector('[data-outcome]')).toBeNull()
    expect(container.querySelector('[data-curve="new-supply"]')).not.toBeNull()
    fireEvent.click(prev)
    expect(container.querySelector('[data-curve="new-supply"]')).toBeNull()
    expect(container.querySelector('[data-curve="supply"][data-dashed]')).toBeNull()
    fireEvent.click(prev)
    expect(screen.getByText('Step 1 of 5: Axes')).toBeInTheDocument()
    expect(container.querySelector('[data-curve]')).toBeNull()
    expect(prev).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(container.querySelector('[data-curve="demand"]')).not.toBeNull()
  })

  it('moves from before to after with the slider', () => {
    const { container } = draw(taxDraft)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '0' } })
    expect(readout(container)).not.toContain('Q₂')
    fireEvent.change(slider, { target: { value: '0.5' } })
    // Half the tax (20): 120 − 4Q = 20 → Q = 25.
    expect(readout(container)).toContain('Q₂ = 25')
  })

  it('jumps straight to the result when reduced motion is preferred', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    )
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    draw(taxDraft)
    const slider = screen.getByRole('slider') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play the change' }))
    expect(slider.value).toBe('1')
    expect(raf).not.toHaveBeenCalled()
  })

  it('animates when motion is allowed', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    draw(taxDraft)
    fireEvent.click(screen.getByRole('button', { name: 'Play the change' }))
    expect(raf).toHaveBeenCalled()
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('0')
  })

  it('recomputes live when a curve is dragged or moved with the keyboard', () => {
    restorePointer = installPointerEvent()
    const { container } = draw(taxDraft)
    const before = readout(container)
    const handle = container.querySelector('[data-drag="supply"]')!
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 170, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 170, pointerId: 1 })
    const dragged = readout(container)
    expect(dragged).not.toBe(before)
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(readout(container)).toBe(before)

    // Keyboard: supply up by one step (5) → 180 − 2Q − (65 + 2Q) = 40 → Q = 18.75.
    fireEvent.click(screen.getByRole('button', { name: 'Supply' }))
    const panel = container.querySelector('[data-market-panel]') as HTMLElement
    fireEvent.keyDown(panel, { key: 'ArrowUp' })
    expect(readout(container)).toContain('Q₂ = 18.75')
  })

  it('drags a price ceiling and shows the shortage', () => {
    restorePointer = installPointerEvent()
    const { container } = draw(ceilingDraft)
    expect(container.querySelector('[data-gap="shortage"]')?.textContent).toBe('Shortage 8')
    expect(container.querySelector('[data-policy-label]')?.textContent).toBe('Ceiling')
    expect(readout(container)).toContain('Q₂ = 8')
    const line = container.querySelector('[data-drag="policy"]')!
    fireEvent.pointerDown(line, { clientX: 300, clientY: 200, pointerId: 2 })
    fireEvent.pointerMove(line, { clientX: 300, clientY: 215, pointerId: 2 })
    fireEvent.pointerUp(line, { clientX: 300, clientY: 215, pointerId: 2 })
    expect(readout(container)).not.toContain('Q₂ = 8')
  })

  it('switches to the surplus-change shading', () => {
    const { container } = draw(ceilingDraft)
    fireEvent.click(screen.getByRole('button', { name: 'Change in producer surplus' }))
    const ids = [...container.querySelectorAll('[data-area]')].map((el) =>
      el.getAttribute('data-area'),
    )
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => id?.startsWith('ps-change'))).toBe(true)
    expect(container.querySelector('[data-area-legend]')?.textContent).toContain(
      'Producer surplus (loss)',
    )
  })

  it('draws two panels for a comparison and the ambiguity of a double shift', () => {
    const { container } = draw({
      type: 'market_2d',
      panels: [
        {
          title: 'Elastic demand',
          demand: { form: 'price', intercept: 100, slope: -1 },
          supply: { form: 'price', intercept: 20, slope: 1 },
          scenario: { kind: 'shift', demand: { dq: 10 }, supply: { dq: 10 } },
        },
        {
          title: 'Inelastic demand',
          demand: { form: 'price', intercept: 300, slope: -6 },
          supply: { form: 'price', intercept: 20, slope: 1 },
          scenario: { kind: 'shift', supply: { dq: 10 } },
        },
      ],
    })
    expect(container.querySelectorAll('[data-market-panel]')).toHaveLength(2)
    expect(container.querySelector('[data-ambiguity]')?.textContent).toContain(
      'the price could go either way; with these numbers it stays the same',
    )
    expect(container.querySelectorAll('[data-shift-arrow]').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-elasticity]')?.textContent).toContain(
      'Midpoint elasticity of Demand',
    )
  })
})
