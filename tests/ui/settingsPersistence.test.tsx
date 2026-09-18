import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SettingsPage } from '@/pages/SettingsPage'
import { SettingsService } from '@/services/settingsService'
import {
  setSettingsServiceForTesting,
  useSettingsStore,
} from '@/features/settings/settingsStore'
import { clearCachedDeviceKey } from '@/infrastructure/crypto/deviceKey'
import { setDbForTesting, AppDatabase } from '@/infrastructure/db/database'

/**
 * Reproduces the reported flow through the real Settings page:
 *   fill the form → Save → reload the page → the values are still there.
 */

beforeEach(() => {
  const db = new AppDatabase()
  setDbForTesting(db)
  setSettingsServiceForTesting(new SettingsService(db))
  clearCachedDeviceKey()
  useSettingsStore.setState({
    settings: null,
    loaded: false,
    loading: false,
    saving: false,
    error: null,
  })
})

/** Simulate a browser reload: cold caches, fresh store, same database. */
function reloadCaches(): void {
  clearCachedDeviceKey()
  useSettingsStore.setState({
    settings: null,
    loaded: false,
    loading: false,
    saving: false,
    error: null,
  })
}

describe('Settings page persistence', () => {
  it('keeps provider, base URL, API key and model after a reload', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    const baseUrl = await screen.findByLabelText('API Base URL')
    const key = screen.getByLabelText('Key')
    const model = screen.getByLabelText('Model')

    await user.clear(baseUrl)
    await user.type(baseUrl, 'https://api.example.com/v1')
    await user.type(key, 'sk-ui-test-key')
    await user.clear(model)
    await user.type(model, 'ui-model')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const stored = await new SettingsService().get()
      expect(stored.apiKey).toBe('sk-ui-test-key')
      expect(stored.baseURL).toBe('https://api.example.com/v1')
      expect(stored.model).toBe('ui-model')
    })

    unmount()
    reloadCaches()

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByLabelText('API Base URL')).toHaveValue(
      'https://api.example.com/v1',
    )
    expect(screen.getByLabelText('Key')).toHaveValue('sk-ui-test-key')
    expect(screen.getByLabelText('Model')).toHaveValue('ui-model')
  })

  it('does not lose the API key when saving again without retyping it', async () => {
    const user = userEvent.setup()
    await new SettingsService().update({
      apiKey: 'sk-existing-key',
      baseURL: 'https://api.example.com/v1',
      model: 'model-a',
    })

    reloadCaches()
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    const model = await screen.findByLabelText('Model')
    await user.clear(model)
    await user.type(model, 'model-b')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(async () => {
      const stored = await new SettingsService().get()
      expect(stored.apiKey).toBe('sk-existing-key')
      expect(stored.model).toBe('model-b')
    })
  })
})
