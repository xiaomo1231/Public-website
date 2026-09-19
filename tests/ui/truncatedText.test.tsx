import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TruncatedText } from '@/shared/ui/TruncatedText'

/**
 * Radix's popper (floating-ui `autoUpdate`) needs ~10s to mount a tooltip under
 * jsdom, so we replace the primitive with a passthrough. That still exercises
 * everything this component owns: the full text is handed to the tooltip
 * content, and the trigger keeps the text intact.
 */
vi.mock('@radix-ui/react-tooltip', async () => {
  const React = await import('react')
  const passthrough = ({ children }: { children?: never }) =>
    React.createElement(React.Fragment, null, children)
  return {
    Provider: passthrough,
    Root: passthrough,
    Trigger: passthrough,
    Portal: passthrough,
    Content: ({ children }: { children?: never }) =>
      React.createElement('div', { role: 'tooltip' }, children),
  }
})

const LONG =
  'Calculus_Lecture_Week_03_Derivatives_and_Applications_Review_Materials_2026_Final_Version.pdf'
const LONG_CJK = '这是一个非常非常非常非常非常长的课程资料文件名称.pdf'

/** The visible element is the only one carrying `aria-label` (the tooltip is not). */
function triggerOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[aria-label]')
  if (!el) throw new Error('expected a truncated-text trigger')
  return el
}

describe('TruncatedText', () => {
  it('renders the full text in the DOM, never a pre-truncated copy', () => {
    const { container } = render(<TruncatedText text={LONG} />)
    // CSS does the clipping; the data stays intact for copy/paste and tests.
    expect(triggerOf(container)).toHaveTextContent(LONG)
    expect(triggerOf(container).textContent).toBe(LONG)
  })

  it('applies the shrink-and-ellipsis classes that keep containers from growing', () => {
    const { container } = render(<TruncatedText text={LONG} />)
    const el = triggerOf(container)
    expect(el).toHaveClass('min-w-0')
    expect(el).toHaveClass('max-w-full')
    expect(el).toHaveClass('truncate')
  })

  it('exposes the full name to assistive tech via aria-label', () => {
    const { container } = render(<TruncatedText text={LONG} />)
    expect(triggerOf(container)).toHaveAttribute('aria-label', LONG)
  })

  it('hands the full, untruncated name to the tooltip', () => {
    render(<TruncatedText text={LONG} />)
    expect(screen.getByRole('tooltip')).toHaveTextContent(LONG)
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('...')
  })

  it('can opt out of the tooltip', () => {
    const { container } = render(<TruncatedText text={LONG} tooltip={false} />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    const el = triggerOf(container)
    expect(el).toHaveClass('truncate')
    expect(el).toHaveAttribute('aria-label', LONG)
  })

  it('accepts extra classes without losing the truncation contract', () => {
    const { container } = render(
      <TruncatedText text={LONG} className="min-w-0 flex-1 font-medium" />,
    )
    const el = triggerOf(container)
    expect(el).toHaveClass('flex-1')
    expect(el).toHaveClass('font-medium')
    expect(el).toHaveClass('truncate')
    expect(el).toHaveClass('min-w-0')
  })

  it('renders as a different element when asked', () => {
    render(<TruncatedText as="h3" text="Project name" />)
    expect(screen.getByRole('heading', { name: 'Project name' })).toBeInTheDocument()
  })

  it('handles a long Chinese name without altering it', () => {
    const { container } = render(<TruncatedText text={LONG_CJK} />)
    expect(triggerOf(container).textContent).toBe(LONG_CJK)
    expect(triggerOf(container)).toHaveAttribute('aria-label', LONG_CJK)
    expect(screen.getByRole('tooltip')).toHaveTextContent(LONG_CJK)
  })

  it('handles a long unbroken ASCII name', () => {
    const name = `${'A'.repeat(120)}.pdf`
    const { container } = render(<TruncatedText text={name} />)
    expect(triggerOf(container).textContent).toBe(name)
    expect(triggerOf(container)).toHaveClass('truncate')
  })

  it('handles a name with no extension and an over-long extension', () => {
    const first = render(<TruncatedText text="no_extension_here" />)
    expect(triggerOf(first.container).textContent).toBe('no_extension_here')

    const second = render(<TruncatedText text="weird.verylongsuffixindeed" />)
    expect(triggerOf(second.container).textContent).toBe('weird.verylongsuffixindeed')
  })

  it('handles an empty string', () => {
    const { container } = render(<TruncatedText text="" />)
    expect(container.querySelector('span')).toBeInTheDocument()
  })
})
