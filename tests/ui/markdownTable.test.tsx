import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RichText } from '@/shared/ui/RichText'

const TRUTH_TABLE = [
  '| P | Q | P∧Q |',
  '| :---: | :---: | :---: |',
  '| T | T | T |',
  '| T | F | F |',
  '| F | T | F |',
  '| F | F | F |',
].join('\n')

describe('RichText — markdown tables', () => {
  it('renders a truth table as a semantic table', () => {
    const { container } = render(<RichText format="markdown" text={TRUTH_TABLE} />)
    const table = container.querySelector('table')
    expect(table).toBeInTheDocument()
    expect(table?.querySelector('thead')).toBeInTheDocument()
    expect(table?.querySelector('tbody')).toBeInTheDocument()
    expect(table?.querySelectorAll('th[scope="col"]')).toHaveLength(3)
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(4)
    expect(table?.querySelectorAll('tbody td')).toHaveLength(12)
    // It is no longer a paragraph containing literal pipes.
    expect(container.textContent).not.toContain('| P | Q |')
  })

  it('applies controlled alignment classes', () => {
    const { container } = render(
      <RichText
        format="markdown"
        text={'| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |'}
      />,
    )
    const headers = [...container.querySelectorAll('th')]
    expect(headers[0]?.className).toContain('text-left')
    expect(headers[1]?.className).toContain('text-center')
    expect(headers[2]?.className).toContain('text-right')
  })

  it('renders inline math and inline code inside cells', () => {
    const { container } = render(
      <RichText
        format="markdown"
        text={'| E | M |\n| --- | --- |\n| $A \\cap B$ | `x && y` |'}
      />,
    )
    expect(container.querySelector('td .katex')).toBeInTheDocument()
    expect(container.querySelector('td code')?.textContent).toBe('x && y')
  })

  it('keeps injected HTML inert', () => {
    const { container } = render(
      <RichText
        format="markdown"
        text={
          '| a | b |\n| --- | --- |\n| <script>window.__pwned = true</script> | <img src=x onerror="window.__pwned = true"> |'
        }
      />,
    )
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('wraps the table in a keyboard-scrollable, labelled region', () => {
    render(<RichText format="markdown" text={TRUTH_TABLE} />)
    const region = screen.getByRole('region', { name: 'Table' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.className).toContain('overflow-x-auto')
    expect(region.className).toContain('max-w-full')
  })

  it('does not treat a lone |x| as a table', () => {
    const { container } = render(
      <RichText format="markdown" text={'The expression |x| means absolute value.'} />,
    )
    expect(container.querySelector('table')).not.toBeInTheDocument()
    expect(container.textContent).toContain('|x|')
  })

  it('does not parse a table inside a fenced code block', () => {
    const { container } = render(
      <RichText format="markdown" text={'```\n| a | b |\n| --- | --- |\n```'} />,
    )
    expect(container.querySelector('table')).not.toBeInTheDocument()
    expect(container.querySelector('pre code')?.textContent).toContain('| a | b |')
  })

  it('keeps ordinary paragraphs, lists and headings working', () => {
    const { container } = render(
      <RichText
        format="markdown"
        text={'## Heading\n\nA paragraph.\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('table')).toBeInTheDocument()
  })
})
