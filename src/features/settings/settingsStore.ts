import { create } from 'zustand'
import type { AISettings } from '@/entities/settings/types'
import { SettingsService } from '@/services/settingsService'
import { t } from '@/i18n'

interface SettingsStoreState {
  settings: AISettings | null
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string | null
}

interface SettingsStoreActions {
  load: () => Promise<void>
  update: (patch: Partial<AISettings>) => Promise<void>
  applyPreset: (providerId: AISettings['provider']) => Promise<void>
  reset: () => Promise<void>
}

export type SettingsStore = SettingsStoreState & SettingsStoreActions

let service = new SettingsService()

/** Test seam: inject a service bound to a fresh database. */
export function setSettingsServiceForTesting(svc: SettingsService | null): void {
  service = svc ?? new SettingsService()
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,
  loaded: false,
  loading: false,
  saving: false,
  error: null,

  async load() {
    set({ loading: true, error: null })
    try {
      const settings = await service.get()
      set({ settings, loaded: true, loading: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errors.failedToLoadSettings')
      set({ error: msg, loaded: true, loading: false })
    }
  },

  async update(patch) {
    set({ saving: true, error: null })
    try {
      const settings = await service.update(patch)
      set({ settings, saving: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errors.failedToSaveSettings')
      set({ error: msg, saving: false })
      throw err
    }
  },

  async applyPreset(providerId) {
    set({ saving: true, error: null })
    try {
      const settings = await service.applyProviderPreset(providerId)
      set({ settings, saving: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errors.failedToApplyPreset')
      set({ error: msg, saving: false })
      throw err
    }
  },

  async reset() {
    await service.reset()
    const settings = await service.get()
    set({ settings })
  },
}))