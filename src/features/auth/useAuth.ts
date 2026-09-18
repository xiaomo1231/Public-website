import { useEffect } from 'react'
import { useAuthStore } from './authStore'

export { useAuthStore }

export function useAuth() {
  const store = useAuthStore()

  useEffect(() => {
    if (!store.loaded && !store.loading) {
      void store.load()
    }
  }, [store])

  return {
    profile: store.profile,
    loaded: store.loaded,
    loading: store.loading,
    error: store.error,
    isUnlocked: Boolean(store.profile?.unlockedAt),
    unlock: store.unlock,
    lock: store.lock,
    setTheme: store.setTheme,
    setName: store.setName,
    setLanguage: store.setLanguage,
    setUILanguage: store.setUILanguage,
  }
}