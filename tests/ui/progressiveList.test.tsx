import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProgressiveList } from '@/shared/ui/ProgressiveList'

function items(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `item-${i}`)
}

describe('ProgressiveList', () => {
  it('renders everything when the list is within the page size', () => {
    render(
      <ProgressiveList items={items(5)} pageSize={10} renderItem={(item) => <div key={item}>{item}</div>} />,
    )
    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.getByText('item-4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show/i })).not.toBeInTheDocument()
  })

  it('caps the initial render at the page size', () => {
    render(
      <ProgressiveList items={items(100)} pageSize={10} renderItem={(item) => <div key={item}>{item}</div>} />,
    )
    expect(screen.getByText('item-0')).toBeInTheDocument()
    expect(screen.getByText('item-9')).toBeInTheDocument()
    expect(screen.queryByText('item-10')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show 10 more/i })).toBeInTheDocument()
  })

  it('reveals another page on click and hides the button once exhausted', async () => {
    const user = userEvent.setup()
    render(
      <ProgressiveList items={items(15)} pageSize={10} renderItem={(item) => <div key={item}>{item}</div>} />,
    )
    await user.click(screen.getByRole('button', { name: /show 5 more/i }))
    expect(screen.getByText('item-14')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show/i })).not.toBeInTheDocument()
  })

  it('reports how many items remain', () => {
    render(
      <ProgressiveList items={items(30)} pageSize={10} renderItem={(item) => <div key={item}>{item}</div>} />,
    )
    expect(screen.getByText('(20 remaining)')).toBeInTheDocument()
  })

  it('renders the empty slot when there are no items', () => {
    render(
      <ProgressiveList
        items={[]}
        empty={<div>nothing here</div>}
        renderItem={(item: string) => <div key={item}>{item}</div>}
      />,
    )
    expect(screen.getByText('nothing here')).toBeInTheDocument()
  })

  it('does not reset the revealed window when the list grows', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ProgressiveList items={items(30)} pageSize={10} renderItem={(item) => <div key={item}>{item}</div>} />,
    )
    await user.click(screen.getByRole('button', { name: /show 10 more/i }))
    expect(screen.getByText('item-19')).toBeInTheDocument()

    rerender(
      <ProgressiveList items={items(40)} pageSize={10} renderItem={(item) => <div key={item}>{item}</div>} />,
    )
    // The previously revealed window is preserved (20 items), not reset to 10.
    expect(screen.getByText('item-19')).toBeInTheDocument()
    expect(screen.queryByText('item-20')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show 10 more/i })).toBeInTheDocument()
  })
})
