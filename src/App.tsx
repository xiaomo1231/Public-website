import { useEffect } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { AppProviders } from './app/providers'
import { routes } from './app/router'
import { useAuthStore } from '@/features/auth/useAuth'
import { useProjectStore } from '@/features/project/projectStore'
import { useSettingsStore } from '@/features/settings/settingsStore'
import { useThemeStore, initThemeListener } from '@/features/theme/themeStore'
import { useI18nStore, initUILanguage } from '@/i18n'
import { Toaster } from '@/shared/ui/Toast'
import { SelectionTranslator } from '@/widgets/translation/SelectionTranslator'

const router = createBrowserRouter(routes)

export function App(): JSX.Element {
  const loadAuth = useAuthStore((s) => s.load)
  const loadProjects = useProjectStore((s) => s.load)
  const loadSettings = useSettingsStore((s) => s.load)
  const profile = useAuthStore((s) => s.profile)
  const setPreference = useThemeStore((s) => s.setPreference)
  const syncUILanguage = useI18nStore((s) => s.syncFromProfile)

  // Bootstrap data once on mount
  useEffect(() => {
    initUILanguage()
    void loadAuth()
    void loadProjects()
    void loadSettings()
    const cleanup = initThemeListener()
    return cleanup
  }, [loadAuth, loadProjects, loadSettings])

  // Sync theme preference from the user profile once loaded
  useEffect(() => {
    if (profile?.theme) setPreference(profile.theme)
  }, [profile?.theme, setPreference])

  // The persisted profile is authoritative once it has loaded
  useEffect(() => {
    if (profile?.uiLanguage) syncUILanguage(profile.uiLanguage)
  }, [profile?.uiLanguage, syncUILanguage])

  return (
    <AppProviders>
      <RouterProvider router={router} />
      <Toaster />
      <SelectionTranslator />
    </AppProviders>
  )
}