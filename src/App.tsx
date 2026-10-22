import { Suspense, lazy, useEffect } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { AppProviders } from './app/providers'
import { routes } from './app/router'
import { useAuthStore } from '@/features/auth/useAuth'
import { useProjectStore } from '@/features/project/projectStore'
import { useSettingsStore } from '@/features/settings/settingsStore'
import { useThemeStore, initThemeListener } from '@/features/theme/themeStore'
import { DEFAULT_UI_STYLE } from '@/entities/user/types'
import { isUiStyleSavePending } from '@/features/theme/useAppearance'
import { applyNoteHighlightColor, applyNoteMarkStyle } from '@/features/theme/noteMarkStyle'
import { useI18nStore, initUILanguage } from '@/i18n'
import { Toaster } from '@/shared/ui/Toast'

const router = createBrowserRouter(routes)

// Loaded after first paint: it pulls in the AI services and KaTeX.
const SelectionTranslator = lazy(async () => ({
  default: (await import('@/widgets/translation/SelectionTranslator')).SelectionTranslator,
}))

export function App(): JSX.Element {
  const loadAuth = useAuthStore((s) => s.load)
  const loadProjects = useProjectStore((s) => s.load)
  const loadSettings = useSettingsStore((s) => s.load)
  const profile = useAuthStore((s) => s.profile)
  const setPreference = useThemeStore((s) => s.setPreference)
  const setColorTheme = useThemeStore((s) => s.setColorTheme)
  const setUiStyle = useThemeStore((s) => s.setUiStyle)
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

  // Sync the color theme from the user profile (independent of the mode)
  useEffect(() => {
    if (profile?.colorTheme) setColorTheme(profile.colorTheme)
  }, [profile?.colorTheme, setColorTheme])

  // Interface style follows the profile too (absent → the default style)
  // Only the stored style matters, not every other profile change; while a
  // switch is still saving, the profile holds an older value — skip it.
  const hasProfile = Boolean(profile)
  const profileUiStyle = profile?.uiStyle
  useEffect(() => {
    if (!hasProfile || isUiStyleSavePending()) return
    setUiStyle(profileUiStyle ?? DEFAULT_UI_STYLE)
  }, [hasProfile, profileUiStyle, setUiStyle])

  // Walkthrough question marks (link / highlighter) follow the profile too
  const profileNoteMark = profile?.noteMarkStyle
  useEffect(() => {
    applyNoteMarkStyle(profileNoteMark)
  }, [profileNoteMark])
  const profileNoteColor = profile?.noteHighlightColor
  useEffect(() => {
    applyNoteHighlightColor(profileNoteColor)
  }, [profileNoteColor])

  // The persisted profile is authoritative once it has loaded
  useEffect(() => {
    if (profile?.uiLanguage) syncUILanguage(profile.uiLanguage)
  }, [profile?.uiLanguage, syncUILanguage])

  return (
    <AppProviders>
      <RouterProvider router={router} />
      <Toaster />
      <Suspense fallback={null}>
        <SelectionTranslator />
      </Suspense>
    </AppProviders>
  )
}
