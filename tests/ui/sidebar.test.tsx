import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/app/layout/Sidebar'

describe('Sidebar collapse control', () => {
  it('offers an accessible collapse button on desktop', async () => {
    const onCollapse = vi.fn()
    render(
      <MemoryRouter>
        <Sidebar onCollapse={onCollapse} />
      </MemoryRouter>,
    )

    const button = screen.getByRole('button', { name: 'Collapse sidebar' })
    await userEvent.setup().click(button)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('omits the collapse button in the mobile drawer (no handler)', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument()
  })
})
