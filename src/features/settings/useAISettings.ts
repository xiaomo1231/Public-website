import { useEffect } from 'react'
import { useSettingsStore } from './settingsStore'

export function useAISettings() {
  const store = useSettingsStore()

  useEffect(() => {
    if (!store.loaded && !store.loading) {
      void store.load()
    }
  }, [store])

  return {
    settings: store.settings,
    loading: store.loading,
    saving: store.saving,
    error: store.error,
    loaded: store.loaded,
    update: store.update,
    applyPreset: store.applyPreset,
    reset: store.reset,
  }
}