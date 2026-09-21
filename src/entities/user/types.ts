import type { UILanguage } from '@/i18n/types'

export type UserLanguage = 'auto' | 'zh' | 'en'
export type UserTheme = 'light' | 'dark' | 'system'

/**
 * Persisted appearance palette. The definitions (labels + source colours) live
 * in `features/theme/colorThemes.ts`; the union lives here because it is part
 * of the stored profile.
 */
export type UserColorTheme = 'default' | 'pinkAqua' | 'warmOrange' | 'academic'

export interface UserProfile {
  id: 'singleton'
  name: string
  /**
   * Language used for **translation targets and course content**. This is NOT
   * the interface language â€?see `uiLanguage`.
   */
  language: UserLanguage
  /** Appearance mode: Light / Dark / System. */
  theme: UserTheme
  /**
   * Appearance palette, independent of `theme`. Absent on profiles written
   * before color themes existed, in which case the original palette is used.
   */
  colorTheme?: UserColorTheme
  /**
   * Language of the **application interface**. Persisted locally alongside the
   * rest of the profile; absent on profiles written before i18n existed, in
   * which case the app falls back to English.
   */
  uiLanguage?: UILanguage
  unlockedAt?: number
  inviteCode?: string
}

export interface UpdateUserInput {
  name?: string
  language?: UserLanguage
  theme?: UserTheme
  colorTheme?: UserColorTheme
  uiLanguage?: UILanguage
}