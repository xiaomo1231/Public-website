import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/authStore'
import type { UserProfile } from '@/entities/user/types'
import { Sidebar } from '@/app/layout/Sidebar'

/** Mounting the real readout fetches the balance; a stub shows whether it is mounted. */
const mounted = vi.fn()
vi.mock('@/widgets/settings/UsageReadout', () => ({
  UsageReadout: () => {
    mounted()
    return <span data-testid="usage-readout">usage</span>
  },
}))

const profile = (extra: Partial<UserProfile> = {}): UserProfile => ({
  id: 'singleton',
  name: 'Student',
  language: 'auto',
  theme: 'light',
  ...extra,
})

afterEach(() => {
  mounted.mockClear()
  useAuthStore.setState({ profile: null })
})

describe('usage / balance readout setting', () => {
  it('is off by default: the side rail does not mount (or fetch) the readout', () => {
    useAuthStore.setState({ profile: profile() })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('usage-readout')).toBeNull()
    expect(mounted).not.toHaveBeenCalled()
  })

  it('shows the readout when turned on', () => {
    useAuthStore.setState({ profile: profile({ showUsageReadout: true }) })
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('usage-readout')).toBeInTheDocument()
  })
})
