import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { WalkthroughBody } from '@/widgets/homework/walkthrough/WalkthroughBody'
import { RichText } from '@/shared/ui/RichText'
import { FitWidthScope } from '@/shared/ui/FitWidthScope'

/*
 * jsdom has no layout: sizes are mocked per element, as a function of the
 * fitted stage the component rendered, so the measure → decide → re-render
 * loop runs as in a browser.
 */
const COLUMN = 300
let displayWidth: (variant: string) => number = () => 0
let pairWidth: (layout: string) => number = () => 0

function scaleOf(element: HTMLElement | null): number {
  const size = element?.style.fontSize ?? ''
  return size.endsWith('em') ? parseFloat(size) : 1
}

function stepScale(element: HTMLElement): number {
  const size = element.style.getPropertyValue('--step-matrix-size')
  return size ? parseFloat(size) / 15 : 1
}

beforeEach(() => {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    )
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains('katex-display') || this.hasAttribute('data-step-pair'))
        return COLUMN
      return 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains('katex-display')) {
        const host = this.closest<HTMLElement>('.katex-host')
        return displayWidth(host?.dataset.fitStage ?? 'natural') * scaleOf(host)
      }
      if (this.hasAttribute('data-step-pair'))
        return pairWidth(this.dataset.stepPair ?? 'row') * stepScale(this)
      return 0
    },
  })
})

afterEach(() => {
  // The overrides are own properties of HTMLElement.prototype; removing them
  // restores jsdom's (Element.prototype) getters.
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
  displayWidth = () => 0
  pairWidth = () => 0
  vi.unstubAllGlobals()
})

describe('walkthrough content fits its column (no sideways scroll)', () => {
  it('breaks a long chain into aligned lines at its relations', async () => {
    displayWidth = (variant) => (variant === 'broken' ? 280 : 700)
    const { container } = render(
      <WalkthroughBody text={'$$a + b = c + d + e + f = g + h + i + j$$'} />,
    )
    const host = container.querySelector<HTMLElement>('.katex-host.katex-fit')!
    await waitFor(() => expect(host.dataset.fitStage).toBe('broken'))
    // The aligned form (a KaTeX table of lines), full size, no scroll.
    expect(host.querySelector('.mtable')).not.toBeNull()
    expect(host.style.fontSize).toBe('')
    expect(host.hasAttribute('data-fit-scroll')).toBe(false)
  })

  it('shrinks a slightly wide formula instead of breaking it', async () => {
    displayWidth = () => 320
    const { container } = render(<WalkthroughBody text={'$$a + b = c$$'} />)
    const host = container.querySelector<HTMLElement>('.katex-host.katex-fit')!
    await waitFor(() => expect(host.style.fontSize).toBe('0.93em'))
    expect(host.dataset.fitStage).toBe('natural')
  })

  it('wraps, then scrolls with a visible hint only when nothing else fits', async () => {
    displayWidth = () => 1000
    const { container } = render(<WalkthroughBody text={'$$\\boxed{x = 1 + 2}$$'} />)
    const host = container.querySelector<HTMLElement>('.katex-host.katex-fit')!
    await waitFor(() => expect(host.hasAttribute('data-fit-scroll')).toBe(true))
    expect(host.dataset.fitStage).toBe('wrap')
    expect(host.hasAttribute('data-fit-wrap')).toBe(true)
    expect(host.style.fontSize).toBe('0.7em')
    expect(container.querySelector('[data-fit-hint]')).not.toBeNull()
  })

  it('stacks a step card’s matrices with a downward arrow when the pair is too wide', async () => {
    pairWidth = (layout) => (layout === 'row' ? 520 : 260)
    const text = [
      '$$\\begin{bmatrix} 1 & 2 \\\\ 2 & 1 \\end{bmatrix}$$',
      '',
      '作 $R_2 \\to R_2 - 2R_1$：',
      '',
      '$$\\begin{bmatrix} 1 & 2 \\\\ 0 & -3 \\end{bmatrix}$$',
    ].join('\n')
    const { container } = render(<WalkthroughBody text={text} />)
    const pair = container.querySelector<HTMLElement>('[data-step-pair]')!
    expect(pair.dataset.stepPair).toBe('row')
    await waitFor(() => expect(pair.dataset.stepPair).toBe('stack'))
    expect(pair.querySelector('[data-step-arrow="down"]')).not.toBeNull()
    expect(pair.className).toContain('flex-col')
    expect(pair.className).not.toContain('overflow-x-auto')
  })

  it('scales stacked matrices before falling back to a scroll', async () => {
    pairWidth = (layout) => (layout === 'row' ? 700 : 360)
    const text = [
      '$$\\begin{bmatrix} 1 & 2 \\\\ 2 & 1 \\end{bmatrix}$$',
      '',
      '作 $R_2 \\to R_2 - 2R_1$：',
      '',
      '$$\\begin{bmatrix} 1 & 2 \\\\ 0 & -3 \\end{bmatrix}$$',
    ].join('\n')
    const { container } = render(<WalkthroughBody text={text} />)
    const pair = container.querySelector<HTMLElement>('[data-step-pair]')!
    await waitFor(() => expect(pair.style.getPropertyValue('--step-matrix-size')).toBe('12.45px'))
    expect(pair.hasAttribute('data-fit-scroll')).toBe(false)
  })
})

describe('fitted RichText (walkthrough scope only)', () => {
  it('inline math never gets a nowrap / scroll box in the walkthrough', () => {
    const text = 'Here $\\begin{bmatrix} 1 & 2 \\end{bmatrix}$ and $a + b = c$.'
    const fitted = render(
      <FitWidthScope>
        <RichText text={text} format="markdown" />
      </FitWidthScope>,
    )
    for (const host of fitted.container.querySelectorAll('.katex-host')) {
      expect(host.className).not.toMatch(/overflow-x-auto|whitespace-nowrap/)
    }
    // Elsewhere (quiz cards, lessons) the old behaviour stays.
    const plain = render(<RichText text={text} format="markdown" />)
    expect(plain.container.querySelector('.katex-host')!.className).toContain('overflow-x-auto')
  })

  it('code blocks wrap instead of scrolling in the walkthrough', () => {
    const text = '```\nconst a_very_long_line = 1\n```'
    const fitted = render(
      <FitWidthScope>
        <RichText text={text} format="markdown" />
      </FitWidthScope>,
    )
    const pre = fitted.container.querySelector('pre')!
    expect(pre.className).toContain('whitespace-pre-wrap')
    expect(pre.className).not.toContain('overflow-x-auto')
    const plain = render(<RichText text={text} format="markdown" />)
    expect(plain.container.querySelector('pre')!.className).toContain('overflow-x-auto')
  })

  it('tables wrap their cells and do not scroll unless they cannot fit', () => {
    const text = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const fitted = render(
      <FitWidthScope>
        <RichText text={text} format="markdown" />
      </FitWidthScope>,
    )
    const region = fitted.container.querySelector('[data-fit-table]')!
    expect(region.className).not.toContain('overflow-x-auto')
    expect(region.querySelector('td')!.className).toContain('[overflow-wrap:anywhere]')
  })
})
