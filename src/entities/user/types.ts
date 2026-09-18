import type { UILanguage } from '@/i18n/types'

export type UserLanguage = 'auto' | 'zh' | 'en'
export type UserTheme = 'light' | 'dark' | 'system'

export interface UserProfile {
  id: 'singleton'
  name: string
  /**
   * Language used for **translation targets and course content**. This is NOT
   * the interface language — see `uiLanguage`.
   */
  language: UserLanguage
  theme: UserTheme
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
  uiLanguage?: UILanguage
}